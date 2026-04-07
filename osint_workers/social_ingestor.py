import hashlib
import json
import os
import re
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Any
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError

import feedparser
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from supabase import create_client, Client


IST = timezone(timedelta(hours=5, minutes=30))

env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
_loaded = load_dotenv(dotenv_path=env_path)
if not _loaded and not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
    print(f"WARN: dotenv did not load from {env_path} — export keys in the shell or fix the path.")

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
SUPABASE_ANON_KEY = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
SUPABASE_KEY = SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY

SOURCE_FILE = os.getenv("SOCIAL_SOURCES_FILE") or os.path.join(os.path.dirname(__file__), "social_sources.json")

SOCIAL_MAX_AGE_HOURS = int(os.getenv("SOCIAL_MAX_AGE_HOURS") or "24")
SOCIAL_LLM_MAX_CALLS = int(os.getenv("SOCIAL_LLM_MAX_CALLS") or "12")
SOCIAL_LLM_MODE = (os.getenv("SOCIAL_LLM_MODE") or "translate").lower()  # off|translate
SOCIAL_DEBUG = (os.getenv("SOCIAL_DEBUG") or "").lower() in ("1", "true", "yes")
SOCIAL_LLM_TIMEOUT_SEC = int(os.getenv("SOCIAL_LLM_TIMEOUT_SEC") or "15")

# Dedupe/versioning:
# v1 inserted raw channel titles. v2 applies recency+election filters and optional translation.
# We allow the same source_url to be processed once per pipeline_version.
PIPELINE_VERSION = os.getenv("SOCIAL_PIPELINE_VERSION") or f"social_v2_filter_en_{SOCIAL_MAX_AGE_HOURS}h"

# Try to enable low-cost translation when needed.
_llm_client = None
_llm_calls = 0
if SOCIAL_LLM_MODE != "off" and os.getenv("GEMINI_API_KEY"):
    try:
        from google import genai as _genai_mod

        _llm_client = _genai_mod.Client(api_key=os.getenv("GEMINI_API_KEY"))
    except Exception as _e:
        _llm_client = None


ELECTION_KEYWORDS_STRICT = [
    # election core
    "election",
    "poll",
    "polling",
    "vote",
    "voting",
    "turnout",
    "counting",
    "result",
    "results",
    "seat",
    "seats",
    "constituency",
    "booth",
    "evm",
    "mcc",
    "model code of conduct",
    "nomination",
    "candidate",
    "campaign",
    "rally",
    "manifesto",
    "alliance",
    "exit poll",
    "bypoll",
    "byelection",
    # india election authorities
    "election commission",
    "eci",
    "ceo",  # chief electoral officer (state)
]

# Party channels post lots of non-event content; keep it still election-focused,
# but allow common campaign language.
ELECTION_KEYWORDS_LOOSE = ELECTION_KEYWORDS_STRICT + [
    "roadshow",
    "public meeting",
    "press meet",
    "press conference",
    "speech",
    "address",
    "mcc violation",
]

# Obvious non-election / entertainment / bulletin noise (still matches loose keywords sometimes).
_SOCIAL_JUNK_RES = [
    re.compile(r"#\s*shorts\b", re.I),
    re.compile(r"\b9\s*pm\s*headlines\b", re.I),
    re.compile(r"\b\d{1,2}\s*pm\s*headlines\b", re.I),
    re.compile(r"\b\d{1,2}\s*am\s*headlines\b", re.I),
    re.compile(r"\bsslc\b", re.I),
    re.compile(r"\bclear\b.*\bsslc\b", re.I),
    re.compile(r"\bexam(?:ination)?\s+results?\b", re.I),
    re.compile(r"\bipl\b", re.I),
    re.compile(r"\bmumbai indians\b", re.I),
    re.compile(r"\bartemis\b", re.I),
    re.compile(r"chetak screen awards", re.I),
    re.compile(r"world health day", re.I),
    re.compile(r"\btrailer launch\b", re.I),
    re.compile(r"\bollywood\b", re.I),
    re.compile(r"iran energy", re.I),
    re.compile(r"iran.?israel", re.I),
    re.compile(r"\bmarunadan\b", re.I),
]


