"""
DHARMA-OSINT — Opinion Poll Ingestor
Scrapes news articles about pre-election opinion polls/surveys for the 2026
Indian state elections and stores structured results in the opinion_polls table.

Sources: Google News RSS (opinion poll search terms) + GDELT Doc 2.0 API
LLM:     Gemini 2.5 Flash — extracts agency, state, party percentages, etc.
         Uses GEMINI_API_KEY if set, otherwise Vertex AI (Application Default Credentials).
Dedup:   Canonical URL within a 7-day window
Cadence: Once per hour (3600s sleep)

Run with: PYTHONUTF8=1 python osint_workers/poll_ingestor.py
"""

import asyncio
import feedparser
import gc
import json
import os
import re
import requests
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
from google import genai
from googlenewsdecoder import new_decoderv1
from crawl4ai import AsyncWebCrawler
from supabase import create_client, Client

# --- Init ---
env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
_loaded = load_dotenv(dotenv_path=env_path)
if not _loaded and not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
    print(f"WARN: dotenv did not load from {env_path} — export keys or fix the path.")

SUPABASE_URL             = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
SUPABASE_ANON_KEY        = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
SUPABASE_KEY             = SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY
GEMINI_API_KEY           = os.getenv("GEMINI_API_KEY")
GOOGLE_CLOUD_PROJECT     = os.getenv("GOOGLE_CLOUD_PROJECT")

# Gemini client — prefers API key if set, falls back to Vertex AI (GCP ADC).
# To use Vertex AI: run `gcloud auth application-default login` and set GOOGLE_CLOUD_PROJECT.
if GEMINI_API_KEY:
    gemini_client = genai.Client(api_key=GEMINI_API_KEY)
    print("[gemini] Using API key.")
else:
    gemini_client = genai.Client(
        vertexai=True,
        project=GOOGLE_CLOUD_PROJECT,
        location="us-central1",
    )
    print("[gemini] Using Vertex AI (Application Default Credentials).")

try:
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise ValueError("Supabase URL or key missing.")
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    print(f"[supabase] Connected. service_key_present={bool(SUPABASE_SERVICE_ROLE_KEY)}")
    if not SUPABASE_SERVICE_ROLE_KEY:
        print("WARN: No service role key — INSERT into opinion_polls will fail under RLS.")
except Exception as e:
    print(f"CRITICAL: Supabase offline: {e}")
    supabase = None

IST = timezone(timedelta(hours=5, minutes=30))

# --- Feed Config ---
POLL_FEEDS = {
    "Tamil_Nadu":  "https://news.google.com/rss/search?q=Tamil+Nadu+opinion+poll+survey+2026+when:14d&hl=en-IN&gl=IN&ceid=IN:en",
    "Kerala":      "https://news.google.com/rss/search?q=Kerala+opinion+poll+survey+2026+when:14d&hl=en-IN&gl=IN&ceid=IN:en",
    "West_Bengal": "https://news.google.com/rss/search?q=West+Bengal+opinion+poll+survey+2026+when:14d&hl=en-IN&gl=IN&ceid=IN:en",
    "Assam":       "https://news.google.com/rss/search?q=Assam+opinion+poll+survey+2026+when:14d&hl=en-IN&gl=IN&ceid=IN:en",
    "Puducherry":  "https://news.google.com/rss/search?q=Puducherry+opinion+poll+survey+2026+when:14d&hl=en-IN&gl=IN&ceid=IN:en",
}

GDELT_POLL_QUERIES = {
    "Tamil_Nadu":  "Tamil Nadu opinion poll survey 2026",
    "Kerala":      "Kerala opinion poll survey 2026",
    "West_Bengal": "West Bengal opinion poll survey 2026",
    "Assam":       "Assam opinion poll survey 2026",
    "Puducherry":  "Puducherry opinion poll survey 2026",
}

# Keywords that must appear in the title/body for a poll article to pass filtering
POLL_KEYWORDS = [
    "opinion poll", "survey", "cvoter", "c-voter", "axis my india",
    "lokniti", "ipsos", "etg", "p-marq", "seats", "vote share",
    "seat prediction", "poll prediction", "projected", "predicted",
]

# --- URL / Title helpers (same logic as signal_ingestor) ---
_TRACKING_QUERY_KEYS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "utm_id", "utm_name", "gclid", "dclid", "fbclid", "igshid",
    "mc_cid", "mc_eid", "ref", "referrer", "ref_src", "source",
    "src", "cmpid", "cmp", "mkt_tok", "spm", "_ga", "ocid",
}


