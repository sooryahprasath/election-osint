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
from datetime import datetime, date
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


def extract_article_text(url: str, max_chars: int = 1800) -> str:
    try:
        res = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=12, allow_redirects=True)
        soup = BeautifulSoup(res.content, "html.parser")
        return " ".join(p.get_text() for p in soup.find_all("p"))[:max_chars]
    except Exception:
        return ""


def fetch_corpus(state: str, query_extra: str, limit: int = 8) -> list[str]:
    raw = f"{state} Assembly Election 2026 {query_extra} when:1d {TRUSTED_BLOCK}"
    safe = urllib.parse.quote(raw)
    url = f"https://news.google.com/rss/search?q={safe}&hl=en-IN&gl=IN&ceid=IN:en"
    chunks: list[str] = []
    try:
        feed = feedparser.parse(url)
        for entry in feed.entries[:limit]:
            text = extract_article_text(getattr(entry, "link", "") or "")
            src = getattr(getattr(entry, "source", None), "title", "") or "feed"
            if text:
                chunks.append(f"Outlet: {src} | URL: {entry.link} | Text: {text}")
    except Exception as e:
        print(f"      [!] RSS error ({state}): {e}")
    return chunks


def fetch_eci_corpus(state: str, limit: int = 5) -> list[str]:
    raw = f'{state} {ECI_BLOCK} when:1d'
    safe = urllib.parse.quote(raw)
    url = f"https://news.google.com/rss/search?q={safe}&hl=en-IN&gl=IN&ceid=IN:en"
    chunks: list[str] = []
    try:
        feed = feedparser.parse(url)
        for entry in feed.entries[:limit]:
            text = extract_article_text(getattr(entry, "link", "") or "")
            if text:
                chunks.append(f"[ECI-related] URL: {entry.link} | Text: {text}")
    except Exception:
        pass
    return chunks


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
    """Pass A: extract numeric claims; Pass B: neutral range + incidents + citations."""
    news = fetch_corpus(state, "(turnout OR voting OR polling OR booth OR EVM)", 8)
    eci = fetch_eci_corpus(state, 5)
    corpus = news + eci
    if not corpus:
        print(f"      [!] No corpus for {state}")
        return None
    joined = "\n---\n".join(corpus)

    extract_prompt = f"""
You are extracting ONLY factual numeric claims about voter TURNOUT PERCENTAGE for {state} (Assembly 2026).
From the text, list each distinct percentage mentioned and which outlet/URL implied it.
If none, return empty arrays.

Return pure JSON (no markdown):
{{
  "claims": [{{"turnout_pct": 68.2, "context": "short phrase", "url": "https://..."}}],
  "booth_incidents_raw": [{{"text": "short", "url": "https://..."}}]
}}

TEXT:
{joined[:12000]}
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
- turnout_min / turnout_max (inclusive %), 0 if truly unknown
- confidence_0_1
- one sentence methodology_note (no outlet names in the note)
- booth_news: up to 3 items {{text, source}} for significant booth/EVM incidents (use URLs from evidence)
- citations: up to 5 items {{outlet, url}} supporting the range

Rules: Do not invent percentages. If claims conflict, reflect that in a wider range.

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

    # Merge citations into booth_news for UI (type=citation) without schema migration
    booth = list(out.get("booth_news") or [])
    for c in (out.get("citations") or [])[:5]:
        url = c.get("url") or ""
        outlet = c.get("outlet") or "Source"
        if url:
            booth.append({"text": f"Source track: {outlet}", "source": url, "type": "citation"})
    note = out.get("methodology_note") or ""
    if note:
        booth.append({"text": note[:220], "source": "", "type": "methodology"})
    out["booth_news"] = booth
    return out


def insert_turnout_row(state: str, data: dict, time_slot: str) -> None:
    if not supabase:
        return
    row = {
        "state": state,
        "time_slot": time_slot,
        "turnout_min": float(data.get("turnout_min") or 0),
        "turnout_max": float(data.get("turnout_max") or 0),
        "booth_news": data.get("booth_news") or [],
    }
    supabase.table("voter_turnout").insert(row).execute()


def ingest_turnout_for_states(states: list[str], finalize: bool) -> None:
    slot = "FINAL" if finalize else ist_now().strftime("%I:%M %p").lstrip("0")
    label = "FINAL TURNOUT PASS" if finalize else "LIVE TURNOUT"
    print(f"\n[+] {label} — {', '.join(states)}")
    for state in states:
        try:
            data = dual_consensus_turnout(state, finalize=finalize)
            if not data:
                continue
            insert_turnout_row(state, data, f"{slot} IST")
            lo = data.get("turnout_min")
            hi = data.get("turnout_max")
            print(f"   -> [OK] {state}  {lo}%–{hi}%  (conf {data.get('confidence_0_1')})")
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
            feed = feedparser.parse(url)
            for entry in feed.entries[:6]:
                text = extract_article_text(getattr(entry, "link", "") or "")
                if text:
                    corpus.append(f"URL: {entry.link} | Text: {text}")
        except Exception as e:
            print(f"   -> [ERR] RSS {state}: {e}")
            continue
        if not corpus:
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
        print(f"   -> [OK] {state} — {agency}")


def one_cycle(*, force_states: list[str] | None) -> None:
    now = ist_now()
    states = force_states if force_states else states_for_calendar(now.date())
    if not states:
        print(f"[i] No polling schedule for {now.date()} — idle.")
        return

    mode = run_mode(now)
    if force_states:
        mode = "TURNOUT_LIVE"

    print(f"[i] IST {now.strftime('%Y-%m-%d %H:%M')} | mode={mode} | states={states}")

    if mode == "IDLE":
        return
    if mode == "EXIT_POLL":
        ingest_exit_polls(states)
        return
    if mode == "TURNOUT_FINAL":
        ingest_turnout_for_states(states, finalize=True)
        return
    ingest_turnout_for_states(states, finalize=False)


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
            one_cycle(force_states=force_states)
        except KeyboardInterrupt:
            print("Stopped.")
            break
        except Exception as e:
            print(f"[!!] cycle error: {e}")
        time.sleep(1800)


if __name__ == "__main__":
    main()
