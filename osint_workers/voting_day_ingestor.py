"""
DHARMA-OSINT — Voting day / exit-poll autonomous ingestor (IST).

Schedule (polling calendar days only — see PHASE_STATES):
  07:00–18:30  Live turnout + booth news (default: Gemini + Google Search grounding).
  18:30–19:00  Final turnout pass (same pipeline, flagged as FINAL in time_slot).
  19:00–02:00  Exit-poll aggregation (RSS + LLM), only after calendar embargo lift (29 Apr 2026 19:00 IST).
  02:00–07:00  Idle (long sleep).

Env:
  TURNOUT_INGEST_MODE=grounded|rss   default grounded — RSS uses dual LLM + News RSS corpus.
  TURNOUT_ECI_POLLING_TREND=1   optional — grounded pipeline also scrapes ECINet polling trend (Playwright; see eci_polling_trend.py).
  TURNOUT_NUMBERS_SOURCE=eci   optional — official ECINet % for all states in one batched scrape; Gemini only enriches booth_news (see eci_polling_trend.py for grace / throttle env).
  VOTING_INGEST_INTERVAL_SEC   optional — seconds between cycles in TURNOUT_LIVE (default 600). Use 1200 for ~20 min booth refresh.
Production (ECI numbers + booth every 20 min, all states on poll days):
  Do not pass --force-states — the script uses PHASE_STATES for today’s IST date.
  Run the daemon (not --once):  python3 voting_day_ingestor.py
  Example env:
    export TURNOUT_NUMBERS_SOURCE=eci
    export TURNOUT_INGEST_MODE=grounded
    export VOTING_INGEST_INTERVAL_SEC=1200
    export ECI_SCRAPE_GRACE_MIN=12
  export ECI_PRESS_PDF_URL="https://..."   optional — after 18:30 IST, fetch this ECI PDF once per cycle and upsert final turnout (see eci_press_release.py)
  First process start always hits ECINet once (empty cache). After that, Playwright runs again when the IST schedule
  fingerprint advances (intraday slots + grace / COP). Each cycle still runs Gemini booth_news per state.
  Important: use the long-running daemon for this split. Cron `python … --once` every 20m starts a fresh process each
  time and will re-scrape ECINet on every run (no in-memory cache).

Run under systemd with Restart=always, or cron @reboot + loop.
Test:  python voting_day_ingestor.py --once
       python voting_day_ingestor.py --once --force-states Kerala Assam
       python voting_day_ingestor.py --once --force-eci   # clear ECI cache and re-scrape ECINet this run
       python voting_day_ingestor.py --once --eci-press-date 2026-04-09 --force-states Kerala
       python voting_day_ingestor.py --link "https://www.eci.gov.in/...pdf" --force-states Kerala Assam
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
from datetime import datetime, date, timedelta, timezone
from zoneinfo import ZoneInfo

import feedparser
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from google import genai
from supabase import create_client, Client

env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
load_dotenv(dotenv_path=env_path)

IST = ZoneInfo("Asia/Kolkata")
UTC = ZoneInfo("UTC")
SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
# Workers must use the service role key — the anon key cannot write past RLS.
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_KEY:
    _anon = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if _anon:
        print(
            "WARNING: SUPABASE_SERVICE_ROLE_KEY not set — falling back to anon key.\n"
            "         All Supabase writes will fail with RLS errors unless you set the service role key.",
            file=sys.stderr,
        )
        SUPABASE_KEY = _anon
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

gemini_client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

try:
    supabase: Client | None = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_URL and SUPABASE_KEY else None
except Exception:
    supabase = None

# --- Mirror src/lib/utils/countdown.ts ELECTION_DATES (polling dates IST) ---
PHASE_STATES: list[tuple[date, list[str]]] = [
    (date(2026, 4, 9), ["Kerala", "Assam", "Puducherry"]),
    (date(2026, 4, 23), ["Tamil Nadu", "West Bengal"]),
    (date(2026, 4, 29), ["West Bengal"]),
]

TURNOUT_START = (7, 0)
TURNOUT_FINAL = (18, 30)
EXIT_POLL_START = (19, 0)
EXIT_POLL_END = (2, 0)  # night window ends 02:00

# Mirror src/lib/utils/countdown.ts EXIT_POLL_EMBARGO_LIFT_IST
EXIT_POLL_EMBARGO_LIFT = datetime(2026, 4, 29, 19, 0, tzinfo=IST)

# Prefer these outlets when Google supports source: filters (often sparse — we always add a broad fallback).
TRUSTED_BLOCK = (
    'source:"News18" OR source:"ANI" OR source:"Times Now" OR source:"The Hindu" '
    'OR source:"NDTV" OR source:"Indian Express"'
)
ECI_BLOCK = '("Election Commission" OR ECI OR eci.gov.in) India turnout'


def states_for_calendar(d: date) -> list[str]:
    for poll_date, states in PHASE_STATES:
        if poll_date == d:
            return list(states)
    return []


def eci_phase_for_states(states: list[str], d: date) -> str:
    """ECI assembly phase for ECINet polling-trend scrape (mirrors PHASE_STATES)."""
    if d == date(2026, 4, 29) and any(s.strip() == "West Bengal" for s in states):
        return "2"
    return "1"


def ist_now() -> datetime:
    return datetime.now(IST)


def minutes_since_midnight(dt: datetime) -> int:
    return dt.hour * 60 + dt.minute


def exit_poll_embargo_active(dt: datetime) -> bool:
    return dt.astimezone(IST) < EXIT_POLL_EMBARGO_LIFT


def run_mode(dt: datetime) -> str:
    """TURNOUT_LIVE | TURNOUT_FINAL | EXIT_POLL | IDLE"""
    d = dt.date()
    if not states_for_calendar(d):
        return "IDLE"
    t = minutes_since_midnight(dt)
    t7 = TURNOUT_START[0] * 60 + TURNOUT_START[1]
    t_final = TURNOUT_FINAL[0] * 60 + TURNOUT_FINAL[1]
    t_exit = EXIT_POLL_START[0] * 60 + EXIT_POLL_START[1]
    t_night_end = EXIT_POLL_END[0] * 60 + EXIT_POLL_END[1]

    in_exit_window = (t >= t_exit) or (t < t_night_end)
    if in_exit_window:
        if exit_poll_embargo_active(dt):
            return "IDLE"
        return "EXIT_POLL"
    if t < t7:
        return "IDLE"
    if t < t_final:
        return "TURNOUT_LIVE"
    return "TURNOUT_FINAL"


def format_time_slot_ist(now: datetime, *, finalize: bool) -> str:
    """24h IST label aligned with wall clock (avoids stale-looking 12h AM/PM strings)."""
    n = now.astimezone(IST)
    if finalize:
        return f"FINAL · {n.strftime('%H:%M')} IST"
    return f"LIVE · {n.strftime('%H:%M')} IST"


def parse_supabase_ts(s: str) -> datetime:
    if not s:
        return datetime.min.replace(tzinfo=UTC)
    s2 = s.replace("Z", "+00:00") if s.endswith("Z") else s
    dt = datetime.fromisoformat(s2)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def extract_article_text(url: str, max_chars: int = 2200) -> str:
    try:
        res = requests.get(
            url,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
            timeout=14,
            allow_redirects=True,
        )
        soup = BeautifulSoup(res.content, "html.parser")
        for tag in soup(["script", "style", "nav", "footer", "aside"]):
            tag.decompose()
        parts: list[str] = []
        for p in soup.find_all("p"):
            t = p.get_text(separator=" ", strip=True)
            if len(t) > 35:
                parts.append(t)
        text = " ".join(parts)
        if len(text) < 140:
            og = soup.find("meta", property="og:description") or soup.find("meta", attrs={"name": "description"})
            if og and og.get("content"):
                text = (text + " " + str(og.get("content"))).strip()
        if len(text) < 80:
            art = soup.find("article") or soup.find("div", class_=lambda c: c and "article" in str(c).lower())
            if art:
                text = art.get_text(separator=" ", strip=True)[:max_chars]
        return text[:max_chars]
    except Exception:
        return ""


def entry_fallback_text(entry, max_chars: int = 2200) -> str:
    summary = (getattr(entry, "summary", "") or "").strip()
    title = (getattr(entry, "title", "") or "").strip()
    # Strip HTML from RSS summary when present
    if summary and "<" in summary:
        summary = BeautifulSoup(summary, "html.parser").get_text(separator=" ", strip=True)
    text = summary if len(summary) >= 80 else f"{title}. {summary}".strip(". ").strip()
    return text[:max_chars]


def _unwrap_google_url_query(raw: str) -> str | None:
    """Extract target URL from https://www.google.com/url?q=..."""
    try:
        u = urllib.parse.urlparse((raw or "").strip())
        host = (u.netloc or "").lower()
        if host.startswith("www."):
            host = host[4:]
        if host == "google.com" and u.path.startswith("/url"):
            qs = urllib.parse.parse_qs(u.query)
            for key in ("q", "url"):
                if key in qs and qs[key]:
                    inner = urllib.parse.unquote(qs[key][0])
                    if inner.startswith("http"):
                        return inner
    except Exception:
        pass
    return None