def _canonical_url(u: str) -> str:
    raw = (u or "").strip()
    if not raw:
        return ""
    try:
        p = urllib.parse.urlparse(raw)
        scheme = (p.scheme or "https").lower()
        netloc = (p.netloc or "").lower()
        if not netloc and "://" not in raw:
            p = urllib.parse.urlparse("https://" + raw)
            scheme, netloc = p.scheme.lower(), p.netloc.lower()
        if netloc.endswith(":80") and scheme == "http":
            netloc = netloc[:-3]
        if netloc.endswith(":443") and scheme == "https":
            netloc = netloc[:-4]
        if netloc.startswith("www."):
            netloc = netloc[4:]
        path = re.sub(r"/{2,}", "/", (p.path or "").strip())
        if path != "/":
            path = path.rstrip("/")
        q = [(k.lower(), v) for k, v in urllib.parse.parse_qsl(p.query or "", keep_blank_values=False)
             if k.lower() not in _TRACKING_QUERY_KEYS and k]
        q.sort()
        return urllib.parse.urlunparse((scheme, netloc, path, "", urllib.parse.urlencode(q, doseq=True), ""))
    except Exception:
        return raw.lower()


def _norm_title(t: str) -> str:
    return " ".join((t or "").strip().lower().split())


# --- Google News URL decoder ---
def _decode_google_news_url(url: str) -> str:
    """Decode Google News proxy URL to the real article URL."""
    if "news.google.com" not in url:
        return url
    try:
        result = new_decoderv1(url)
        if result.get("status") and result.get("decoded_url"):
            return result["decoded_url"]
    except Exception:
        pass
    return url


# --- Article scraper ---
async def _scrape_article_async(url: str) -> str:
    """Use headless browser to scrape article text. Returns article body."""
    try:
        async with AsyncWebCrawler() as crawler:
            result = await crawler.arun(url)
            md = result.markdown or ""
            if len(md) < 100:
                return ""
            # Skip navigation junk — find the first markdown heading (article start)
            heading_idx = md.find("\n# ")
            if heading_idx > 0:
                md = md[heading_idx:]
            return md[:5000]
    except Exception:
        pass
    return ""


def _scrape_article(url: str, fallback_html: str = "") -> str:
    """Decode Google News URL, then scrape with headless browser."""
    real_url = _decode_google_news_url(url)

    # Try crawl4ai first (headless browser -- handles JS sites)
    try:
        text = asyncio.run(_scrape_article_async(real_url))
        if len(text) > 100:
            return text
    except Exception:
        pass

    # Fallback: basic requests (works for simple sites / GDELT direct URLs)
    try:
        headers = {"User-Agent": "Mozilla/5.0 (compatible; DharmaOSINT/1.0)"}
        resp = requests.get(real_url, headers=headers, timeout=12, allow_redirects=True)
        from bs4 import BeautifulSoup
        soup_text = " ".join(
            p.get_text(separator=" ", strip=True)
            for p in BeautifulSoup(resp.content, "html.parser").find_all("p")
        )
        if len(soup_text) > 100:
            return soup_text[:3000]
    except Exception:
        pass

    # Last resort: RSS summary
    if fallback_html:
        try:
            from bs4 import BeautifulSoup
            return BeautifulSoup(fallback_html, "html.parser").get_text(separator=" ")[:3000]
        except Exception:
            pass
    return ""


# --- Gemini extraction ---
GEMINI_MODEL = "gemini-2.5-flash"

def _extract_poll_data(article_text: str, state_context: str) -> dict | None:
    """
    Ask Gemini to extract structured poll data from article text.
    Returns a dict or None if extraction fails / confidence too low.
    """
    state_display = state_context.replace("_", " ")
    prompt = f"""You are an election OSINT engine extracting opinion poll data from Indian news articles.

Article text (may be truncated):
---
{article_text[:2500]}
---

State context: {state_display}

Extract ONLY data explicitly stated in the article. Return pure JSON with no markdown fences:
{{
  "agency": "Poll agency name (e.g. 'C-VOTER', 'Axis My India', 'Lokniti-CSDS', 'Times Now-ETG', 'News18-IPSOS'), or null if not stated",
  "state": "{state_display}",
  "party_a_name": "First/leading party name (e.g. 'DMK', 'AITC', 'BJP'), or null",
  "party_a_percentage": Vote share % as float (0-100) if explicitly stated, else null,
  "party_b_name": "Second party name, or null",
  "party_b_percentage": Vote share % as float (0-100) if explicitly stated, else null,
  "others_percentage": Combined others % as float if stated, else null,
  "undecided_percentage": Undecided/don't know % if stated, else null,
  "publish_date": "YYYY-MM-DD of poll publication if stated, else null",
  "sample_size": Integer sample size if stated (typically 1000-10000), else null,
  "methodology": "e.g. 'phone survey', 'face-to-face', 'online panel', or empty string",
  "confidence": Float 0.0-1.0 — how confident you are this article contains real poll numbers
}}

Rules:
- NEVER invent or estimate percentages. Only use explicit numbers from the text.
- Percentages (party_a + party_b + others + undecided) should roughly sum to 100% (±10% tolerance).
- If the article only discusses polls vaguely without numbers, set confidence below 0.5.
- Focus on 2026 Assembly election polls, not Lok Sabha.
- If multiple polls are mentioned, extract the most prominent one."""

    try:
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as _ex:
            _fut = _ex.submit(gemini_client.models.generate_content, model=GEMINI_MODEL, contents=prompt)
            response = _fut.result(timeout=30)
        text = response.text.strip()
        if text.startswith("```json"):
            text = text[7:-3].strip()
        elif text.startswith("```"):
            text = text[3:].strip()
            if text.endswith("```"):
                text = text[:-3].strip()
        return json.loads(text)
    except Exception as e:
        print(f"   [Gemini Error]: {e}")
        return None


