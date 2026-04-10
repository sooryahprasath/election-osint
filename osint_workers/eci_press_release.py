"""
ECI press releases (ECINet → eci.gov.in API) — same-calendar-day (IST) PDF match + final turnout upsert.

The React app on https://ecinet.eci.gov.in/home/eciUpdates calls:
  GET https://www.eci.gov.in/eci-backend/public/api/get-press-release?days=<enc>&page=<enc>&search=<enc>
Response shape (observed in bundle 9880.*.chunk.js):
  data.results.data[] → document_title, date_of_creation, document_attachments[0].record_location (PDF URL)

We rely on Playwright so the page runs the same client-side encryption as the SPA and triggers the request.
Selection priority: **IST date of press release == poll calendar date**; title keywords are optional tie-breakers only.
"""
from __future__ import annotations

import io
import json
import os
import re
from datetime import date, datetime
from typing import Any
from urllib.parse import urljoin, urlparse

import requests
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")
ECINET_UPDATES_URL = "https://ecinet.eci.gov.in/home/eciUpdates"
PRESS_API_SUBSTRING = "get-press-release"

# Optional: comma-separated state names to limit LLM extraction (default: all PHASE_STATES for that day)
_STATE_ALIASES = {
    "tamil nadu": "Tamil Nadu",
    "west bengal": "West Bengal",
    "kerala": "Kerala",
    "assam": "Assam",
    "puducherry": "Puducherry",
    "pondicherry": "Puducherry",
}


def _parse_api_date(s: str) -> date | None:
    s = (s or "").strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d", "%d-%b-%Y", "%d %b %Y"):
        try:
            return datetime.strptime(s[:20], fmt).date()
        except ValueError:
            continue
    m = re.search(r"(\d{4}-\d{2}-\d{2})", s)
    if m:
        try:
            return datetime.strptime(m.group(1), "%Y-%m-%d").date()
        except ValueError:
            pass
    return None


def _fetch_press_release_payload_playwright(*, timeout_ms: int = 120_000) -> dict[str, Any] | None:
    from playwright.sync_api import sync_playwright

    captured: list[dict[str, Any]] = []

    def on_response(resp):
        try:
            if PRESS_API_SUBSTRING not in resp.url:
                return
            if resp.status != 200:
                return
            captured.append(resp.json())
        except Exception:
            pass

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.on("response", on_response)
        page.goto(ECINET_UPDATES_URL, wait_until="domcontentloaded", timeout=timeout_ms)
        page.wait_for_timeout(8000)
        if not captured:
            page.reload(wait_until="networkidle", timeout=timeout_ms)
            page.wait_for_timeout(12000)
        browser.close()

    for payload in reversed(captured):
        if isinstance(payload, dict) and _normalize_items(payload):
            return payload
    return captured[-1] if captured else None


def _normalize_items(payload: dict[str, Any]) -> list[dict[str, Any]]:
    try:
        inner = payload.get("results")
        if isinstance(inner, dict):
            data = inner.get("data") or []
        elif isinstance(inner, list):
            data = inner
        else:
            data = payload.get("data") or []
        return [x for x in data if isinstance(x, dict)]
    except Exception:
        return []


def _same_ist_day(item_date: str, poll_d: date) -> bool:
    d = _parse_api_date(item_date)
    return d == poll_d if d else False


def _pick_pdf_for_poll_day(items: list[dict[str, Any]], poll_d: date) -> tuple[str, str, str] | None:
    """
    Returns (pdf_url, title, raw_date_str) for the best same-day match.
    If multiple same-day PDFs, prefer one whose title mentions turnout / assembly / election (weak tie-break).
    """
    cands: list[tuple[int, dict[str, Any]]] = []
    for it in items:
        raw_date = str(it.get("date_of_creation") or "").strip()
        if not _same_ist_day(raw_date, poll_d):
            continue
        atts = it.get("document_attachments") or []
        if not atts or not isinstance(atts, list):
            continue
        loc = atts[0].get("record_location") if isinstance(atts[0], dict) else None
        pdf_url = str(loc or "").strip()
        if not pdf_url.lower().endswith(".pdf") and "/pdf" not in pdf_url.lower():
            # still allow CDN paths without .pdf suffix
            if "pdf" not in pdf_url.lower():
                continue
        title = str(it.get("document_title") or "").strip()
        score = 0
        tl = title.lower()
        for kw in ("turnout", "poll", "assembly", "legislative", "election", "voter", "phase"):
            if kw in tl:
                score += 1
        cands.append((score, {"pdf_url": pdf_url, "title": title, "raw_date": raw_date}))
    if not cands:
        return None
    cands.sort(key=lambda x: x[0], reverse=True)
    best = cands[0][1]
    return (best["pdf_url"], best["title"], best["raw_date"])


def _download_pdf_text(url: str, timeout: int = 120) -> str:
    headers = {"User-Agent": "Mozilla/5.0 (compatible; DHARMA-OSINT/1.0; +https://example.invalid)"}
    r = requests.get(url, headers=headers, timeout=timeout)
    r.raise_for_status()
    try:
        from pypdf import PdfReader
    except ImportError:
        raise RuntimeError("pypdf is required — pip install pypdf")
    reader = PdfReader(io.BytesIO(r.content))
    parts: list[str] = []
    for pg in reader.pages[:30]:
        try:
            t = pg.extract_text() or ""
        except Exception:
            t = ""
        if t.strip():
            parts.append(t)
    return "\n".join(parts)