def entry_preferred_link(entry) -> str:
    """Use Atom/RSS alternate link to publisher when Google exposes it."""
    primary = (getattr(entry, "link", "") or "").strip()
    for item in getattr(entry, "links", []) or []:
        if not isinstance(item, dict):
            continue
        href = (item.get("href") or "").strip()
        if not href.startswith("http") or "news.google.com" in href:
            continue
        rel = str(item.get("rel", ""))
        typ = str(item.get("type", ""))
        if "alternate" in rel or "html" in typ.lower() or rel in ("", "related"):
            return href
    return primary


def resolve_publisher_url(raw: str, timeout: float = 12.0) -> str:
    """
    Follow Google News redirect pages to the publisher URL when possible.
    Stored links must not be news.google.com wrappers (browsers often block them).
    """
    raw = (raw or "").strip()
    if not raw.startswith("http"):
        return raw
    inner = _unwrap_google_url_query(raw)
    if inner:
        raw = inner
    try:
        host = urllib.parse.urlparse(raw).netloc.lower()
    except Exception:
        return raw
    if "news.google.com" not in host:
        return raw

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-IN,en;q=0.9",
    }
    try:
        r = requests.get(raw, headers=headers, timeout=timeout, allow_redirects=True)
        final = (r.url or raw).strip()
        fh = urllib.parse.urlparse(final).netloc.lower()
        if "news.google.com" not in fh and "google.com/url" not in final:
            return final
        soup = BeautifulSoup(r.content, "html.parser")
        can = soup.find("link", rel=lambda x: x and "canonical" in str(x).lower())
        if can and can.get("href"):
            h = str(can["href"]).strip()
            if h.startswith("http") and "news.google.com" not in h:
                return h
        og = soup.find("meta", property="og:url")
        if og and og.get("content"):
            h = str(og["content"]).strip()
            if h.startswith("http") and "news.google.com" not in h:
                return h
        return final
    except Exception:
        return raw


