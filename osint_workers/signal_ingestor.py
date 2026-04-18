import time
import base64
import requests
from bs4 import BeautifulSoup
import feedparser
import json
import os
import sys
import gc
import urllib.parse
import re
import hashlib
import calendar
from email.utils import parsedate_to_datetime
from datetime import date, datetime, timedelta, timezone
from google import genai
from googleapiclient.discovery import build
from dotenv import load_dotenv

env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
_loaded = load_dotenv(dotenv_path=env_path)
if not _loaded and not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
    print(f"WARN: dotenv did not load from {env_path} — export keys in the shell or fix the path.")


def _jwt_role_hint(jwt: str | None) -> str:
    if not jwt or jwt.count(".") != 2:
        return "missing_or_not_jwt"
    try:
        payload_b64 = jwt.split(".")[1]
        pad = "=" * (-len(payload_b64) % 4)
        raw = base64.urlsafe_b64decode(payload_b64 + pad)
        return str(json.loads(raw).get("role", "?"))
    except Exception:
        return "decode_error"


SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
SUPABASE_ANON_KEY = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
# After RLS hardening, anon cannot INSERT into signals — use service role on the VM.
SUPABASE_KEY = SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY")


def _parse_int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


# Free tier (Google AI / Gemini API): typical Flash-class limits are on the order of ~15 RPM and ~1.5k RPD
# — exact numbers change; see https://ai.google.dev/gemini-api/docs/rate-limits — set SIGNAL_GEMINI_FREE_TIER=1 to
# use conservative defaults + spacing between calls. You can still override caps via env.
SIGNAL_GEMINI_FREE_TIER = os.getenv("SIGNAL_GEMINI_FREE_TIER", "").lower() in ("1", "true", "yes")
_default_llm_run = 25 if SIGNAL_GEMINI_FREE_TIER else 50
_default_llm_day = 1000 if SIGNAL_GEMINI_FREE_TIER else 800
_default_gemini_gap = 4.0 if SIGNAL_GEMINI_FREE_TIER else 0.0