# --- Supabase insert ---
def _insert_poll(data: dict, source_url: str) -> bool:
    if not supabase or not data:
        return False
    row = {
        "state":                 data.get("state"),
        "agency":                data.get("agency"),
        "publish_date":          data.get("publish_date"),
        "sample_size":           data.get("sample_size"),
        "party_a_name":          data.get("party_a_name"),
        "party_a_percentage":    data.get("party_a_percentage"),
        "party_b_name":          data.get("party_b_name"),
        "party_b_percentage":    data.get("party_b_percentage"),
        "others_percentage":     data.get("others_percentage"),
        "undecided_percentage":  data.get("undecided_percentage"),
        "source_url":            _canonical_url(source_url),
        "confidence_score":      data.get("confidence", 0.0),
        "verified":              False,
    }
    try:
        supabase.table("opinion_polls").insert(row).execute()
        agency = data.get("agency") or "Unknown agency"
        state  = data.get("state") or "?"
        print(f"   -> [SUCCESS] Saved poll — {agency} / {state}")
        return True
    except Exception as e:
        print(f"   -> [DB Error]: {e}")
        return False


# --- GDELT fetch (same pattern as signal_ingestor) ---
def _fetch_gdelt_polls() -> list[dict]:
    articles = []
    for state_context, query_phrase in GDELT_POLL_QUERIES.items():
        data = None
        backoff = 6
        for attempt in range(3):
            try:
                resp = requests.get(
                    "https://api.gdeltproject.org/api/v2/doc/doc",
                    params={
                        "query":         query_phrase,
                        "mode":          "artlist",
                        "maxrecords":    15,
                        "format":        "json",
                        "sourcelang":    "english",
                        "sourcecountry": "IN",
                    },
                    timeout=15,
                )
                resp.raise_for_status()
                data = resp.json()
                break
            except Exception as e:
                print(f"[GDELT] Attempt {attempt + 1} failed for {state_context}: {e}")
                time.sleep(backoff)
                backoff *= 2
        if data is None:
            print(f"[GDELT] Skipping {state_context} after 3 failed attempts.")
            continue
        for article in (data.get("articles") or []):
            title = (article.get("title") or "").strip()
            url   = (article.get("url") or "").strip()
            if title and url:
                articles.append({
                    "state_context": state_context,
                    "title":         title,
                    "url":           url,
                    "source_title":  (article.get("domain") or "GDELT").strip(),
                })
        time.sleep(6)
    return articles