def _llm_turnout_from_press_text(
    text: str,
    expected_states: list[str],
    *,
    llm_json: Any,
) -> dict[str, dict[str, float]]:
    """Returns { 'Kerala': {'turnout_min': x, 'turnout_max': y}, ... }"""

    states_json = json.dumps(expected_states)
    snippet = text[:24_000]
    prompt = f"""You read the plain text extracted from an Election Commission of India (ECI) press release PDF.

Extract **final voter turnout percentage** for each state in this list when present: {states_json}
- Use the **final** figure for that state for this election event (ignore provisional intraday slices).
- If only one number is given, set turnout_min and turnout_max to that value.
- If a range is given, set min/max to the inclusive ends.
- Percentages are 0–100.

Return pure JSON only (no markdown):
{{
  "states": [
    {{"state": "Kerala", "turnout_min": 72.1, "turnout_max": 72.1}}
  ]
}}

If a listed state has no turnout in the document, omit it from the array.

PDF_TEXT:
{snippet}
"""
    out = llm_json("gemini-2.5-flash", prompt)
    raw = out.get("states") if isinstance(out, dict) else None
    if not isinstance(raw, list):
        return {}
    by_state: dict[str, dict[str, float]] = {}
    for row in raw:
        if not isinstance(row, dict):
            continue
        st = str(row.get("state") or "").strip()
        if not st:
            continue
        lo = float(row.get("turnout_min") or 0)
        hi = float(row.get("turnout_max") or 0)
        if lo <= 0 and hi <= 0:
            continue
        if hi < lo:
            lo, hi = hi, lo
        by_state[st] = {"turnout_min": lo, "turnout_max": hi}
    return by_state


def _canonical_state(name: str, allowed: set[str]) -> str | None:
    n = name.strip().lower()
    if name in allowed:
        return name
    if n in _STATE_ALIASES:
        c = _STATE_ALIASES[n]
        return c if c in allowed else None
    for a in allowed:
        if a.lower() == n:
            return a
    return None


def upsert_press_release_overrides(
    supabase: Any,
    state: str,
    turnout_min: float,
    turnout_max: float,
    pdf_url: str,
    doc_title: str,
    time_slot: str,
) -> None:
    """Always override the latest row for this state (press release beats LLM/Encore)."""
    from datetime import timezone

    if not supabase:
        return
    prev: Any = None
    booth_news = [
        {
            "type": "eci_encore",
            "text": f"ECI press release PDF — final turnout: {doc_title[:200]}",
            "source": pdf_url,
        }
    ]
    row: dict[str, Any] = {
        "state": state,
        "time_slot": time_slot,
        "turnout_min": float(turnout_min),
        "turnout_max": float(turnout_max),
        "booth_news": booth_news,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    for opt_col, val in (
        ("source_url", pdf_url),
        ("confidence_0_1", 0.99),
        ("source", "eci_press_release_pdf"),
    ):
        row[opt_col] = val
    try:
        prev = (
            supabase.table("voter_turnout")
            .select("id")
            .eq("state", state)
            .order("updated_at", desc=True)
            .limit(1)
            .execute()
        )
        if prev.data:
            supabase.table("voter_turnout").update(row).eq("id", prev.data[0]["id"]).execute()
        else:
            supabase.table("voter_turnout").insert(row).execute()
    except Exception as e:
        row.pop("source_url", None)
        row.pop("confidence_0_1", None)
        row.pop("source", None)
        try:
            if prev and prev.data:
                supabase.table("voter_turnout").update(row).eq("id", prev.data[0]["id"]).execute()
            else:
                supabase.table("voter_turnout").insert(row).execute()
        except Exception as e2:
            print(f"      [!] press release upsert {state}: {e} / fallback {e2}")


def apply_eci_press_release_final_turnout(
    now: datetime,
    states: list[str],
    *,
    supabase: Any,
    llm_json_fn: Any,
) -> int:
    """
    If a press release PDF dated **today IST** (poll calendar day) exists, extract turnout for `states`
    and upsert rows (overriding prior FINAL).
    Returns number of states updated.
    """
    if not llm_json_fn:
        return 0
    poll_d = now.astimezone(IST).date()
    states_set = {s.strip() for s in states if isinstance(s, str) and s.strip()}
    if not states_set:
        return 0

    payload = _fetch_press_release_payload_playwright()
    if not payload:
        print("   [i] ECI press release: no API payload captured (SPA/API).")
        return 0
    items = _normalize_items(payload)
    picked = _pick_pdf_for_poll_day(items, poll_d)
    if not picked:
        print(f"   [i] ECI press release: no same-day ({poll_d}) PDF in {len(items)} listing row(s).")
        return 0
    pdf_url, title, raw_d = picked
    if not urlparse(pdf_url).netloc:
        pdf_url = urljoin("https://www.eci.gov.in/", pdf_url)

    try:
        text = _download_pdf_text(pdf_url)
    except Exception as e:
        print(f"   [!] ECI press release PDF fetch/extract failed: {e}")
        return 0
    if len(text.strip()) < 80:
        print("   [!] ECI press release: extracted text too short — skipping LLM.")
        return 0

    extracted = _llm_turnout_from_press_text(text, sorted(states_set), llm_json=llm_json_fn)
    slot = f"FINAL · ECI press release · {now.astimezone(IST).strftime('%Y-%m-%d %H:%M')} IST"
    n = 0
    for raw_name, nums in extracted.items():
        canon = _canonical_state(raw_name, states_set)
        if not canon:
            continue
        upsert_press_release_overrides(
            supabase,
            canon,
            nums["turnout_min"],
            nums["turnout_max"],
            pdf_url,
            title,
            slot,
        )
        print(f"   -> [ECI PDF] {canon}  {nums['turnout_min']}%–{nums['turnout_max']}%  ({title[:60]}…)")
        n += 1
    return n
