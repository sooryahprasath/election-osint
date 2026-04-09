"""
DHARMA-OSINT — Voting day / exit-poll autonomous ingestor (IST).

Schedule (polling calendar days only — see PHASE_STATES):
  07:00–18:30  Live turnout + booth news (news RSS + dual-pass LLM consensus).
  18:30–19:15  Final turnout pass (same pipeline, flagged as FINAL in time_slot).
  19:15–02:00  Exit-poll aggregation from multiple outlets.
  02:00–07:00  Idle (long sleep).

Run under systemd with Restart=always, or cron @reboot + loop.
Test:  python voting_day_ingestor.py --once
       python voting_day_ingestor.py --once --force-states Kerala Assam
"""
from __future__ import annotations

import argparse
import json
import os
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
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
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
EXIT_POLL_START = (19, 15)
EXIT_POLL_END = (2, 0)  # night window ends 02:00

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


def ist_now() -> datetime:
    return datetime.now(IST)


def minutes_since_midnight(dt: datetime) -> int:
    return dt.hour * 60 + dt.minute


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

    if t >= t_exit:
        return "EXIT_POLL"
    if t < t_night_end:
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


def _feed_entries(url: str) -> list:
    try:
        feed = feedparser.parse(url)
        if getattr(feed, "bozo", False) and not feed.entries:
            print(f"      [!] RSS bozo: {getattr(feed, 'bozo_exception', 'unknown')}")
        return list(feed.entries or [])
    except Exception as e:
        print(f"      [!] feedparser: {e}")
        return []


def fetch_query_chunks(query: str, limit: int, label: str) -> list[str]:
    safe = urllib.parse.quote(query)
    url = f"https://news.google.com/rss/search?q={safe}&hl=en-IN&gl=IN&ceid=IN:en"
    chunks: list[str] = []
    seen_urls: set[str] = set()
    for entry in _feed_entries(url)[:limit]:
        link = (getattr(entry, "link", "") or "").strip()
        if not link or link in seen_urls:
            continue
        seen_urls.add(link)
        text = extract_article_text(link) if link else ""
        if not text or len(text) < 50:
            text = entry_fallback_text(entry)
        if not text:
            continue
        src = getattr(getattr(entry, "source", None), "title", "") or "feed"
        chunks.append(f"[{label}] Outlet: {src} | URL: {link} | Text: {text}")
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


def dual_consensus_turnout(state: str, finalize: bool) -> dict | None:
    """Pass A: extract numeric claims + raw incidents; Pass B: neutral range + booth lines + citations."""
    news = fetch_corpus(state, "(turnout OR voting OR polling OR booth OR EVM OR percent OR percentage)", 12)
    booth = fetch_booth_corpus(state, 10)
    eci = fetch_eci_corpus(state, 6)
    corpus = news + booth + eci
    if not corpus:
        print(f"      [!] No corpus for {state} (check network / Google News RSS)")
        return None
    joined = "\n---\n".join(corpus)
    max_in = 14_000
    if len(joined) > max_in:
        joined = joined[:max_in] + "\n...[truncated]"

    extract_prompt = f"""
You are extracting factual claims for {state} Assembly Election 2026 (India), from news text only.

1) Numeric TURNOUT: each distinct percentage (or range like 65-70) explicitly tied to {state} voting today / phase.
2) BOOTH / FIELD REPORTS: queues, EVM swap, re-poll ordered, violence, long lines, notable incidents — even WITHOUT a turnout number.
   Include approximate location or AC name if stated.

Return pure JSON (no markdown):
{{
  "claims": [{{"turnout_pct": 68.2, "context": "short phrase", "url": "https://..."}}],
  "booth_incidents_raw": [{{"text": "short factual line", "url": "https://..."}}]
}}

Rules:
- turnout_pct must be a number (use midpoint if a range like 65-70 is given).
- If no numeric turnout appears, claims may be empty but booth_incidents_raw should still list notable booth/polling items from the text.

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
- booth_news: up to 6 items {{text, source}} — include:
  * significant booth/EVM/queue/violence lines (source = URL when available)
  * short paraphrases from booth_incidents_raw
- citations: up to 5 items {{outlet, url}} supporting the turnout range (if any)

Rules:
- Do not invent percentages. If no numeric turnout, set turnout_min and turnout_max to 0 but still fill booth_news from incidents.
- If claims conflict, use a wider range and lower confidence.

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
    for c in (out.get("citations") or [])[:5]:
        url = c.get("url") or ""
        outlet = c.get("outlet") or "Source"
        if url:
            booth.append({"text": f"Source track: {outlet}", "source": url, "type": "citation"})
    note = out.get("methodology_note") or ""
    if note:
        booth.append({"text": note[:280], "source": "", "type": "methodology"})
    out["booth_news"] = booth
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


def ingest_turnout_for_states(states: list[str], finalize: bool) -> None:
    now = ist_now()
    slot = format_time_slot_ist(now, finalize=finalize)
    label = "FINAL TURNOUT PASS" if finalize else "LIVE TURNOUT"
    print(f"\n[+] {label} — {', '.join(states)} | slot={slot}")
    for state in states:
        try:
            data = dual_consensus_turnout(state, finalize=finalize)
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


def one_cycle(*, force_states: list[str] | None) -> str:
    now = ist_now()
    states = force_states if force_states else states_for_calendar(now.date())
    if not states:
        print(f"[i] No polling schedule for {now.date()} — idle.")
        return "IDLE"

    mode = run_mode(now)
    if force_states:
        mode = "TURNOUT_LIVE"

    print(f"[i] IST {now.strftime('%Y-%m-%d %H:%M')} | mode={mode} | states={states}")

    if mode == "IDLE":
        return mode
    if mode == "EXIT_POLL":
        ingest_exit_polls(states)
        return mode
    if mode == "TURNOUT_FINAL":
        ingest_turnout_for_states(states, finalize=True)
        return mode
    ingest_turnout_for_states(states, finalize=False)
    return mode


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true", help="Single cycle then exit (for tests)")
    ap.add_argument("--force-states", nargs="+", help="Override states (e.g. Kerala Assam)")
    args = ap.parse_args()
    force_states = args.force_states if args.force_states else None

    print("=== DHARMA-OSINT voting_day_ingestor (IST) ===")
    if not supabase:
        print("CRITICAL: Supabase client missing.")
        sys.exit(1)
    if not gemini_client:
        print("CRITICAL: GEMINI_API_KEY missing.")
        sys.exit(1)

    if args.once:
        one_cycle(force_states=force_states)
        return

    while True:
        try:
            now = ist_now()
            if not force_states and not states_for_calendar(now.date()):
                print(f"[i] No poll today ({now.date()} IST) — sleep 1h")
                time.sleep(3600)
                continue
            mode = one_cycle(force_states=force_states)
            time.sleep(sleep_after_cycle_seconds(mode))
        except KeyboardInterrupt:
            print("Stopped.")
            break
        except Exception as e:
            print(f"[!!] cycle error: {e}")
            time.sleep(300)


if __name__ == "__main__":
    main()