# --- Main ingest cycle ---
def fetch_and_ingest():
    now_ist = datetime.now(IST).strftime("%Y-%m-%d %I:%M:%S %p")
    print(f"\n[{now_ist}] Opinion Poll Ingestor waking up (IST)...")

    # Build dedup sets from last 7 days
    seen_urls: set[str] = set()
    seen_titles: set[str] = set()
    seen_polls: set[tuple] = set()  # (agency_lower, state_lower, party_a_pct) — prevents same survey from multiple articles
    if supabase:
        try:
            since = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
            res = supabase.table("opinion_polls").select("source_url,agency,state,party_a_percentage").gte("created_at", since).limit(500).execute()
            for row in (res.data or []):
                u = row.get("source_url")
                if u:
                    seen_urls.add(_canonical_url(u))
                agency = (row.get("agency") or "").strip().lower()
                state  = (row.get("state")  or "").strip().lower()
                pct    = row.get("party_a_percentage")
                if agency and state and pct is not None:
                    seen_polls.add((agency, state, pct))
            print(f"   -> Loaded {len(seen_urls)} known URLs and {len(seen_polls)} known polls from last 7 days.")
        except Exception as e:
            print(f"   [Dedup] Could not load recent polls: {e}")

    saved = 0

    # --- RSS feeds ---
    print("\n[+] Scanning RSS feeds for opinion poll articles...")
    for feed_name, feed_url in POLL_FEEDS.items():
        try:
            feed = feedparser.parse(feed_url)
            state_display = feed_name.replace("_", " ")
            for entry in feed.entries[:5]:
                title   = (getattr(entry, "title", "") or "").strip()
                link    = (getattr(entry, "link",  "") or "").strip()
                summary = (getattr(entry, "summary", "") or "")

                if not title or not link:
                    continue

                nt = _norm_title(title)
                cu = _canonical_url(link)
                cu_decoded = _canonical_url(_decode_google_news_url(link))

                if nt in seen_titles or cu in seen_urls or cu_decoded in seen_urls:
                    continue

                # Quick filter — must look poll-related
                search_text = (title + " " + summary).lower()
                if not any(kw in search_text for kw in POLL_KEYWORDS):
                    continue

                print(f"-> [RSS/{feed_name}] {title[:70]}...")
                real_url = _decode_google_news_url(link)
                article_text = _scrape_article(link, summary)
                if len(article_text) < 80:
                    continue

                data = _extract_poll_data(article_text, feed_name)
                if not data:
                    continue
                if data.get("confidence", 0) < 0.6:
                    print(f"   -> Skipped (confidence={data.get('confidence', 0):.2f} < 0.6)")
                    continue
                if not data.get("agency") or not data.get("party_a_name"):
                    print(f"   -> Skipped (missing agency or party data)")
                    continue
                if data.get("party_a_percentage") is None and data.get("party_b_percentage") is None:
                    print(f"   -> Skipped (no percentages found)")
                    continue

                poll_key = (
                    (data.get("agency") or "").strip().lower(),
                    (data.get("state")  or "").strip().lower(),
                    data.get("party_a_percentage"),
                )
                if poll_key in seen_polls:
                    print(f"   -> Skipped (duplicate poll: {data.get('agency')} / {data.get('state')})")
                    continue

                ok = _insert_poll(data, real_url)
                if ok:
                    seen_urls.add(cu)
                    seen_urls.add(cu_decoded)
                    seen_titles.add(nt)
                    seen_polls.add(poll_key)
                    saved += 1

        except Exception as e:
            print(f"   [Feed Error] {feed_name}: {e}")

    # --- GDELT ---
    print("\n[+] Scanning GDELT for opinion poll articles...")
    gdelt_articles = _fetch_gdelt_polls()
    print(f"   -> Fetched {len(gdelt_articles)} GDELT articles across {len(GDELT_POLL_QUERIES)} states.")

    for article in gdelt_articles:
        try:
            title         = article["title"]
            link          = article["url"]
            state_context = article["state_context"]

            nt = _norm_title(title)
            cu = _canonical_url(link)

            if nt in seen_titles or cu in seen_urls:
                continue

            if not any(kw in title.lower() for kw in POLL_KEYWORDS):
                continue

            print(f"-> [GDELT] {title[:70]}...")
            article_text = _scrape_article(link)
            if len(article_text) < 80:
                continue

            data = _extract_poll_data(article_text, state_context)
            if not data:
                continue
            if data.get("confidence", 0) < 0.6:
                print(f"   -> Skipped (confidence={data.get('confidence', 0):.2f} < 0.6)")
                continue
            if not data.get("agency") or not data.get("party_a_name"):
                print(f"   -> Skipped (missing agency or party data)")
                continue
            if data.get("party_a_percentage") is None and data.get("party_b_percentage") is None:
                print(f"   -> Skipped (no percentages found)")
                continue

            poll_key = (
                (data.get("agency") or "").strip().lower(),
                (data.get("state")  or "").strip().lower(),
                data.get("party_a_percentage"),
            )
            if poll_key in seen_polls:
                print(f"   -> Skipped (duplicate poll: {data.get('agency')} / {data.get('state')})")
                continue

            ok = _insert_poll(data, link)
            if ok:
                seen_urls.add(cu)
                seen_titles.add(nt)
                seen_polls.add(poll_key)
                saved += 1

        except Exception:
            pass

    print(f"\n[+] Cycle complete. {saved} poll(s) saved.")
    gc.collect()


# --- Entry point ---
if __name__ == "__main__":
    print("=== DHARMA-OSINT Opinion Poll Ingestor ===")
    if not supabase:
        print("CRITICAL: Supabase not available. Exiting.")
        raise SystemExit(1)
    while True:
        fetch_and_ingest()
        print(f"   [~] Sleeping 1 hour...")
        time.sleep(3600)