# LLM usage caps (0 = unlimited). Counts reset: per-run counter each ingest cycle; daily at midnight IST.
SIGNAL_LLM_MAX_PER_RUN = _parse_int_env("SIGNAL_LLM_MAX_PER_RUN", _default_llm_run)
SIGNAL_LLM_MAX_PER_DAY = _parse_int_env("SIGNAL_LLM_MAX_PER_DAY", _default_llm_day)
# Briefing: 0 = run every ingest cycle; else minimum minutes between Gemini briefing calls.
SIGNAL_BRIEFING_INTERVAL_MINUTES = _parse_int_env("SIGNAL_BRIEFING_INTERVAL_MINUTES", 360)
SIGNAL_BRIEFING_MAX_SIGNALS = _parse_int_env("SIGNAL_BRIEFING_MAX_SIGNALS", 12)
SIGNAL_GEMINI_MODEL = os.getenv("SIGNAL_GEMINI_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"
SIGNAL_DISABLE_KEYWORD_GATE = os.getenv("SIGNAL_DISABLE_KEYWORD_GATE", "").lower() in ("1", "true", "yes")
SIGNAL_MAX_ENTRY_AGE_HOURS = _parse_int_env("SIGNAL_MAX_ENTRY_AGE_HOURS", 24)
# If True, only accept RSS items whose published instant falls on today's calendar date in IST.
SIGNAL_REQUIRE_TODAY_IST = os.getenv("SIGNAL_REQUIRE_TODAY_IST", "").lower() in ("1", "true", "yes")
# If False, RSS entries with no parseable date are skipped (fixes "3 week old" items that had no timestamp).
SIGNAL_ALLOW_UNDATED_RSS = os.getenv("SIGNAL_ALLOW_UNDATED_RSS", "").lower() in ("1", "true", "yes")
try:
    SIGNAL_GEMINI_MIN_INTERVAL_SEC = float(os.getenv("SIGNAL_GEMINI_MIN_INTERVAL_SEC", str(_default_gemini_gap)))
except ValueError:
    SIGNAL_GEMINI_MIN_INTERVAL_SEC = _default_gemini_gap
SIGNAL_ENABLE_GDELT = os.getenv("SIGNAL_ENABLE_GDELT", "true").lower() in ("1", "true", "yes")
SIGNAL_GDELT_LOOKBACK_HOURS = _parse_int_env("SIGNAL_GDELT_LOOKBACK_HOURS", 24)
SIGNAL_RUN_ONCE = os.getenv("SIGNAL_RUN_ONCE", "").lower() in ("1", "true", "yes")
SIGNAL_KEYWORD_EXTRA = [
    x.strip().lower()
    for x in (os.getenv("SIGNAL_KEYWORD_EXTRA") or "").split(",")
    if x.strip()
]

_STRONG_ELECTION_TERMS = frozenset(
    {
        "election",
        "polling",
        "poll",
        "vote",
        "voting",
        "eci",
        "election commission",
        "model code of conduct",
        "mcc",
        "evm",
        "booth",
        "booth capture",
        "turnout",
        "counting",
        "nomination",
        "affidavit",
        "by-election",
        "exit poll",
        "phase",
    }
)

_ELECTION_CONTEXT_TERMS = frozenset(
    {
        "assembly election",
        "state election",
        "constituency",
        "polling station",
        "returning officer",
        "vote share",
        "margin",
        "campaign",
        "rally",
        "manifesto",
    }
)

_STATE_NAMES = frozenset(
    {
        "tamil nadu",
        "kerala",
        "west bengal",
        "assam",
        "puducherry",
        "bengal",
        "india",
    }
)

_article_llm_run_count = 0
_llm_day_total = 0
_llm_day_key: date | None = None
_last_briefing_ist: datetime | None = None


def _llm_refresh_day() -> None:
    global _llm_day_total, _llm_day_key
    today = datetime.now(IST).date()
    if _llm_day_key != today:
        _llm_day_key = today
        _llm_day_total = 0


def _llm_can_article() -> bool:
    _llm_refresh_day()
    if SIGNAL_LLM_MAX_PER_RUN > 0 and _article_llm_run_count >= SIGNAL_LLM_MAX_PER_RUN:
        return False
    if SIGNAL_LLM_MAX_PER_DAY > 0 and _llm_day_total >= SIGNAL_LLM_MAX_PER_DAY:
        return False
    return True


def _llm_can_briefing() -> bool:
    _llm_refresh_day()
    if SIGNAL_LLM_MAX_PER_DAY > 0 and _llm_day_total >= SIGNAL_LLM_MAX_PER_DAY:
        return False
    return True


def _llm_record_article() -> None:
    global _article_llm_run_count, _llm_day_total
    _article_llm_run_count += 1
    _llm_day_total += 1


def _llm_record_briefing() -> None:
    global _llm_day_total
    _llm_day_total += 1


def _election_keyword_hit(text: str) -> bool:
    if SIGNAL_DISABLE_KEYWORD_GATE:
        return True
    blob = (text or "").lower()

    # Tight gate: require explicit election mechanics + contextual cue.
    # This avoids false positives from generic party/politics stories.
    has_strong = any(k in blob for k in _STRONG_ELECTION_TERMS)
    if not has_strong and SIGNAL_KEYWORD_EXTRA:
        has_strong = any(k in blob for k in SIGNAL_KEYWORD_EXTRA)
    if not has_strong:
        return False

    has_context = any(k in blob for k in _STATE_NAMES) or any(k in blob for k in _ELECTION_CONTEXT_TERMS)
    return has_context


def _should_run_briefing_now() -> bool:
    global _last_briefing_ist
    if SIGNAL_BRIEFING_INTERVAL_MINUTES <= 0:
        return True
    now = datetime.now(IST)
    if _last_briefing_ist is None:
        return True
    elapsed = (now - _last_briefing_ist).total_seconds() / 60.0
    return elapsed >= float(SIGNAL_BRIEFING_INTERVAL_MINUTES)


gemini_client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None
youtube = build('youtube', 'v3', developerKey=YOUTUBE_API_KEY) if YOUTUBE_API_KEY else None

_last_gemini_mono: float = 0.0


def _pace_gemini_call() -> None:
    """Space out Gemini API calls to respect free-tier RPM-style limits."""
    global _last_gemini_mono
    gap = max(0.0, float(SIGNAL_GEMINI_MIN_INTERVAL_SEC or 0.0))
    if gap <= 0:
        return
    now = time.monotonic()
    if _last_gemini_mono > 0:
        elapsed = now - _last_gemini_mono
        if elapsed < gap:
            time.sleep(gap - elapsed)
    _last_gemini_mono = time.monotonic()

try:
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise ValueError("Supabase URL or key missing.")
    sr_role = _jwt_role_hint(SUPABASE_SERVICE_ROLE_KEY)
    an_role = _jwt_role_hint(SUPABASE_ANON_KEY)
    key_role = _jwt_role_hint(SUPABASE_KEY)
    print(
        f"[supabase] URL loaded: {bool(SUPABASE_URL)} | "
        f"using_JWT_role={key_role!r} | "
        f"service_key_present={bool(SUPABASE_SERVICE_ROLE_KEY)} (jwt_role={sr_role!r}) | "
        f"anon_key_present={bool(SUPABASE_ANON_KEY)} (jwt_role={an_role!r})"
    )
    if key_role != "service_role":
        print(
            "WARN: Active key is not service_role — INSERT into signals will fail under RLS. "
            "Set SUPABASE_SERVICE_ROLE_KEY on the VM (same project as URL) and restart."
        )
    _SB_REST = f"{SUPABASE_URL.rstrip('/')}/rest/v1"
    _SB_HEADERS = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    supabase = True
except Exception as e:
    print(f"CRITICAL: Supabase offline: {e}")
    supabase = None


def _sb_req(method: str, table: str, params: dict | None = None, payload=None):
    if not supabase:
        raise RuntimeError("supabase_offline")
    url = f"{_SB_REST}/{table}"
    resp = requests.request(method, url, headers=_SB_HEADERS, params=params or {}, json=payload, timeout=25)
    if resp.status_code >= 400:
        raise RuntimeError(f"supabase_http_{resp.status_code}: {resp.text[:240]}")
    if resp.text.strip() == "":
        return None
    try:
        return resp.json()
    except Exception:
        return resp.text


def sb_select(
    table: str,
    select: str,
    *,
    filters: dict[str, str] | None = None,
    order: str | None = None,
    limit: int | None = None,
) -> list[dict]:
    params: dict[str, str] = {"select": select}
    if filters:
        params.update(filters)
    if order:
        params["order"] = order
    if limit is not None:
        params["limit"] = str(int(limit))
    data = _sb_req("GET", table, params=params)
    return data if isinstance(data, list) else []


def sb_insert(table: str, row: dict) -> None:
    # Prefer minimal response payload to keep worker fast.
    headers = dict(_SB_HEADERS)
    headers["Prefer"] = "return=minimal"
    url = f"{_SB_REST}/{table}"
    resp = requests.post(url, headers=headers, json=row, timeout=25)
    if resp.status_code >= 400:
        raise RuntimeError(f"supabase_insert_{resp.status_code}: {resp.text[:240]}")


def sb_delete_lt(table: str, field: str, iso: str) -> int:
    headers = dict(_SB_HEADERS)
    headers["Prefer"] = "return=representation"
    url = f"{_SB_REST}/{table}"
    resp = requests.delete(url, headers=headers, params={field: f"lt.{iso}"}, timeout=25)
    if resp.status_code >= 400:
        raise RuntimeError(f"supabase_delete_{resp.status_code}: {resp.text[:240]}")
    try:
        data = resp.json()
        return len(data) if isinstance(data, list) else 0
    except Exception:
        return 0

FEEDS = {
    # --- National & Official ---
    "ANI_National": "https://aninews.in/rss/national",
    "The_Hindu_National": "https://www.thehindu.com/news/national/feeder/default.rss",
    "DD_News_National": "https://ddnews.gov.in/en/category/national/feed/",
    "ECI_Official": "https://news.google.com/rss/search?q=Election+Commission+of+India+official+statement+when:1d&hl=en-IN&gl=IN&ceid=IN:en",

    # --- State Specific (Election 2026) ---
    "Tamil_Nadu": "https://news.google.com/rss/search?q=Tamil+Nadu+Election+2026+breaking+OR+alert+when:1d&hl=en-IN&gl=IN&ceid=IN:en",
    "Kerala": "https://news.google.com/rss/search?q=Kerala+Election+2026+breaking+OR+alert+when:1d&hl=en-IN&gl=IN&ceid=IN:en",
    "West_Bengal": "https://news.google.com/rss/search?q=West+Bengal+Election+2026+breaking+OR+alert+when:1d&hl=en-IN&gl=IN&ceid=IN:en",
    "Assam": "https://news.google.com/rss/search?q=Assam+Election+2026+breaking+OR+alert+when:1d&hl=en-IN&gl=IN&ceid=IN:en",
    "Puducherry": "https://news.google.com/rss/search?q=Puducherry+Election+2026+breaking+OR+alert+when:1d&hl=en-IN&gl=IN&ceid=IN:en",

    # --- Crisis & Security Monitoring ---
    "Security_Alerts": "https://news.google.com/rss/search?q=Election+violence+OR+booth+capture+OR+EVM+complaint+India+when:1d&hl=en-IN&gl=IN&ceid=IN:en"
}

# --- GDELT QUERIES ---
GDELT_QUERIES = {
    "Tamil_Nadu":  "Tamil Nadu election 2026",
    "Kerala":      "Kerala election 2026",
    "West_Bengal": "West Bengal election 2026",
    "Assam":       "Assam election 2026",
    "Puducherry":  "Puducherry election 2026",
}

# --- QUOTA & TIME MANAGEMENT ---
IST = timezone(timedelta(hours=5, minutes=30))
YOUTUBE_QUOTA_USED = 0
LAST_QUOTA_RESET_DATE = datetime.now(IST).date()

def manage_youtube_quota():
    """Resets quota daily at midnight IST."""
    global YOUTUBE_QUOTA_USED, LAST_QUOTA_RESET_DATE
    current_date = datetime.now(IST).date()
    if current_date != LAST_QUOTA_RESET_DATE:
        YOUTUBE_QUOTA_USED = 0
        LAST_QUOTA_RESET_DATE = current_date

def get_election_context():
    """Provides time-aware instructions to the AI."""
    now = datetime.now(IST)
    date_str = now.strftime("%Y-%m-%d")
    
    # Auto-Terminate Script after elections
    if now > datetime(2026, 5, 11, tzinfo=IST):
        print("=== ELECTION CYCLE CONCLUDED. TERMINATING OSINT ENGINE ===")
        sys.exit(0)

    if date_str in["2026-04-09", "2026-04-23", "2026-04-29"]:
        return "TODAY IS VOTING DAY. Focus heavily on polling booth violence, EVM issues, voter turnout, and immediate election commission actions."
    elif date_str == "2026-05-04":
        return "TODAY IS COUNTING DAY. Focus strictly on live vote margins, winning candidates, and final results."
    else:
        return "PRE-POLL CAMPAIGN PHASE. Focus on rallies, manifesto promises, MCC violations, and candidate alliances."

def extract_article_data(url, fallback_html):
    full_text, image_url, final_url = "", "", url
    try:
        headers = {'User-Agent': 'Mozilla/5.0'}
        res = requests.get(url, headers=headers, timeout=10, allow_redirects=True)
        final_url = res.url or url
        soup = BeautifulSoup(res.content, 'html.parser')
        full_text = " ".join([p.text for p in soup.find_all('p')])
        og_image = soup.find('meta', property='og:image')
        if og_image: image_url = og_image.get('content', '')
    except Exception: pass
    
    if len(full_text) < 100 and fallback_html:
        full_text = BeautifulSoup(fallback_html, 'html.parser').get_text(separator=' ')
        
    # Token-safety: keep ingestion conservative.
    return full_text[:1400], image_url, final_url


def _parse_rss_date_string(raw: str) -> datetime | None:
    """Parse RSS/Atom date strings (RFC 2822, common ISO variants). Returns UTC."""
    s = (raw or "").strip()
    if not s:
        return None
    try:
        dt = parsedate_to_datetime(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        pass
    try:
        iso = s.replace("Z", "+00:00")
        dt2 = datetime.fromisoformat(iso)
        if dt2.tzinfo is None:
            dt2 = dt2.replace(tzinfo=timezone.utc)
        return dt2.astimezone(timezone.utc)
    except Exception:
        return None


def _entry_published_dt(entry) -> datetime | None:
    """
    Best-effort published/updated timestamp from feedparser entries.
    Returns UTC datetime when available.
    """
    for attr in ("published_parsed", "updated_parsed"):
        st = getattr(entry, attr, None)
        if st:
            try:
                ts = calendar.timegm(st)
                return datetime.fromtimestamp(ts, tz=timezone.utc)
            except Exception:
                pass
    for attr in ("published", "updated", "created"):
        s = getattr(entry, attr, None)
        if isinstance(s, str) and s.strip():
            got = _parse_rss_date_string(s)
            if got:
                return got
    return None


def _published_is_today_ist(published_utc: datetime) -> bool:
    return published_utc.astimezone(IST).date() == datetime.now(IST).date()


def _is_recent_enough(published_utc: datetime | None, max_age_hours: int) -> bool:
    if max_age_hours <= 0:
        return True
    if published_utc is None:
        # Previously this returned True and let undated items through → stale syndicated stories.
        return SIGNAL_ALLOW_UNDATED_RSS
    now_utc = datetime.now(timezone.utc)
    if published_utc >= (now_utc - timedelta(hours=max_age_hours)):
        if SIGNAL_REQUIRE_TODAY_IST and not _published_is_today_ist(published_utc):
            return False
        return True
    return False


def _norm_title(t: str) -> str:
    return " ".join((t or "").strip().lower().split())


_TRACKING_QUERY_KEYS = {
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "utm_id",
    "utm_name",
    "utm_reader",
    "utm_viz_id",
    "utm_pubreferrer",
    "gclid",
    "dclid",
    "fbclid",
    "igshid",
    "mc_cid",
    "mc_eid",
    "ref",
    "referrer",
    "ref_src",
    "source",
    "src",
    "cmpid",
    "cmp",
    "mkt_tok",
    "spm",
    "_ga",
    "ocid",
}


def _canonical_url(u: str) -> str:
    """
    Canonicalize URLs for hard dedupe.
    - lowercases scheme/host
    - removes fragments
    - removes common tracking params
    - normalizes default ports
    - sorts remaining query params
    - strips trailing slash from path
    """
    raw = (u or "").strip()
    if not raw:
        return ""
    try:
        p = urllib.parse.urlparse(raw)
        scheme = (p.scheme or "https").lower()
        netloc = (p.netloc or "").lower()
        if not netloc and p.path and "://" not in raw:
            # Sometimes feeds give schemeless URLs; treat as https.
            p = urllib.parse.urlparse("https://" + raw)
            scheme = (p.scheme or "https").lower()
            netloc = (p.netloc or "").lower()

        # Remove default ports
        if netloc.endswith(":80") and scheme == "http":
            netloc = netloc[:-3]
        if netloc.endswith(":443") and scheme == "https":
            netloc = netloc[:-4]

        # Normalize host common prefix
        if netloc.startswith("www."):
            netloc = netloc[4:]

        path = (p.path or "").strip()
        path = re.sub(r"/{2,}", "/", path)
        if path != "/":
            path = path.rstrip("/")

        # Query: remove tracking keys, keep stable keys, sort
        q = urllib.parse.parse_qsl(p.query or "", keep_blank_values=False)
        q2 = []
        for k, v in q:
            lk = (k or "").lower()
            if lk in _TRACKING_QUERY_KEYS:
                continue
            if not lk:
                continue
            q2.append((lk, v))
        q2.sort()
        query = urllib.parse.urlencode(q2, doseq=True)

        # Drop fragments
        return urllib.parse.urlunparse((scheme, netloc, path, "", query, ""))
    except Exception:
        return raw.lower()


def _extract_youtube_id(u: str) -> str | None:
    raw = (u or "").strip()
    if not raw:
        return None
    try:
        p = urllib.parse.urlparse(raw)
        host = (p.netloc or "").lower()
        path = p.path or ""
        if host.startswith("www."):
            host = host[4:]

        # youtu.be/<id>
        if host == "youtu.be":
            vid = path.strip("/").split("/")[0]
            return vid or None

        if host.endswith("youtube.com") or host.endswith("youtube-nocookie.com"):
            # /watch?v=<id>
            qs = urllib.parse.parse_qs(p.query or "")
            if "v" in qs and qs["v"]:
                return qs["v"][0]

            # /shorts/<id>, /embed/<id>
            m = re.match(r"^/(shorts|embed)/([^/?#]+)", path)
            if m:
                return m.group(2)
    except Exception:
        return None
    return None


def _simhash64(text: str) -> int:
    """
    Small, dependency-free simhash for near-duplicate detection.
    """
    s = " ".join((text or "").lower().split())
    if not s:
        return 0
    tokens = re.findall(r"[a-z0-9]{2,}", s)
    if not tokens:
        return 0
    v = [0] * 64
    for tok in tokens[:800]:
        h = hashlib.md5(tok.encode("utf-8")).digest()[:8]
        x = int.from_bytes(h, "big", signed=False)
        for i in range(64):
            v[i] += 1 if (x >> i) & 1 else -1
    out = 0
    for i in range(64):
        if v[i] > 0:
            out |= 1 << i
    return out


def _hamming64(a: int, b: int) -> int:
    return (a ^ b).bit_count()

def _norm_url(u: str) -> str:
    try:
        p = urllib.parse.urlparse((u or "").strip())
        netloc = (p.netloc or "").lower()
        path = (p.path or "").rstrip("/").lower()
        scheme = (p.scheme or "https").lower()
        if not netloc:
            return (u or "").strip().lower()
        return f"{scheme}://{netloc}{path}"
    except Exception:
        return (u or "").strip().lower()


def valid_india_coords(lat, lng):
    """Return (lat, lng) floats if plausible for India, else None."""
    if lat is None or lng is None:
        return None
    try:
        lat_f = float(lat)
        lng_f = float(lng)
    except (TypeError, ValueError):
        return None
    if 6.0 <= lat_f <= 38.0 and 67.0 <= lng_f <= 98.0:
        return lat_f, lng_f
    return None


def fetch_youtube_video(query):
    """Hits YouTube API safely. Costs 100 Units. Hard cap at 4500/day."""
    global YOUTUBE_QUOTA_USED
    manage_youtube_quota()

    if not youtube: return ""
    if YOUTUBE_QUOTA_USED >= 4500:
        print("      [!] YouTube Quota Limit Reached for today. Skipping video fetch.")
        return ""

    try:
        # Removed videoCategoryId='25' so we don't accidentally filter out valid news Shorts
        safe_query = f"{query} news"
        req = youtube.search().list(
            q=safe_query, 
            part='snippet', 
            type='video', 
            maxResults=1, 
            order='relevance'
        )
        res = req.execute()
        YOUTUBE_QUOTA_USED += 100
        
        if 'items' in res and len(res['items']) > 0:
            video_id = res['items'][0]['id']['videoId']
            return f"https://www.youtube.com/embed/{video_id}?autoplay=1"
    except Exception as e:
        print(f"      [!] YouTube API Error: {e}")
    return ""

def analyze_and_insert(source_title, source_url, original_title, full_text, image_url, state_context, valid_c_ids):
    if not gemini_client:
        print("   [llm] skip: GEMINI_API_KEY / client missing")
        return False
    if not _llm_can_article():
        print(
            f"   [llm-cap] skip article LLM "
            f"(run {_article_llm_run_count}/{SIGNAL_LLM_MAX_PER_RUN or '∞'}, "
            f"day {_llm_day_total}/{SIGNAL_LLM_MAX_PER_DAY or '∞'})"
        )
        return False

    election_context = get_election_context()
    # Token hygiene: keep input tight and deterministic.
    full_text = (full_text or "").strip()[:1400]
    original_title = (original_title or "").strip()[:220]

    if not _election_keyword_hit(f"{original_title} {full_text}"):
        print(f"   [kw-gate] skip (no election keywords in title/body): {original_title[:56]!r}...")
        return False

    prompt = (
        "You are a strictly accurate Indian election OSINT extractor. "
        + election_context
        + "\nReturn ONLY valid JSON (no markdown, no prose).\n"
        + f'Title: "{original_title}"\n'
        + f'Body: "{full_text}"\n\n'
        + "Schema:\n"
        + "{"
        + f'"state":"{state_context.replace("_"," ")}",'
        + '"constituency_id":"",'
        + '"election_relevance_0_1":0.0,'
        + '"relevance_reason":"",'
        + '"severity":1,'
        + '"verified":false,'
        + '"bullets":["p1","p2","p3","p4"],'
        + '"latitude":null,'
        + '"longitude":null,'
        + '"geo_confidence":0.0,'
        + '"video_relevant":false,'
        + '"video_confidence":0.0,'
        + '"video_query":""'
        + "}\n\n"
        + "Rules: bullets=2..4 items, each <=12 words. Never guess coordinates. If not election-related, set election_relevance_0_1<=0.3."
    )
    try:
        # Low-signal telemetry so we can spot prompt bloat quickly.
        print(
            f"   [ai] model={SIGNAL_GEMINI_MODEL} in_chars={len(original_title)+len(full_text)} "
            f"title_chars={len(original_title)} body_chars={len(full_text)}"
        )
        _pace_gemini_call()
        try:
            response = gemini_client.models.generate_content(model=SIGNAL_GEMINI_MODEL, contents=prompt)
        except Exception as gen_e:
            err_s = str(gen_e).lower()
            if "429" in err_s or "quota" in err_s or "resource" in err_s:
                print("   [ai] quota/rate hit — sleeping 65s and retrying once...")
                time.sleep(65)
                _pace_gemini_call()
                response = gemini_client.models.generate_content(model=SIGNAL_GEMINI_MODEL, contents=prompt)
            else:
                raise
        _llm_record_article()
        text = response.text.strip()
        if text.startswith("```json"): text = text[7:-3].strip()
        analysis = json.loads(text)

        # Hard relevance gate: skip items that are not directly about the election.
        rel = 0.0
        try:
            rel = float(analysis.get("election_relevance_0_1") or 0.0)
        except Exception:
            rel = 0.0
        if rel < 0.6:
            rsn = str(analysis.get("relevance_reason") or "low relevance").strip()
            print(f"   ->[DROP] Low election relevance ({rel:.2f}): {rsn[:64]}")
            return False

        bullets = analysis.get("bullets", []) if isinstance(analysis, dict) else []
        if not isinstance(bullets, list):
            bullets = []
        # Enforce conservative limits even if the model misbehaves.
        bullets = [str(x).strip() for x in bullets if str(x).strip()]
        bullets = bullets[:4]
        short_body = bullets[0] if bullets else "No summary available"
        c_id = analysis.get("constituency_id")
        if c_id not in valid_c_ids:
            c_id = None
        severity = analysis.get("severity", 1)

        coords = valid_india_coords(analysis.get("latitude"), analysis.get("longitude"))
        geo_c = float(analysis.get("geo_confidence") or 0)
        if coords and geo_c < 0.45:
            coords = None

        video_url = ""
        vq = (analysis.get("video_query") or "").strip()
        vid_rel = analysis.get("video_relevant") is True
        vid_conf = float(analysis.get("video_confidence") or 0)
        if (
            vid_rel
            and vid_conf >= 0.62
            and len(vq) > 3
            and (severity >= 2 or state_context == "Govt_Official")
        ):
            print(f"      -> Searching YouTube for: '{vq}' (conf={vid_conf:.2f})")
            video_url = fetch_youtube_video(vq)

        row = {
            "source": source_title,
            # Store canonical URL to ensure stable hard-dedupe across runs.
            "source_url": _canonical_url(source_url),
            "image_url": image_url,
            "video_url": video_url,
            "title": original_title,
            "body": short_body,
            "state": analysis.get("state"),
            "constituency_id": c_id,
            "severity": severity,
            "verified": analysis.get("verified", False) or (state_context == "Govt_Official"),
            "full_summary": bullets,
            "category": "official" if state_context == "Govt_Official" else "alert",
        }
        if coords:
            row["latitude"], row["longitude"] = coords[0], coords[1]

        if supabase:
            sb_insert("signals", row)
            print(f"   ->[SUCCESS] Saved | SEV-{severity}")
            return True
        return False
    except Exception as e:
        print(f"   ->[LLM/DB Error]: {e}")
        return False

def generate_ai_briefing():
    print("\n[+] Compiling Dynamic 24-Hour AI Briefing...")
    if not supabase:
        return
    if not gemini_client:
        print("   [briefing] skip: GEMINI_API_KEY / client missing")
        return
    if not _should_run_briefing_now():
        print(
            f"   [briefing] skip: interval ({SIGNAL_BRIEFING_INTERVAL_MINUTES}m) not elapsed "
            f"(set SIGNAL_BRIEFING_INTERVAL_MINUTES=0 for every ingest)"
        )
        return
    if not _llm_can_briefing():
        print(f"   [briefing] skip: daily LLM cap ({SIGNAL_LLM_MAX_PER_DAY}) reached")
        return

    twenty_four_hrs_ago = (datetime.now(IST) - timedelta(hours=24)).isoformat()
    recent_signals = sb_select(
        "signals",
        "title,body,state,severity,source,verified,created_at",
        filters={"created_at": f"gte.{twenty_four_hrs_ago}"},
        order="created_at.desc",
        limit=max(20, SIGNAL_BRIEFING_MAX_SIGNALS),
    )
    if not recent_signals or len(recent_signals) < 3:
        print("   -> Not enough data in the last 24h for a briefing.")
        return

    slim = []
    for s in recent_signals[:SIGNAL_BRIEFING_MAX_SIGNALS]:
        slim.append(
            {
                "title": (s.get("title") or "")[:140],
                "body": (s.get("body") or "")[:100],
                "state": s.get("state"),
                "severity": s.get("severity"),
                "source": (s.get("source") or "")[:80],
                "verified": s.get("verified"),
            }
        )

    hour = datetime.now(IST).hour
    time_of_day = "MORNING" if hour < 12 else "AFTERNOON" if hour < 18 else "EVENING"
    election_context = get_election_context()
    
    prompt = f"""
    You are a Chief Intelligence Officer. {election_context}
    Write a 7-point tactical briefing based ONLY on these signals from the last 24 hours.
    STRICT RULES:
    1. Maximum 15 words per body text. Be crisp and military style.
    2. Try to cover key developments in TN, WB, AS, KL, PY if data exists.
    3. Headings must be short, consistent, and actionable.
    
    Return pure JSON:[
      {{"heading": "National overview", "body": "…", "color_hex": "#16a34a"}},
      {{"heading": "Hotspots", "body": "…", "color_hex": "#dc2626"}},
      {{"heading": "Turnout / logistics", "body": "…", "color_hex": "#0284c7"}},
      {{"heading": "Violence / violations", "body": "…", "color_hex": "#ea580c"}},
      {{"heading": "Misinformation watch", "body": "…", "color_hex": "#a855f7"}},
      {{"heading": "Key actors", "body": "…", "color_hex": "#16a34a"}},
      {{"heading": "Next 24h watchlist", "body": "…", "color_hex": "#0284c7"}}
    ]
    Signals: {json.dumps(slim)}
    """
    global _last_briefing_ist
    try:
        _pace_gemini_call()
        response = gemini_client.models.generate_content(model=SIGNAL_GEMINI_MODEL, contents=prompt)
        _llm_record_briefing()
        text = response.text.strip()
        if text.startswith("```json"):
            text = text[7:-3].strip()
        paragraphs = json.loads(text)

        verified_count = sum(1 for s in recent_signals if s.get("verified"))
        unique_sources = len(set(s.get("source") for s in recent_signals))
        confidence = min(
            5,
            max(
                1,
                int((verified_count / len(recent_signals)) * 3) + (2 if unique_sources > 3 else 1),
            ),
        )

        sb_insert(
            "briefings",
            {
                "time_of_day": time_of_day,
                "paragraphs": paragraphs,
                "confidence_score": confidence,
                "sources_count": len(recent_signals),
            },
        )
        _last_briefing_ist = datetime.now(IST)
        print(f"   ->[SUCCESS] {time_of_day} Briefing saved (Conf: {confidence})!")
    except Exception as e:
        print(f"   ->[Briefing Error]: {e}")

def cleanup_old_signals():
    """NEW: Deletes signals older than 24 hours to keep the Map and DB extremely clean."""
    if not supabase: return
    try:
        twenty_four_hrs_ago = (datetime.now(IST) - timedelta(hours=24)).isoformat()
        deleted_count = sb_delete_lt("signals", "created_at", twenty_four_hrs_ago)
        print(f"[+] Garbage Collection: Cleared {deleted_count} expired signals from the map.")
    except Exception as e:
        print(f"   ->[Cleanup Error]: {e}")

def fetch_gdelt() -> list[dict]:
    """Fetch GDELT Doc 2.0 API for each election state. Rate limit: 1 call per 5 seconds."""
    articles = []
    now_utc = datetime.now(timezone.utc)
    lookback = max(1, int(SIGNAL_GDELT_LOOKBACK_HOURS or 24))
    start_utc = now_utc - timedelta(hours=lookback)
    # GDELT expects YYYYMMDDHHMMSS in UTC
    start_str = start_utc.strftime("%Y%m%d%H%M%S")
    end_str = now_utc.strftime("%Y%m%d%H%M%S")
    for state_context, query_phrase in GDELT_QUERIES.items():
        data = None
        backoff = 6
        for attempt in range(3):
            try:
                resp = requests.get(
                    "https://api.gdeltproject.org/api/v2/doc/doc",
                    params={
                        "query": query_phrase,
                        "mode": "artlist",
                        "maxrecords": 25,
                        "format": "json",
                        "sourcelang": "english",
                        "sourcecountry": "IN",
                        "startdatetime": start_str,
                        "enddatetime": end_str,
                    },
                    timeout=15,
                )
                resp.raise_for_status()
                data = resp.json()
                break
            except Exception as e:
                print(f"[GDELT] Attempt {attempt + 1} failed for {state_context}: {e}")
                time.sleep(backoff)
                backoff *= 2  # Exponential backoff: 6s → 12s → 24s
        if data is None:
            print(f"[GDELT] Skipping {state_context} after 3 failed attempts.")
            continue

        for article in (data.get("articles") or []):
            title = (article.get("title") or "").strip()
            url   = (article.get("url") or "").strip()
            if not title or not url:
                continue
            try:
                seen_date = datetime.strptime(
                    article.get("seendate", ""), "%Y%m%dT%H%M%SZ"
                ).replace(tzinfo=timezone.utc)
            except Exception:
                # Do not treat parse failures as "now" — that bypasses recency and lets stale rows in.
                continue

            # Secondary recency guard (in case upstream ignores the window).
            if not _is_recent_enough(seen_date, lookback):
                continue

            articles.append({
                "state_context": state_context,
                "title":         title,
                "url":           url,
                "source_title":  (article.get("domain") or "GDELT").strip(),
                "image_url":     (article.get("socialimage") or "").strip(),
                "seen_date":     seen_date,
            })

        time.sleep(6)  # Respect rate limit: 1 call per 5 seconds, using 6 to be safe

    return articles


def fetch_and_ingest():
    global _article_llm_run_count
    _article_llm_run_count = 0

    now_ist = datetime.now(IST).strftime('%Y-%m-%d %I:%M:%S %p')
    print(f"\n[{now_ist}] Waking up Advanced Signal Ingestor (IST)...")
    _llm_refresh_day()
    print(
        f"   [llm-config] model={SIGNAL_GEMINI_MODEL} free_tier_mode={SIGNAL_GEMINI_FREE_TIER} "
        f"gemini_min_interval_s={SIGNAL_GEMINI_MIN_INTERVAL_SEC} "
        f"max/run={SIGNAL_LLM_MAX_PER_RUN or '∞'} max/day={SIGNAL_LLM_MAX_PER_DAY or '∞'} day_used={_llm_day_total} "
        f"briefing_interval_min={SIGNAL_BRIEFING_INTERVAL_MINUTES or 'each cycle'} "
        f"briefing_signals={SIGNAL_BRIEFING_MAX_SIGNALS} kw_gate={'off' if SIGNAL_DISABLE_KEYWORD_GATE else 'on'}",
        flush=True,
    )
    print(
        f"   [recency] max_entry_age_h={SIGNAL_MAX_ENTRY_AGE_HOURS} require_today_ist={SIGNAL_REQUIRE_TODAY_IST} "
        f"allow_undated_rss={SIGNAL_ALLOW_UNDATED_RSS} gdelt_lookback_h={SIGNAL_GDELT_LOOKBACK_HOURS}",
        flush=True,
    )

    # Run garbage collection first
    cleanup_old_signals()
    
    valid_c_ids = [row.get("id") for row in sb_select("constituencies", "id", limit=2000)] if supabase else []
    valid_c_ids = [x for x in valid_c_ids if x]

    seen_titles: set[str] = set()
    seen_urls: set[str] = set()
    seen_uids: set[str] = set()
    # simhashes within a recent window to reduce near-duplicate noise
    recent_hashes: list[tuple[int, datetime]] = []
    if supabase:
        try:
            since = (datetime.now(IST) - timedelta(days=3)).isoformat()
            recent = sb_select(
                "signals",
                "title,body,source_url,created_at",
                filters={"created_at": f"gte.{since}"},
                order="created_at.desc",
                limit=1200,
            )
            for row in recent or []:
                if row.get("title"):
                    seen_titles.add(_norm_title(row["title"]))
                if row.get("source_url"):
                    cu = _canonical_url(row["source_url"])
                    if cu:
                        seen_urls.add(cu)
                        seen_uids.add(f"url:{cu}")
                created_at = row.get("created_at")
                try:
                    ts = datetime.fromisoformat(created_at.replace("Z", "+00:00")) if created_at else None
                except Exception:
                    ts = None
                if ts:
                    h = _simhash64(f"{row.get('title') or ''} {row.get('body') or ''}")
                    if h:
                        recent_hashes.append((h, ts))
        except Exception as e:
            print(f"   [dedupe] could not load recent signals: {e}")

    for state_name, url in FEEDS.items():
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries[:4]:
                title = entry.title
                link = entry.link or ""

                nt = _norm_title(title)
                cu = _canonical_url(link)
                yid = _extract_youtube_id(link)
                uid = f"yt:{yid}" if yid else (f"url:{cu}" if cu else "")

                if nt in seen_titles:
                    continue
                if uid and uid in seen_uids:
                    continue
                if cu and cu in seen_urls:
                    continue
                summary_html = getattr(entry, 'summary', '')
                source_name = getattr(entry.source, 'title', 'News') if hasattr(entry, 'source') else "News Network"
                
                search_text = title + " " + BeautifulSoup(summary_html, "html.parser").get_text(" ")
                if not _election_keyword_hit(search_text):
                    continue

                published_utc = _entry_published_dt(entry)
                if not _is_recent_enough(published_utc, SIGNAL_MAX_ENTRY_AGE_HOURS):
                    if published_utc is None and not SIGNAL_ALLOW_UNDATED_RSS:
                        print(f"   [rss-skip] undated: {title[:72]!r}")
                    continue

                print(f"-> Found: {title[:60]}...")
                full_text, image_url, final_url = extract_article_data(link, summary_html)
                final_cu = _canonical_url(final_url)
                final_yid = _extract_youtube_id(final_url)
                final_uid = f"yt:{final_yid}" if final_yid else (f"url:{final_cu}" if final_cu else uid)

                # Soft dedupe: near-duplicate guard within ~12 hours.
                now = datetime.now(timezone.utc)
                incoming_h = _simhash64(f"{title} {BeautifulSoup(summary_html, 'html.parser').get_text(' ')[:600]}")
                if incoming_h:
                    window_start = now - timedelta(hours=12)
                    for h, ts in recent_hashes[-600:]:
                        if ts < window_start:
                            continue
                        if _hamming64(incoming_h, h) <= 3:
                            # Near-duplicate of something recent — skip.
                            continue_flag = True
                            break
                    else:
                        continue_flag = False
                    if continue_flag:
                        continue

                # Hard dedupe: ensure we key by canonicalized final URL (post-redirects).
                if final_uid and final_uid in seen_uids:
                    continue
                if final_cu and final_cu in seen_urls:
                    continue

                if len(full_text) > 50:
                    ok = analyze_and_insert(source_name, final_url or link, title, full_text, image_url, state_name, valid_c_ids)
                    if ok:
                        seen_titles.add(nt)
                        if final_cu:
                            seen_urls.add(final_cu)
                            seen_uids.add(f"url:{final_cu}")
                        if final_uid:
                            seen_uids.add(final_uid)
                        if incoming_h:
                            recent_hashes.append((incoming_h, datetime.now(timezone.utc)))
                    
        except Exception: pass
        gc.collect()

    # --- GDELT ingestion ---
    if not SIGNAL_ENABLE_GDELT:
        print("\n[+] GDELT ingestion disabled (SIGNAL_ENABLE_GDELT=false).")
        gdelt_articles = []
    else:
        print("\n[+] Starting GDELT ingestion...")
        gdelt_articles = fetch_gdelt()
        print(
            f"   -> Fetched {len(gdelt_articles)} GDELT articles "
            f"(lookback={SIGNAL_GDELT_LOOKBACK_HOURS}h) across {len(GDELT_QUERIES)} states."
        )

    for article in gdelt_articles:
        try:
            title       = article["title"]
            link        = article["url"]
            state_name  = article["state_context"]
            source_name = article["source_title"]
            image_url   = article["image_url"]

            if not title or not link:
                continue

            nt  = _norm_title(title)
            cu  = _canonical_url(link)
            uid = f"url:{cu}" if cu else ""

            if nt in seen_titles: continue
            if uid and uid in seen_uids: continue
            if cu and cu in seen_urls: continue

            if not _election_keyword_hit(title):
                continue

            print(f"-> [GDELT] Found: {title[:60]}...")
            full_text, _, final_url = extract_article_data(link, "")
            final_cu  = _canonical_url(final_url)
            final_uid = f"url:{final_cu}" if final_cu else uid

            # Simhash near-duplicate check (title-only — GDELT has no body snippet)
            now = datetime.now(timezone.utc)
            incoming_h = _simhash64(title)
            if incoming_h:
                window_start = now - timedelta(hours=12)
                skip = False
                for h, ts in recent_hashes[-600:]:
                    if ts >= window_start and _hamming64(incoming_h, h) <= 3:
                        skip = True
                        break
                if skip:
                    continue

            if final_uid and final_uid in seen_uids: continue
            if final_cu and final_cu in seen_urls: continue

            if len(full_text) > 50:
                ok = analyze_and_insert(
                    source_name, final_url or link, title,
                    full_text, image_url, state_name, valid_c_ids,
                )
                if ok:
                    seen_titles.add(nt)
                    if final_cu:
                        seen_urls.add(final_cu)
                        seen_uids.add(f"url:{final_cu}")
                    if final_uid:
                        seen_uids.add(final_uid)
                    if incoming_h:
                        recent_hashes.append((incoming_h, now))
        except Exception: pass

    generate_ai_briefing()

if __name__ == "__main__":
    print("=== DHARMA-OSINT Verified AI News Pipeline ===")
    print(
        f"[llm] SIGNAL_GEMINI_MODEL={SIGNAL_GEMINI_MODEL} | SIGNAL_GEMINI_FREE_TIER={SIGNAL_GEMINI_FREE_TIER} | "
        f"SIGNAL_LLM_MAX_PER_RUN={SIGNAL_LLM_MAX_PER_RUN or 'unlimited'} | "
        f"SIGNAL_LLM_MAX_PER_DAY={SIGNAL_LLM_MAX_PER_DAY or 'unlimited'} | "
        f"SIGNAL_BRIEFING_INTERVAL_MINUTES={SIGNAL_BRIEFING_INTERVAL_MINUTES}",
        flush=True,
    )
    if not supabase:
        print("CRITICAL: Supabase offline.")

    if SIGNAL_RUN_ONCE:
        fetch_and_ingest()
        raise SystemExit(0)

    while True:
        fetch_and_ingest()
        time.sleep(1800)