def _strip_youtube_channel_fluff(text: str) -> str:
    """Trim YouTube RSS summaries: channel description / social link dumps after the real blurb."""
    s = _norm_text(text)
    if not s:
        return s
    cut_at = len(s)
    triggers = (
        r"\bFollow us\b",
        r"\bSubscribe to\b",
        r"\bSubscribe\b",
        r"\bFor more videos\b",
        r"\bOfficial\s+YouTube\s+Account\b",
        r"https?://(?:www\.)?facebook\.com/",
        r"https?://(?:www\.)?twitter\.com/",
        r"https?://(?:www\.)?x\.com/",
        r"https?://(?:www\.)?instagram\.com/",
        r"https?://(?:www\.)?telegram\.me/",
    )
    for pat in triggers:
        m = re.search(pat, s, re.I)
        if m and m.start() < cut_at and m.start() > 24:
            cut_at = m.start()
    s = s[:cut_at].strip()
    return s[:900]


def _is_social_junk_text(text: str) -> bool:
    t = _norm_text(text).lower()
    if not t:
        return True
    for rx in _SOCIAL_JUNK_RES:
        if rx.search(t):
            return True
    return False


def _party_channel_noise(english_blob: str, kind: str) -> bool:
    """Party/official feeds: require a real election anchor; drop pure attack/consumer stunts."""
    if "media" in kind:
        return False
    t = _norm_text(english_blob).lower()
    strong = (
        "election",
        "poll",
        "polling",
        "vote",
        "voting",
        "assembly",
        "constituency",
        "sir",
        "electoral roll",
        "voter list",
        "nomination",
        "candidate",
        "manifesto",
        "mcc",
        "eci",
        "election commission",
        "exit poll",
        "silent period",
        "silence period",
        "campaign",
        "rally",
    )
    if not any(a in t for a in strong):
        return True
    soft = ("lpg", "cylinder", "gas price", "prachar mantri", "wood buyer", "crown ", "not a king", "i am not a king")
    hard = ("election", "poll", "polling", "vote", "assembly", "candidate", "nomination", "campaign", "rally", "manifesto", "constituency", "sir", "roll", "eci", "commission")
    if any(x in t for x in soft) and not any(x in t for x in hard):
        return True
    return False


def _norm_text(t: str) -> str:
    s = (t or "").strip()
    s = re.sub(r"\s+", " ", s)
    return s


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


def _content_hash(platform: str, handle: str, url: str, text: str) -> str:
    h = hashlib.sha256()
    h.update((platform or "").encode("utf-8"))
    h.update(b"\n")
    h.update((handle or "").encode("utf-8"))
    h.update(b"\n")
    h.update((_norm_url(url) or "").encode("utf-8"))
    h.update(b"\n")
    h.update((_norm_text(text) or "").encode("utf-8"))
    return h.hexdigest()


def _simhash64(text: str) -> int:
    """
    Small, dependency-free simhash implementation for cheap claim clustering.
    Not cryptographic; intended only for near-duplicate bucketing.
    """
    s = _norm_text(text).lower()
    if not s:
        return 0
    tokens = re.findall(r"[a-z0-9_]{2,}", s)
    if not tokens:
        return 0
    vec = [0] * 64
    for tok in tokens[:256]:
        hv = int(hashlib.md5(tok.encode("utf-8")).hexdigest(), 16)
        for i in range(64):
            bit = (hv >> i) & 1
            vec[i] += 1 if bit else -1
    out = 0
    for i, v in enumerate(vec):
        if v > 0:
            out |= (1 << i)
    return out


def _hamming64(a: int, b: int) -> int:
    return int((a ^ b).bit_count())


def _parse_ts_any(ts: str | None) -> datetime | None:
    s = (ts or "").strip()
    if not s:
        return None
    # Telegram: ISO datetime in <time datetime="...">
    try:
        if "T" in s and (s.endswith("Z") or "+" in s or "-" in s[10:]):
            return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        pass
    # RSS/Atom: RFC2822-ish
    try:
        return parsedate_to_datetime(s)
    except Exception:
        return None


def _is_recent(ts: str | None) -> bool:
    dt = _parse_ts_any(ts)
    if not dt:
        # If a feed doesn't provide a timestamp, be conservative and skip.
        return False
    if not dt.tzinfo:
        dt = dt.replace(tzinfo=timezone.utc)
    age = datetime.now(timezone.utc) - dt.astimezone(timezone.utc)
    return age <= timedelta(hours=SOCIAL_MAX_AGE_HOURS)