def prune_booth_news_items(items: list) -> list[dict]:
    """Drop empty / ellipsis-only rows and useless 'Source track: Source' lines."""
    out: list[dict] = []
    seen: set[str] = set()
    for it in items:
        if not isinstance(it, dict):
            continue
        d = dict(it)
        text = str(d.get("text") or "").strip()
        src = str(d.get("source") or "").strip()
        typ = str(d.get("type") or "")
        if text.lower() in ("source track: source", "source track:"):
            text = ""
        if re.match(r"^source track:\s*source\s*$", text, re.I):
            text = ""
        if not text and src.startswith("http"):
            text = "Press report"
        if text in (".", "...", "…", "-", "—", "–"):
            if not src.startswith("http"):
                continue
            text = "See article"
        if len(text) < 2:
            if not src.startswith("http"):
                continue
            text = "See article"
        if typ == "methodology" and len(text) < 12:
            continue
        key = f"{text[:120]}|{src[:100]}"
        if key in seen:
            continue
        seen.add(key)
        d["text"] = text
        if src:
            d["source"] = src
        out.append(d)
    return out


def booth_lines_from_extract_claims(extracted: dict) -> list[dict]:
    """Turn extract-phase percentage claims into visible booth lines with URLs."""
    lines: list[dict] = []
    seen: set[str] = set()
    for c in extracted.get("claims") or []:
        if not isinstance(c, dict):
            continue
        url = str(c.get("url") or "").strip()
        ctx = str(c.get("context") or "").strip()
        try:
            p = float(c.get("turnout_pct"))
        except (TypeError, ValueError):
            continue
        if not (0 < p <= 100):
            continue
        text = ctx if len(ctx) >= 8 else f"Wire: ~{p:g}% turnout cited for this phase."
        key = url or text
        if key in seen:
            continue
        seen.add(key)
        lines.append({"text": text[:280], "source": url, "type": "turnout_claim"})
    return lines[:8]


def apply_extract_turnout_fallback(extracted: dict, out: dict) -> None:
    """If consensus returned 0–0 but extract found numbers, derive a conservative band."""
    try:
        lo = float(out.get("turnout_min") or 0)
        hi = float(out.get("turnout_max") or 0)
    except (TypeError, ValueError):
        lo, hi = 0.0, 0.0
    if lo > 0 or hi > 0:
        return
    nums: list[float] = []
    for c in extracted.get("claims") or []:
        if not isinstance(c, dict):
            continue
        try:
            p = float(c.get("turnout_pct"))
            if 0 < p <= 100:
                nums.append(p)
        except (TypeError, ValueError):
            pass
    if not nums:
        return
    a, b = min(nums), max(nums)
    if b - a <= 12:
        mid = (a + b) / 2
        out["turnout_min"] = round(max(0.0, mid - 4), 1)
        out["turnout_max"] = round(min(100.0, mid + 4), 1)
    else:
        out["turnout_min"] = round(a, 1)
        out["turnout_max"] = round(b, 1)
    try:
        conf = float(out.get("confidence_0_1") or 0.45)
    except (TypeError, ValueError):
        conf = 0.45
    out["confidence_0_1"] = min(0.9, conf + 0.08)


def sanitize_booth_news_urls(items: list) -> list[dict]:
    out: list[dict] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        d = dict(it)
        src = d.get("source")
        if isinstance(src, str) and src.strip().startswith("http"):
            d["source"] = resolve_publisher_url(src.strip())
        out.append(d)
    return out


def _feed_entries(url: str) -> list:
    try:
        feed = feedparser.parse(url)
        if getattr(feed, "bozo", False) and not feed.entries:
            print(f"      [!] RSS bozo: {getattr(feed, 'bozo_exception', 'unknown')}")
        return list(feed.entries or [])
    except Exception as e:
        print(f"      [!] feedparser: {e}")
        return []


