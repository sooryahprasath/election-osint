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
from datetime import datetime, timedelta, timezone
from google import genai
from googleapiclient.discovery import build
from dotenv import load_dotenv
from supabase import create_client, Client

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

gemini_client = genai.Client(api_key=GEMINI_API_KEY)
youtube = build('youtube', 'v3', developerKey=YOUTUBE_API_KEY) if YOUTUBE_API_KEY else None

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
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
except Exception as e:
    print(f"CRITICAL: Supabase offline: {e}")
    supabase = None

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
        
    return full_text[:3000], image_url, final_url


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
    election_context = get_election_context()
    
    prompt = f"""
    You are a strictly accurate Election OSINT engine. {election_context}
    Analyze this news article: Title: {original_title} Body: {full_text}

    Return pure JSON (No markdown):
    {{
        "state": "{state_context.replace('_', ' ')}",
        "constituency_id": "Blank if unknown, else exact internal ID from context if inferable",
        "severity": 1 to 5 integer (4 or 5 for extreme physical violence or major fraud only),
        "verified": true or false,
        "bullets": ["Bullet 1", "Bullet 2", "Bullet 3"],
        "latitude": null or decimal degrees if the text implies a specific town/venue in India,
        "longitude": null or decimal degrees (must pair with latitude),
        "geo_confidence": 0.0 to 1.0 how sure you are about lat/long (0 if omitted),
        "video_relevant": true only if a TV news clip or official rally video likely exists that matches THIS exact story; false for generic opinion, pure text, or when unsure,
        "video_confidence": 0.0 to 1.0 confidence that a matching video exists,
        "video_query": "Short 3-6 word YouTube search ONLY if video_relevant is true; else empty string"
    }}
    Rules: Never guess lat/long from state alone. If video_relevant is false, video_query must be "".
    """
    try:
        response = gemini_client.models.generate_content(model='gemini-2.5-flash', contents=prompt)
        text = response.text.strip()
        if text.startswith("```json"): text = text[7:-3].strip()
        analysis = json.loads(text)
        
        short_body = analysis.get("bullets", ["No summary available"])[0]
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
            "full_summary": analysis.get("bullets", []),
            "category": "official" if state_context == "Govt_Official" else "alert",
        }
        if coords:
            row["latitude"], row["longitude"] = coords[0], coords[1]

        if supabase:
            supabase.table("signals").insert(row).execute()
            print(f"   ->[SUCCESS] Saved | SEV-{severity}")
            return True
        return False
    except Exception as e:
        print(f"   ->[LLM/DB Error]: {e}")
        return False

def generate_ai_briefing():
    print("\n[+] Compiling Dynamic 24-Hour AI Briefing...")
    if not supabase: return
    
    twenty_four_hrs_ago = (datetime.now(IST) - timedelta(hours=24)).isoformat()
    
    res = supabase.table("signals").select("title, body, state, severity, source, verified") \
          .gte("created_at", twenty_four_hrs_ago) \
          .order("created_at", desc=True).limit(20).execute()
          
    recent_signals = res.data
    if not recent_signals or len(recent_signals) < 3: 
        print("   -> Not enough data in the last 24h for a briefing.")
        return

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
    Signals: {json.dumps(recent_signals)}
    """
    try:
        response = gemini_client.models.generate_content(model='gemini-2.5-flash', contents=prompt)
        text = response.text.strip()
        if text.startswith("```json"): text = text[7:-3].strip()
        paragraphs = json.loads(text)
        
        verified_count = sum(1 for s in recent_signals if s.get('verified'))
        unique_sources = len(set(s.get('source') for s in recent_signals))
        confidence = min(5, max(1, int((verified_count / len(recent_signals)) * 3) + (2 if unique_sources > 3 else 1)))
        
        supabase.table("briefings").insert({
            "time_of_day": time_of_day,
            "paragraphs": paragraphs,
            "confidence_score": confidence,
            "sources_count": len(recent_signals)
        }).execute()
        print(f"   ->[SUCCESS] {time_of_day} Briefing saved (Conf: {confidence})!")
    except Exception as e: print(f"   ->[Briefing Error]: {e}")

def cleanup_old_signals():
    """NEW: Deletes signals older than 24 hours to keep the Map and DB extremely clean."""
    if not supabase: return
    try:
        twenty_four_hrs_ago = (datetime.now(IST) - timedelta(hours=24)).isoformat()
        res = supabase.table("signals").delete().lt("created_at", twenty_four_hrs_ago).execute()
        deleted_count = len(res.data) if res.data else 0
        print(f"[+] Garbage Collection: Cleared {deleted_count} expired signals from the map.")
    except Exception as e:
        print(f"   ->[Cleanup Error]: {e}")

def fetch_and_ingest():
    now_ist = datetime.now(IST).strftime('%Y-%m-%d %I:%M:%S %p')
    print(f"\n[{now_ist}] Waking up Advanced Signal Ingestor (IST)...")
    
    # Run garbage collection first
    cleanup_old_signals()
    
    valid_c_ids = [row["id"] for row in supabase.table("constituencies").select("id").execute().data] if supabase else[]

    seen_titles: set[str] = set()
    seen_urls: set[str] = set()
    seen_uids: set[str] = set()
    # simhashes within a recent window to reduce near-duplicate noise
    recent_hashes: list[tuple[int, datetime]] = []
    if supabase:
        try:
            since = (datetime.now(IST) - timedelta(days=3)).isoformat()
            recent = (
                supabase.table("signals")
                .select("title,body,source_url,created_at")
                .gte("created_at", since)
                .limit(1200)
                .execute()
            )
            for row in recent.data or []:
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
                
                search_text = (title + " " + summary_html).lower()
                keywords =["election", "poll", "vote", "congress", "bjp", "cpi", "tmc", "dmk", "rally", "clash", "eci", "candidate", "voter"]
                
                if not any(k in search_text for k in keywords):
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

    generate_ai_briefing()

if __name__ == "__main__":
    print("=== DHARMA-OSINT Verified AI News Pipeline ===")
    if not supabase: print("CRITICAL: Supabase offline.")
    
    while True:
        fetch_and_ingest()
        time.sleep(1800)