def _looks_non_english(text: str) -> bool:
    s = _norm_text(text)
    if not s:
        return False
    # Heuristic: if there are many non-latin chars, treat as non-English.
    non_ascii = sum(1 for ch in s if ord(ch) > 127)
    if non_ascii >= 6:
        return True
    # If letters are very low (mostly symbols/emoji), no need to translate.
    letters = sum(1 for ch in s if ("a" <= ch.lower() <= "z"))
    if letters < 6 and non_ascii == 0:
        return False
    # If contains common Indian-script ranges.
    if re.search(r"[\u0900-\u0D7F]", s):
        return True
    return False


def _matches_keywords(text: str, keywords: list[str]) -> bool:
    t = _norm_text(text).lower()
    return any(k in t for k in keywords)


def _translate_to_english(title: str, body: str) -> dict[str, Any] | None:
    global _llm_calls
    if not _llm_client or _llm_calls >= SOCIAL_LLM_MAX_CALLS:
        return None
    _llm_calls += 1
    prompt = f"""
You are an election OSINT assistant.

Task:
1) Detect the language of the input.
2) Translate into English (preserve names, places, and numbers).
3) Produce a short, factual one-line summary suitable for a feed that captures the *happening*, not just a paraphrase.
4) Propose compact tags (lowercase snake_case).

Return pure JSON (no markdown):
{{
  "lang": "xx",
  "english_title": "…",
  "english_summary": "…",
  "tags": ["mcc","rally","candidate_list","turnout","counting","results","violence","disinfo","manifesto","alliance"]
}}

Input title: {title}
Input text: {body}
"""
    def _call() -> dict[str, Any] | None:
        resp = _llm_client.models.generate_content(model="gemini-2.5-flash", contents=prompt)
        text = (resp.text or "").strip()
        if text.startswith("```json"):
            text = text[7:-3].strip()
        return json.loads(text)

    try:
        with ThreadPoolExecutor(max_workers=1) as ex:
            fut = ex.submit(_call)
            return fut.result(timeout=SOCIAL_LLM_TIMEOUT_SEC)
    except FuturesTimeoutError:
        return None
    except Exception:
        return None