def states_or_rss_group(states: list[str]) -> str:
    """Build (State1 OR "State Two" OR ...) for Google News RSS q=."""
    parts: list[str] = []
    for s in states:
        s = (s or "").strip()
        if not s:
            continue
        if " " in s:
            parts.append(f'"{s}"')
        else:
            parts.append(s)
    return "(" + " OR ".join(parts) + ")"


def dedupe_corpus_chunks(chunks: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for c in chunks:
        u = ""
        if "URL:" in c:
            try:
                u = c.split("URL:", 1)[1].split("|", 1)[0].strip()
            except IndexError:
                u = ""
        key = u or c[:160]
        if key in seen:
            continue
        seen.add(key)
        out.append(c)
    return out


def fetch_shared_turnout_headlines(states: list[str], limit_each: int = 14) -> list[str]:
    """
    Broad RSS queries aligned with Google News web searches like
    voter turnout / voter turnout 2026 (see news.google.com search for India).
    Fetched once per cycle and merged into each state's LLM context.
    """
    if not states:
        return []
    ors = states_or_rss_group(states)
    queries = [
        f"voter turnout {ors} when:1d",
        f"voter turnout 2026 {ors} when:1d",
        f"Assembly elections 2026 LIVE turnout {ors} when:1d",
        f'{ors} ("voter turnout" OR "polling percentage" OR "percent turnout" OR turnout) election 2026 when:1d',
        f'India election 2026 {ors} (turnout OR polling OR percent) when:1d',
    ]
    chunks: list[str] = []
    seen: set[str] = set()
    for q in queries:
        for ch in fetch_query_chunks(q, limit_each, "headlines"):
            u = ""
            if "URL:" in ch:
                try:
                    u = ch.split("URL:", 1)[1].split("|", 1)[0].strip()
                except IndexError:
                    u = ""
            key = u or ch[:220]
            if key in seen:
                continue
            seen.add(key)
            chunks.append(ch)
    return chunks


def fetch_query_chunks(query: str, limit: int, label: str) -> list[str]:
    safe = urllib.parse.quote(query)
    url = f"https://news.google.com/rss/search?q={safe}&hl=en-IN&gl=IN&ceid=IN:en"
    chunks: list[str] = []
    seen_urls: set[str] = set()
    for entry in _feed_entries(url)[:limit]:
        link = entry_preferred_link(entry)
        if not link:
            continue
        resolved = resolve_publisher_url(link)
        if resolved in seen_urls:
            continue
        seen_urls.add(resolved)
        text = extract_article_text(resolved) if resolved else ""
        if (not text or len(text) < 50) and link != resolved:
            text = extract_article_text(link)
        if not text or len(text) < 50:
            text = entry_fallback_text(entry)
        if not text:
            continue
        src = getattr(getattr(entry, "source", None), "title", "") or "feed"
        chunks.append(f"[{label}] Outlet: {src} | URL: {resolved} | Text: {text}")
    return chunks


def fetch_corpus(state: str, query_extra: str, limit: int = 12) -> list[str]:
    """Trusted-source query first; broad fallback if Google returns almost nothing."""
    q_trusted = f"{state} Assembly Election 2026 {query_extra} when:1d {TRUSTED_BLOCK}"
    chunks = fetch_query_chunks(q_trusted, limit, "trusted")
    if len(chunks) < 4:
        q_broad = (
            f"{state} Assembly election 2026 (turnout OR voting OR polling OR booth OR EVM OR queue OR voters) when:1d"
        )
        extra = fetch_query_chunks(q_broad, limit, "broad")
        seen = {c.split("URL:", 1)[-1].split("|", 1)[0].strip() for c in chunks if "URL:" in c}
        for c in extra:
            u = c.split("URL:", 1)[-1].split("|", 1)[0].strip() if "URL:" in c else ""
            if u and u not in seen:
                seen.add(u)
                chunks.append(c)
    return chunks


def fetch_booth_corpus(state: str, limit: int = 10) -> list[str]:
    """Dedicated pass for booth / station / EVM / queue stories (often missing from generic turnout query)."""
    q = (
        f'{state} ( "polling booth" OR "polling station" OR EVM OR re-poll OR queue OR serpentine '
        f"OR lathi OR clash OR violence OR malfunction ) election 2026 when:1d"
    )
    return fetch_query_chunks(q, limit, "booth")


def fetch_eci_corpus(state: str, limit: int = 6) -> list[str]:
    raw = f'{state} {ECI_BLOCK} when:1d'
    return fetch_query_chunks(raw, limit, "eci")


def llm_json(model: str, prompt: str) -> dict:
    if not gemini_client:
        raise RuntimeError("GEMINI_API_KEY missing")
    response = gemini_client.models.generate_content(model=model, contents=prompt)
    text = response.text.strip()
    if text.startswith("```json"):
        text = text[7:-3].strip()
    elif text.startswith("```"):
        text = text.split("```", 2)[1]
        if text.startswith("json"):
            text = text[4:].strip()
    return json.loads(text)


def dual_consensus_turnout(state: str, finalize: bool, shared_chunks: list[str] | None = None) -> dict | None:
    """Pass A: extract numeric claims + raw incidents; Pass B: neutral range + booth lines + citations."""
    shared = list(shared_chunks or [])
    # State-scoped wire (same intent as Google News "voter turnout 2026" + state)
    st_q = f'"{state}"' if " " in state else state
    state_wire = fetch_query_chunks(
        f"{st_q} (voter turnout OR turnout percent OR polling percentage) 2026 when:1d",
        12,
        "state_wire",
    )
    news = fetch_corpus(state, "(turnout OR voting OR polling OR booth OR EVM OR percent OR percentage)", 12)
    booth = fetch_booth_corpus(state, 10)
    eci = fetch_eci_corpus(state, 6)
    corpus = dedupe_corpus_chunks(shared + state_wire + news + booth + eci)
    if not corpus:
        print(f"      [!] No corpus for {state} (check network / Google News RSS)")
        return None
    joined = "\n---\n".join(corpus)
    max_in = 18_000
    if len(joined) > max_in:
        joined = joined[:max_in] + "\n...[truncated]"

    extract_prompt = f"""
You are extracting factual claims for {state} Assembly Election 2026 (India), from news text only.

The TEXT includes [headlines] RSS items (broad "voter turnout" style wires) plus state-specific clips. It may mention several states in one article.

1) Numeric TURNOUT for {state} ONLY: every distinct percentage (or range) that clearly refers to {state}
   (including time-slice figures like "4.4% till 9am", "12% in first two hours", district-wise % if tied to {state}).
   Do NOT attach another state's figure to {state}.
2) BOOTH / FIELD REPORTS for {state} ONLY: queues, EVM swap, re-poll, violence, long lines — even without a turnout number.

Return pure JSON (no markdown):
{{
  "claims": [{{"turnout_pct": 68.2, "context": "short phrase", "url": "https://..."}}],
  "booth_incidents_raw": [{{"text": "short factual line", "url": "https://..."}}]
}}

Rules:
- turnout_pct must be a number (use midpoint if a range like 65-70 is given).
- If no numeric turnout for {state}, claims may be empty; still list booth_incidents_raw for {state} when present.
- Use the URL from the same snippet as each claim/incident when available.

TEXT:
{joined}
"""
    try:
        extracted = llm_json("gemini-2.5-flash", extract_prompt)
    except Exception as e:
        print(f"      [!] Extract LLM failed {state}: {e}")
        return None

    claims = json.dumps(extracted.get("claims") or [])
    incidents = json.dumps(extracted.get("booth_incidents_raw") or [])
    finalize_note = "FINALIZE for polling-day close — prefer official/ECI-weighted numbers if present." if finalize else "INTRADAY — prefer convergent press estimates; widen range if spread > 3 points."

    consensus_prompt = f"""
You are a neutral election analyst. {finalize_note}
Given extracted claims (not raw articles), produce:
- turnout_min / turnout_max (inclusive %). Use 0 only if no numeric turnout evidence exists.
- confidence_0_1
- one sentence methodology_note (no outlet names in the note)
- booth_news: up to 6 items {{text, source}} — every item MUST have text with at least 12 characters (no empty strings, no "...").
  * significant booth/EVM/queue/violence lines; source = publisher URL from "URL: ..." in TEXT (not news.google.com)
  * paraphrases from booth_incidents_raw
- citations: up to 5 items {{outlet, url}} — outlet MUST be the real news brand (e.g. India TV, ANI), never the word "Source" alone

Rules:
- Do not invent percentages. If no numeric turnout, set turnout_min and turnout_max to 0 but still fill booth_news from incidents when present.
- If claims conflict, use a wider range and lower confidence.
- Omit a citation entirely if you do not know the outlet name.

EXTRACTED_CLAIMS_JSON:
{claims}

RAW_INCIDENTS:
{incidents}

Return pure JSON (no markdown):
{{
  "turnout_min": 0,
  "turnout_max": 0,
  "confidence_0_1": 0.5,
  "methodology_note": "",
  "booth_news": [{{"text": "", "source": "https://..."}}],
  "citations": [{{"outlet": "", "url": "https://..."}}]
}}
"""
    try:
        out = llm_json("gemini-2.5-flash", consensus_prompt)
    except Exception as e:
        print(f"      [!] Consensus LLM failed {state}: {e}")
        return None

    booth = list(out.get("booth_news") or [])
    # Visible lines from extract (wires often have % in pass A but consensus leaves booth empty)
    claim_lines = booth_lines_from_extract_claims(extracted)
    booth = claim_lines + booth
    apply_extract_turnout_fallback(extracted, out)
    booth = prune_booth_news_items(booth)

    for c in (out.get("citations") or [])[:5]:
        if not isinstance(c, dict):
            continue
        url = str(c.get("url") or "").strip()
        outlet = str(c.get("outlet") or "").strip()
        if not url:
            continue
        if len(outlet) < 2 or outlet.lower() in ("source", "unknown", "news", "media"):
            label = "Press report"
        else:
            label = f"{outlet} — turnout sourcing"
        booth.append({"text": label, "source": url, "type": "citation"})

    note = str(out.get("methodology_note") or "").strip()
    if len(note) >= 20:
        boiler = re.match(
            r"^no (numeric|specific).*turnout.*(claims|reports|provided|available)",
            note,
            re.I,
        )
        if not (boiler and len(booth) > 0):
            booth.append({"text": note[:280], "source": "", "type": "methodology"})
    booth = prune_booth_news_items(booth)
    out["booth_news"] = sanitize_booth_news_urls(booth)
    return out


def upsert_turnout_row(state: str, data: dict, time_slot: str) -> None:
    if not supabase:
        return
    row = {
        "state": state,
        "time_slot": time_slot,
        "turnout_min": float(data.get("turnout_min") or 0),
        "turnout_max": float(data.get("turnout_max") or 0),
        "booth_news": data.get("booth_news") or [],
    }
    try:
        prev = (
            supabase.table("voter_turnout")
            .select("id,updated_at")
            .eq("state", state)
            .order("updated_at", desc=True)
            .limit(1)
            .execute()
        )
        now_utc = datetime.now(timezone.utc)
        if prev.data:
            last = parse_supabase_ts(str(prev.data[0].get("updated_at") or ""))
            age_sec = (now_utc - last).total_seconds()
            # Refresh same row during active ops window (avoids dozens of orphan rows; keeps UI "current").
            if age_sec < 72 * 3600:
                rid = prev.data[0]["id"]
                row["updated_at"] = now_utc.isoformat()
                up = supabase.table("voter_turnout").update(row).eq("id", rid).execute()
                if getattr(up, "error", None):
                    print(f"      [!] Supabase update error: {up.error}")
                return
        ins = supabase.table("voter_turnout").insert(row).execute()
        if getattr(ins, "error", None):
            print(f"      [!] Supabase insert error: {ins.error}")
    except Exception as e:
        print(f"      [!] Supabase upsert failed: {e}")


def ingest_turnout_for_states(
    states: list[str],
    finalize: bool,
    *,
    bust_eci_cache: bool = False,
) -> None:
    states = [s.strip() for s in states if isinstance(s, str) and s.strip()]
    now = ist_now()
    slot = format_time_slot_ist(now, finalize=finalize)
    label = "FINAL TURNOUT PASS" if finalize else "LIVE TURNOUT"
    print(f"\n[+] {label} — {', '.join(states)} | slot={slot}")
    ingest_mode = (os.getenv("TURNOUT_INGEST_MODE") or "grounded").strip().lower()

    if ingest_mode == "rss":
        shared = fetch_shared_turnout_headlines(states)
        print(f"   [i] Turnout pipeline: RSS — shared headline chunks: {len(shared)}")
        for state in states:
            try:
                data = dual_consensus_turnout(state, finalize=finalize, shared_chunks=shared)
                if not data:
                    continue
                upsert_turnout_row(state, data, slot)
                lo = data.get("turnout_min")
                hi = data.get("turnout_max")
                bn = len(data.get("booth_news") or [])
                print(f"   -> [OK] {state}  {lo}%–{hi}%  (conf {data.get('confidence_0_1')})  booth_items={bn}")
            except Exception as e:
                print(f"   -> [ERR] {state}: {e}")
        return

    nums_src = (os.getenv("TURNOUT_NUMBERS_SOURCE") or "ai").strip().lower()

    if nums_src == "eci":
        print(
            "   [i] Turnout pipeline: ECINet batched (slot-aware) + Gemini booth_news only"
        )
        if not gemini_client:
            print("   [!] GEMINI_API_KEY missing — cannot enrich booth_news; ECI % still attempted")
        from eci_polling_trend import fetch_eci_batch_cached
        from turnout_grounded import (
            apply_eci_snapshot_to_turnout_data,
            postprocess_turnout_row_for_ingest,
            run_booth_only_grounded_pipeline,
            validate_and_trim_grounded_json,
        )

        phase = eci_phase_for_states(states, now.date())
        try:
            eci_map = fetch_eci_batch_cached(
                states, phase, now, finalize=finalize, bust_cache=bust_eci_cache
            )
        except Exception as e:
            print(f"   [!] ECI batch scrape failed: {e}")
            eci_map = {}
        try:
            keys = list(eci_map.keys()) if isinstance(eci_map, dict) else []
            print(f"   [i] ECI snapshot states: {keys}")
            for st in states:
                snap = eci_map.get(st) if isinstance(eci_map, dict) else None
                pct = snap.get("latest_pct") if isinstance(snap, dict) else None
                if pct:
                    print(f"      [i] ECI {st}: latest_pct={pct}")
                else:
                    print(f"      [!] ECI {st}: missing snapshot/latest_pct")
        except Exception:
            pass

        for state in states:
            try:
                data = None
                if gemini_client:
                    data = run_booth_only_grounded_pipeline(
                        gemini_client, state, finalize, now
                    )
                if not data:
                    data = {
                        "turnout_min": 0.0,
                        "turnout_max": 0.0,
                        "confidence_0_1": 0.35,
                        "methodology_note": "",
                        "booth_news": [],
                    }
                apply_eci_snapshot_to_turnout_data(data, eci_map.get(state))
                data = validate_and_trim_grounded_json(data)
                data = postprocess_turnout_row_for_ingest(data)
                lo = float(data.get("turnout_min") or 0)
                hi = float(data.get("turnout_max") or 0)
                if lo <= 0 and hi <= 0 and not data.get("booth_news"):
                    print(f"   -> [SKIP] {state}: no ECI slice and no booth lines")
                    continue
                upsert_turnout_row(state, data, slot)
                bn = len(data.get("booth_news") or [])
                print(
                    f"   -> [OK] {state}  {lo}%–{hi}%  (conf {data.get('confidence_0_1')})  booth_items={bn}"
                )
            except Exception as e:
                print(f"   -> [ERR] {state}: {e}")
        return

    print("   [i] Turnout pipeline: grounded (Gemini + Google Search; optional CEO page hint)")
    if not gemini_client:
        print("   [!] GEMINI_API_KEY missing — cannot run grounded turnout")
        return
    from turnout_grounded import run_grounded_turnout_pipeline

    for state in states:
        try:
            data = run_grounded_turnout_pipeline(gemini_client, state, finalize, now)
            if not data:
                continue
            upsert_turnout_row(state, data, slot)
            lo = data.get("turnout_min")
            hi = data.get("turnout_max")
            bn = len(data.get("booth_news") or [])
            print(f"   -> [OK] {state}  {lo}%–{hi}%  (conf {data.get('confidence_0_1')})  booth_items={bn}")
        except Exception as e:
            print(f"   -> [ERR] {state}: {e}")


def ingest_exit_polls(states: list[str]) -> None:
    print("\n[+] EXIT POLL AGGREGATION")
    for state in states:
        raw = (
            f'{state} Assembly Election 2026 exit poll '
            f'(Axis OR CVoter OR Lokniti OR CNX OR Jan Ki Baat OR "India Today") when:1d'
        )
        safe = urllib.parse.quote(raw)
        url = f"https://news.google.com/rss/search?q={safe}&hl=en-IN&gl=IN&ceid=IN:en"
        corpus: list[str] = []
        try:
            for entry in _feed_entries(url)[:8]:
                link = getattr(entry, "link", "") or ""
                text = extract_article_text(link) if link else ""
                if not text or len(text) < 50:
                    text = entry_fallback_text(entry)
                if text:
                    corpus.append(f"URL: {link} | Text: {text}")
        except Exception as e:
            print(f"   -> [ERR] RSS {state}: {e}")
            continue
        if not corpus:
            print(f"   -> [SKIP] {state}: no exit-poll corpus")
            continue
        prompt = f"""
Neutral extraction of exit-poll seat bands for {state} Assembly 2026.
Use only what is attributed to a named agency. If unclear, set agency to "" and use zeros.

Return pure JSON (no markdown):
{{
  "agency": "Axis My India",
  "party_a_name": "AITC", "party_a_min": 0, "party_a_max": 0,
  "party_b_name": "BJP", "party_b_min": 0, "party_b_max": 0,
  "caveat": "one short sentence on uncertainty"
}}

TEXT:
{chr(10).join(corpus)[:10000]}
"""
        try:
            data = llm_json("gemini-2.5-flash", prompt)
        except Exception as e:
            print(f"   -> [ERR] LLM {state}: {e}")
            continue
        agency = (data.get("agency") or "").strip()
        if not agency:
            print(f"   -> [SKIP] {state}: no agency identified")
            continue
        if supabase:
            try:
                supabase.table("exit_polls").insert(
                    {
                        "state": state,
                        "agency": agency,
                        "party_a_name": data.get("party_a_name"),
                        "party_a_min": int(data.get("party_a_min") or 0),
                        "party_a_max": int(data.get("party_a_max") or 0),
                        "party_b_name": data.get("party_b_name"),
                        "party_b_min": int(data.get("party_b_min") or 0),
                        "party_b_max": int(data.get("party_b_max") or 0),
                        "caveat": (str(data.get("caveat") or "")).strip() or None,
                    }
                ).execute()
            except Exception as e:
                print(f"   -> [ERR] exit_poll insert {state}: {e}")
        print(f"   -> [OK] {state} — {agency}")


def sleep_after_cycle_seconds(mode: str) -> int:
    """Shorter interval during live turnout so the UI does not look frozen."""
    if mode == "TURNOUT_LIVE":
        return int(os.getenv("VOTING_INGEST_INTERVAL_SEC", "600"))  # 10 min default
    if mode == "TURNOUT_FINAL":
        return 300
    if mode == "EXIT_POLL":
        return 1200
    return 3600


def one_cycle(
    *,
    force_states: list[str] | None,
    bust_eci: bool = False,
    eci_press_poll_day: date | None = None,
) -> str:
    now = ist_now()
    cal_d = eci_press_poll_day if eci_press_poll_day is not None else now.date()
    states = force_states if force_states else states_for_calendar(cal_d)
    if not states:
        print(f"[i] No polling schedule for {cal_d} — idle.")
        return "IDLE"

    mode = run_mode(now)
    if force_states:
        mode = "TURNOUT_LIVE"

    print(f"[i] IST {now.strftime('%Y-%m-%d %H:%M')} | mode={mode} | states={states}")

    # Optional: direct ECI PDF URL (env) after polls close — overrides prior FINAL rows.
    press_pdf = (os.getenv("ECI_PRESS_PDF_URL") or "").strip()
    if (
        press_pdf
        and states
        and gemini_client
        and os.getenv("ECI_SKIP_PRESS_RELEASE", "").strip().lower() not in ("1", "true", "yes")
        and minutes_since_midnight(now) >= TURNOUT_FINAL[0] * 60 + TURNOUT_FINAL[1]
    ):
        try:
            from eci_press_release import apply_eci_press_release_final_turnout

            n = apply_eci_press_release_final_turnout(
                now,
                states,
                supabase=supabase,
                llm_json_fn=llm_json,
                pdf_url=press_pdf,
            )
            if n:
                print(f"   [i] ECI press PDF — updated {n} state(s)")
        except Exception as e:
            print(f"   [!] ECI press PDF pass failed: {e}")

    if mode == "IDLE":
        return mode
    if mode == "EXIT_POLL":
        ingest_exit_polls(states)
        return mode
    if mode == "TURNOUT_FINAL":
        ingest_turnout_for_states(states, finalize=True, bust_eci_cache=bust_eci)
        return mode
    ingest_turnout_for_states(states, finalize=False, bust_eci_cache=bust_eci)
    return mode


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true", help="Single cycle then exit (for tests)")
    ap.add_argument("--force-states", nargs="+", help="Override states (e.g. Kerala Assam)")
    ap.add_argument(
        "--force-eci",
        action="store_true",
        help="With TURNOUT_NUMBERS_SOURCE=eci: clear ECI batch cache and re-scrape ECINet on the first cycle (daemon) or this run (--once)",
    )
    ap.add_argument(
        "--eci-press-date",
        metavar="YYYY-MM-DD",
        default=None,
        help="Pick default states from PHASE_STATES for this IST calendar day. Use with --once or --link.",
    )
    ap.add_argument(
        "--link",
        metavar="URL",
        default=None,
        help="ECI (or other) PDF URL: Playwright download + Gemini turnout extract + Supabase upsert. "
        "Use with --force-states or --eci-press-date on a PHASE_STATES day. Ignores the 18:30 daemon gate.",
    )
    args = ap.parse_args()
    force_states = args.force_states if args.force_states else None

    eci_press_poll_day: date | None = None
    if args.eci_press_date:
        try:
            eci_press_poll_day = datetime.strptime(args.eci_press_date.strip(), "%Y-%m-%d").date()
        except ValueError:
            print("CRITICAL: --eci-press-date must be YYYY-MM-DD.")
            sys.exit(1)
        if not args.once and not args.link:
            print("CRITICAL: --eci-press-date requires --once or --link.")
            sys.exit(1)

    print("=== DHARMA-OSINT voting_day_ingestor (IST) ===")
    if not supabase:
        print("CRITICAL: Supabase client missing.")
        sys.exit(1)
    if not gemini_client:
        print("CRITICAL: GEMINI_API_KEY missing.")
        sys.exit(1)

    if args.link:
        pdf_link = args.link.strip()
        if not pdf_link.lower().startswith(("http://", "https://")):
            print("CRITICAL: --link must be an http(s) URL.")
            sys.exit(1)
        now = ist_now()
        cal_d = eci_press_poll_day if eci_press_poll_day is not None else now.date()
        st = list(force_states) if force_states else states_for_calendar(cal_d)
        if not st:
            print(
                "CRITICAL: No states — use --force-states Kerala Assam (etc.) or --eci-press-date on a PHASE_STATES day."
            )
            sys.exit(1)
        print(f"[i] ECI press PDF (--link), states={st}")
        try:
            from eci_press_release import apply_eci_press_release_final_turnout

            n = apply_eci_press_release_final_turnout(
                now,
                st,
                supabase=supabase,
                llm_json_fn=llm_json,
                pdf_url=pdf_link,
            )
            print(f"[i] ECI press PDF pass finished — updated {n} state(s).")
        except Exception as e:
            print(f"[!] ECI press PDF pass failed: {e}")
            sys.exit(1)
        return

    if args.once:
        one_cycle(
            force_states=force_states,
            bust_eci=args.force_eci,
            eci_press_poll_day=eci_press_poll_day,
        )
        return

    force_eci_next = args.force_eci
    while True:
        try:
            now = ist_now()
            if not force_states and not states_for_calendar(now.date()):
                print(f"[i] No poll today ({now.date()} IST) — sleep 1h")
                time.sleep(3600)
                continue
            mode = one_cycle(force_states=force_states, bust_eci=force_eci_next)
            force_eci_next = False
            time.sleep(sleep_after_cycle_seconds(mode))
        except KeyboardInterrupt:
            print("Stopped.")
            break
        except Exception as e:
            print(f"[!!] cycle error: {e}")
            time.sleep(300)


if __name__ == "__main__":
    main()