def _load_sources() -> dict:
    with open(SOURCE_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def _make_supabase() -> Client | None:
    try:
        if not SUPABASE_URL or not SUPABASE_KEY:
            raise ValueError("Supabase URL or key missing.")
        return create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception as e:
        print(f"CRITICAL: Supabase offline: {e}")
        return None


def _recent_seen_urls(db: Client, window_hours: int = 72, pipeline_version: str | None = None) -> set[str]:
    since = (datetime.now(IST) - timedelta(hours=window_hours)).isoformat()
    seen: set[str] = set()
    try:
        res = (
            db.table("social_signals")
            .select("post_url,tags")
            .gte("created_at", since)
            .limit(4000)
            .execute()
        )
        for row in (res.data or []):
            u = row.get("post_url")
            if u:
                if pipeline_version:
                    ent = row.get("tags") or {}
                    pv = None
                    try:
                        pv = (ent or {}).get("pipeline_version")
                    except Exception:
                        pv = None
                    if pv != pipeline_version:
                        continue
                seen.add(_norm_url(u))
    except Exception as e:
        print(f"WARN: failed loading recent seen urls: {e}")
    return seen


def _insert_social(
    db: Client,
    *,
    platform: str,
    handle: str,
    post_url: str,
    title: str,
    body: str,
    english_title: str,
    english_summary: str,
    language: str,
    kind: str,
    tier: str,
    verified: bool,
    score: float,
    tags: dict,
    evidence: dict | None,
    image_url: str | None,
    video_url: str | None,
    content_hash: str,
    simhash64: int,
    published_at: datetime | None,
):
    row = {
        "platform": platform,
        "handle": handle,
        "post_url": post_url,
        "title": title,
        "body": body,
        "english_title": english_title,
        "english_summary": english_summary,
        "language": language,
        "kind": kind,
        "tier": tier,
        "verified": verified,
        "score": score,
        "tags": tags,
        "evidence": evidence,
        "image_url": image_url,
        "video_url": video_url,
        "content_hash": content_hash,
        "simhash64": simhash64,
        "published_at": (published_at.isoformat() if published_at else None),
    }
    db.table("social_signals").insert(row).execute()


def _telegram_scrape_public(handle: str) -> list[dict]:
    """
    Free, no-auth ingestion via https://t.me/s/<handle>.
    Note: This is best-effort HTML parsing, but works well for Tier-A channels.
    """
    url = f"https://t.me/s/{handle}"
    headers = {"User-Agent": "Mozilla/5.0"}
    r = requests.get(url, headers=headers, timeout=20, allow_redirects=True)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    msgs = []
    for m in soup.select(".tgme_widget_message_wrap"):
        link_el = m.select_one("a.tgme_widget_message_date")
        if not link_el:
            continue
        post_url = link_el.get("href") or ""
        time_el = link_el.select_one("time")
        ts = (time_el.get("datetime") if time_el else "") or ""

        text_el = m.select_one(".tgme_widget_message_text")
        text = text_el.get_text(" ", strip=True) if text_el else ""
        text = _norm_text(text)

        # Try to find a preview image
        img_url = None
        img = m.select_one(".tgme_widget_message_photo_wrap")
        if img and img.get("style"):
            # style contains background-image:url('...')
            st = img.get("style")
            mo = re.search(r"background-image:url\\('([^']+)'\\)", st or "")
            if mo:
                img_url = mo.group(1)

        # Try to find a video link (Telegram uses different DOM; best-effort)
        video_url = None
        vid = m.select_one("video")
        if vid and vid.get("src"):
            video_url = vid.get("src")

        msgs.append(
            {
                "platform": "telegram",
                "handle": handle,
                "title": (text.split(" — ")[0][:120] if text else f"TELEGRAM POST · {handle}"),
                "body": text[:500] if text else "",
                "source_url": post_url,
                "image_url": img_url,
                "video_url": video_url,
                "created_at_hint": ts,
            }
        )
    return msgs


def _youtube_rss(channel_id: str, handle: str) -> list[dict]:
    feed_url = f"https://www.youtube.com/feeds/videos.xml?channel_id={urllib.parse.quote(channel_id)}"
    feed = feedparser.parse(feed_url)
    items: list[dict] = []
    for e in (feed.entries or [])[:30]:
        link = (getattr(e, "link", "") or "").strip()
        title = _norm_text(getattr(e, "title", "") or "")
        summary = _norm_text(getattr(e, "summary", "") or "")
        published = getattr(e, "published", "") or ""
        thumb = None
        media = getattr(e, "media_thumbnail", None)
        if media and isinstance(media, list) and len(media) > 0:
            thumb = media[0].get("url")
        items.append(
            {
                "platform": "youtube",
                "handle": handle,
                "title": title[:160] if title else f"YOUTUBE · {handle}",
                "body": (summary or title)[:900] if (summary or title) else "",
                "source_url": link,
                "image_url": thumb,
                "video_url": link.replace("watch?v=", "embed/") if "watch?v=" in link else None,
                "created_at_hint": published,
            }
        )
    return items


def _happeningish(text: str) -> bool:
    t = _norm_text(text).lower()
    return any(
        w in t
        for w in [
            "announces",
            "announcement",
            "candidate list",
            "nominations",
            "manifesto",
            "rally",
            "roadshow",
            "public meeting",
            "campaign",
            "press conference",
            "mcc",
            "polling",
            "voting",
            "turnout",
            "counting",
            "results",
            "seat",
            "alliance",
        ]
    )


def _rss_fetch(url: str, handle: str) -> list[dict]:
    feed = feedparser.parse(url)
    out: list[dict] = []
    for e in (feed.entries or [])[:50]:
        link = (getattr(e, "link", "") or "").strip()
        title = _norm_text(getattr(e, "title", "") or "")
        summary = _norm_text(getattr(e, "summary", "") or "")
        published = getattr(e, "published", "") or ""
        out.append(
            {
                "platform": "rss",
                "handle": handle,
                "title": title[:160] if title else f"OFFICIAL UPDATE · {handle}",
                "body": (summary or title)[:500],
                "source_url": link,
                "image_url": None,
                "video_url": None,
                "created_at_hint": published,
            }
        )
    return out


def run_once():
    db = _make_supabase()
    if not db:
        return

    # Fail fast if the new table isn't created yet (avoid wasting time/LLM calls).
    try:
        db.table("social_signals").select("id").limit(1).execute()
    except Exception as e:
        print(
            "CRITICAL: social_signals table missing or not accessible. "
            "Create it in Supabase SQL editor, then rerun. "
            f"details={e}"
        )
        return

    sources = _load_sources()
    seen = _recent_seen_urls(db, window_hours=96, pipeline_version=PIPELINE_VERSION)

    inserted = 0
    scanned = 0

    skip_seen = 0
    skip_old = 0
    skip_no_ts = 0
    skip_not_election = 0
    skip_other = 0
    debug_samples: list[dict[str, Any]] = []

    # lightweight cluster index for this tick: {bucket_key: {simhash, evidence[]}}
    clusters: dict[str, dict] = {}

    # Telegram ingestion disabled for now (most Indian official sources are not on Telegram).

    # YouTube RSS Tier A
    for y in (sources.get("youtube_channels") or []):
        if not y.get("enabled"):
            continue
        channel_id = str(y.get("channel_id") or "").strip()
        handle = str(y.get("handle") or "").strip() or channel_id
        kind = str(y.get("kind") or "tier_a_official").strip()
        if not channel_id:
            continue
        try:
            items = _youtube_rss(channel_id, handle)
            for p in items[:30]:
                scanned += 1
                u = _norm_url(p["source_url"])
                if not u or u in seen:
                    skip_seen += 1
                    continue
                ts_hint = p.get("created_at_hint")
                if not ts_hint:
                    skip_no_ts += 1
                    if SOCIAL_DEBUG and len(debug_samples) < 12:
                        debug_samples.append({"reason": "no_ts", "src": handle, "title": p.get("title"), "ts": None})
                    continue
                if not _is_recent(ts_hint):
                    skip_old += 1
                    if SOCIAL_DEBUG and len(debug_samples) < 12:
                        debug_samples.append({"reason": "old", "src": handle, "title": p.get("title"), "ts": ts_hint})
                    continue

                dt_pub = _parse_ts_any(ts_hint)
                raw_title = p.get("title") or ""
                raw_body = _strip_youtube_channel_fluff(str(p.get("body") or ""))

                # Tweak #1: translate first (only if needed), then filter on English.
                lang = "en"
                eng_title = raw_title
                eng_summary = raw_body
                tag_list: list[str] = []
                if SOCIAL_LLM_MODE != "off" and (_looks_non_english(raw_title) or _looks_non_english(raw_body)):
                    tr = _translate_to_english(raw_title, raw_body)
                    if tr and tr.get("english_title"):
                        lang = str(tr.get("lang") or "und")
                        eng_title = str(tr.get("english_title") or raw_title).strip()
                        eng_summary = str(tr.get("english_summary") or raw_body).strip()
                        try:
                            tag_list = list(tr.get("tags") or [])
                        except Exception:
                            tag_list = []

                # Tweak #2: kind-aware relevance + “happening” heuristic for party channels
                raw_text_en = f"{eng_title} {eng_summary}"
                if "media" in kind:
                    if not _matches_keywords(raw_text_en, ELECTION_KEYWORDS_STRICT):
                        skip_not_election += 1
                        if SOCIAL_DEBUG and len(debug_samples) < 12:
                            debug_samples.append({"reason": "not_election", "src": handle, "title": eng_title[:140], "ts": ts_hint})
                        continue
                else:
                    if not (_matches_keywords(raw_text_en, ELECTION_KEYWORDS_LOOSE) or _happeningish(raw_text_en)):
                        skip_not_election += 1
                        if SOCIAL_DEBUG and len(debug_samples) < 12:
                            debug_samples.append({"reason": "not_election", "src": handle, "title": eng_title[:140], "ts": ts_hint})
                        continue

                if _is_social_junk_text(raw_text_en):
                    skip_not_election += 1
                    if SOCIAL_DEBUG and len(debug_samples) < 12:
                        debug_samples.append({"reason": "junk_pattern", "src": handle, "title": eng_title[:140], "ts": ts_hint})
                    continue
                if _party_channel_noise(raw_text_en, kind):
                    skip_not_election += 1
                    if SOCIAL_DEBUG and len(debug_samples) < 12:
                        debug_samples.append({"reason": "party_noise", "src": handle, "title": eng_title[:140], "ts": ts_hint})
                    continue

                # Smart decision: ensure summary is about the “happening”.
                final_title = _norm_text(eng_title)[:180]
                final_summary = _norm_text(eng_summary)[:500]
                if SOCIAL_LLM_MODE != "off" and _llm_client and _llm_calls < SOCIAL_LLM_MAX_CALLS:
                    if len(final_summary) < 40 or final_summary.lower().strip() == final_title.lower().strip():
                        tr2 = _translate_to_english(final_title, final_summary)
                        if tr2 and tr2.get("english_title"):
                            final_title = _norm_text(str(tr2.get("english_title") or final_title))[:180]
                            final_summary = _norm_text(str(tr2.get("english_summary") or final_summary))[:500]
                            try:
                                tag_list = tag_list or list(tr2.get("tags") or [])
                            except Exception:
                                pass

                content_hash = _content_hash("youtube", handle, p["source_url"], raw_title + " " + raw_body)
                simh = _simhash64(final_title + " " + final_summary)
                score = 0.78 if "media" in kind else 0.88
                if _happeningish(final_title + " " + final_summary):
                    score = min(0.95, score + 0.06)

                tags_obj = {
                    "pipeline_version": PIPELINE_VERSION,
                    "tags": tag_list[:12],
                }

                _insert_social(
                    db,
                    platform="youtube",
                    handle=handle,
                    post_url=p["source_url"],
                    title=raw_title[:180],
                    body=raw_body[:900],
                    english_title=final_title,
                    english_summary=final_summary,
                    language=lang,
                    kind=kind,
                    tier="A",
                    verified=True,
                    score=score,
                    tags=tags_obj,
                    evidence=None,
                    image_url=p.get("image_url"),
                    video_url=p.get("video_url"),
                    content_hash=content_hash,
                    simhash64=simh,
                    published_at=dt_pub,
                )
                seen.add(u)
                inserted += 1
        except Exception as e:
            skip_other += 1
            print(f"[youtube] {handle}: {e}")

    # RSS Tier A
    for f in (sources.get("rss_feeds") or []):
        if not f.get("enabled"):
            continue
        url = str(f.get("url") or "").strip()
        handle = str(f.get("handle") or "").strip() or url
        kind = str(f.get("kind") or "tier_a_official").strip()
        if not url:
            continue
        try:
            items = _rss_fetch(url, handle)
            for p in items[:40]:
                scanned += 1
                u = _norm_url(p["source_url"])
                if not u or u in seen:
                    skip_seen += 1
                    continue
                ts_hint = p.get("created_at_hint")
                if not ts_hint:
                    skip_no_ts += 1
                    if SOCIAL_DEBUG and len(debug_samples) < 12:
                        debug_samples.append({"reason": "no_ts", "src": handle, "title": p.get("title"), "ts": None})
                    continue
                if not _is_recent(ts_hint):
                    skip_old += 1
                    if SOCIAL_DEBUG and len(debug_samples) < 12:
                        debug_samples.append({"reason": "old", "src": handle, "title": p.get("title"), "ts": ts_hint})
                    continue

                dt_pub = _parse_ts_any(ts_hint)
                raw_title = p.get("title") or ""
                raw_body = _strip_youtube_channel_fluff(str(p.get("body") or ""))

                lang = "en"
                eng_title = raw_title
                eng_summary = raw_body
                tag_list = []
                if SOCIAL_LLM_MODE != "off" and (_looks_non_english(raw_title) or _looks_non_english(raw_body)):
                    tr = _translate_to_english(raw_title, raw_body)
                    if tr and tr.get("english_title"):
                        lang = str(tr.get("lang") or "und")
                        eng_title = str(tr.get("english_title") or raw_title).strip()
                        eng_summary = str(tr.get("english_summary") or raw_body).strip()
                        try:
                            tag_list = list(tr.get("tags") or [])
                        except Exception:
                            tag_list = []

                raw_text_en = f"{eng_title} {eng_summary}"
                if "media" in kind:
                    if not _matches_keywords(raw_text_en, ELECTION_KEYWORDS_STRICT):
                        skip_not_election += 1
                        if SOCIAL_DEBUG and len(debug_samples) < 12:
                            debug_samples.append({"reason": "not_election", "src": handle, "title": eng_title[:140], "ts": ts_hint})
                        continue
                else:
                    if not (_matches_keywords(raw_text_en, ELECTION_KEYWORDS_LOOSE) or _happeningish(raw_text_en)):
                        skip_not_election += 1
                        if SOCIAL_DEBUG and len(debug_samples) < 12:
                            debug_samples.append({"reason": "not_election", "src": handle, "title": eng_title[:140], "ts": ts_hint})
                        continue

                if _is_social_junk_text(raw_text_en):
                    skip_not_election += 1
                    if SOCIAL_DEBUG and len(debug_samples) < 12:
                        debug_samples.append({"reason": "junk_pattern", "src": handle, "title": eng_title[:140], "ts": ts_hint})
                    continue
                if _party_channel_noise(raw_text_en, kind):
                    skip_not_election += 1
                    if SOCIAL_DEBUG and len(debug_samples) < 12:
                        debug_samples.append({"reason": "party_noise", "src": handle, "title": eng_title[:140], "ts": ts_hint})
                    continue

                final_title = _norm_text(eng_title)[:180]
                final_summary = _norm_text(eng_summary)[:500]
                if SOCIAL_LLM_MODE != "off" and _llm_client and _llm_calls < SOCIAL_LLM_MAX_CALLS:
                    if len(final_summary) < 40 or final_summary.lower().strip() == final_title.lower().strip():
                        tr2 = _translate_to_english(final_title, final_summary)
                        if tr2 and tr2.get("english_title"):
                            final_title = _norm_text(str(tr2.get("english_title") or final_title))[:180]
                            final_summary = _norm_text(str(tr2.get("english_summary") or final_summary))[:500]
                            try:
                                tag_list = tag_list or list(tr2.get("tags") or [])
                            except Exception:
                                pass

                content_hash = _content_hash("rss", handle, p["source_url"], raw_title + " " + raw_body)
                simh = _simhash64(final_title + " " + final_summary)
                score = 0.78 if "media" in kind else 0.88
                if _happeningish(final_title + " " + final_summary):
                    score = min(0.95, score + 0.06)

                tags_obj = {
                    "pipeline_version": PIPELINE_VERSION,
                    "tags": tag_list[:12],
                }

                _insert_social(
                    db,
                    platform="rss",
                    handle=handle,
                    post_url=p["source_url"],
                    title=raw_title[:180],
                    body=raw_body[:900],
                    english_title=final_title,
                    english_summary=final_summary,
                    language=lang,
                    kind=kind,
                    tier="A",
                    verified=True,
                    score=score,
                    tags=tags_obj,
                    evidence=None,
                    image_url=None,
                    video_url=None,
                    content_hash=content_hash,
                    simhash64=simh,
                    published_at=dt_pub,
                )
                seen.add(u)
                inserted += 1
        except Exception as e:
            skip_other += 1
            print(f"[rss] {handle}: {e}")

    print(
        f"[social_ingestor] inserted={inserted} scanned={scanned} "
        f"skip_seen={skip_seen} skip_old={skip_old} skip_no_ts={skip_no_ts} skip_not_election={skip_not_election} skip_other={skip_other} "
        f"llm_calls={_llm_calls}/{SOCIAL_LLM_MAX_CALLS} max_age_h={SOCIAL_MAX_AGE_HOURS}"
    )
    if SOCIAL_DEBUG and debug_samples:
        print("[social_ingestor] debug_samples:")
        for s in debug_samples:
            # Windows consoles can choke on emoji; print ASCII-safe.
            t = str(s.get("title") or "").encode("ascii", errors="replace").decode("ascii", errors="replace")
            src = str(s.get("src") or "").encode("ascii", errors="replace").decode("ascii", errors="replace")
            ts = str(s.get("ts") or "")
            print(f"  - {s.get('reason')}: {src} | {ts} | {t}")


def main():
    interval_sec = int(os.getenv("SOCIAL_INGEST_INTERVAL_SEC") or "300")
    once = (os.getenv("SOCIAL_INGEST_ONCE") or "").lower() in ("1", "true", "yes")
    if once:
        run_once()
        return
    while True:
        now_ist = datetime.now(IST).strftime("%Y-%m-%d %I:%M:%S %p")
        print(f"\n[{now_ist}] social_ingestor tick...")
        try:
            run_once()
        except Exception as e:
            print(f"[social_ingestor] tick error: {e}")
        time.sleep(interval_sec)


if __name__ == "__main__":
    main()

