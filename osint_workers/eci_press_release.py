"""
ECI final-turnout from a **direct PDF URL** (Playwright fetch + pypdf + Gemini + Supabase).

No press listing, API, or DOM scraping — you provide the PDF link (CLI `--link` or env `ECI_PRESS_PDF_URL`).

Manual:
  python voting_day_ingestor.py --link "https://www.eci.gov.in/.../download?..." --force-states Kerala Assam Puducherry

Daemon (optional, after 18:30 IST gate): set `ECI_PRESS_PDF_URL` to the same kind of URL; clear or rotate when obsolete.

Env:
  ECI_PRESS_PDF_URL — PDF URL when not passing CLI `--link`
  ECI_PRESS_DOC_TITLE — optional short label for DB booth_news text
  ECI_PRESS_TIMEOUT_MS, ECI_PRESS_DIRECT_WARM_MS, ECI_PRESS_HEADLESS, ECI_PRESS_CHANNEL, ECI_PRESS_DEBUG
  ECI_SKIP_PRESS_RELEASE=1 — disable the daemon pass in voting_day_ingestor
"""
from __future__ import annotations

import io
import json
import os
from contextlib import contextmanager
from datetime import datetime
from typing import Any
from urllib.parse import urljoin, urlparse

from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")
ECINET_UPDATES_URL = "https://ecinet.eci.gov.in/home/eciUpdates"

_ECI_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

_ECI_BINARY_HEADERS = {
    "Referer": "https://www.eci.gov.in/",
    "Origin": "https://www.eci.gov.in",
    "Accept": "application/pdf,application/octet-stream,*/*",
    "User-Agent": _ECI_UA,
}

_STATE_ALIASES = {
    "tamil nadu": "Tamil Nadu",
    "west bengal": "West Bengal",
    "kerala": "Kerala",
    "assam": "Assam",
    "puducherry": "Puducherry",
    "pondicherry": "Puducherry",
}


@contextmanager
def _eci_press_playwright(timeout_ms: int):
    from playwright.sync_api import sync_playwright

    headless = (os.getenv("ECI_PRESS_HEADLESS") or os.getenv("TURNOUT_ECI_HEADLESS") or "1").strip().lower() not in (
        "0",
        "false",
        "no",
    )
    channel = (os.getenv("ECI_PRESS_CHANNEL") or "").strip() or None

    with sync_playwright() as p:
        launch_args: list[str] = []
        if headless:
            launch_args = [
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-dev-shm-usage",
            ]
        launch_kw: dict[str, Any] = {"headless": headless, "args": launch_args}
        if channel:
            launch_kw["channel"] = channel
        browser = p.chromium.launch(**launch_kw)
        context = browser.new_context(
            user_agent=_ECI_UA,
            locale="en-IN",
            viewport={"width": 1280, "height": 900},
        )
        if headless:
            context.add_init_script(
                "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });"
            )
        page = context.new_page()
        page.set_default_timeout(min(timeout_ms, 90_000))
        try:
            yield context, page
        finally:
            browser.close()


def _download_pdf_text_via_context(context: Any, url: str, *, timeout_ms: int) -> str:
    resp = context.request.get(url, headers=dict(_ECI_BINARY_HEADERS), timeout=timeout_ms)
    if resp.status != 200:
        snippet = ""
        try:
            snippet = resp.text()[:200]
        except Exception:
            pass
        raise RuntimeError(f"PDF download HTTP {resp.status}: {snippet}")
    data = resp.body()
    try:
        from pypdf import PdfReader
    except ImportError:
        raise RuntimeError("pypdf is required — pip install pypdf")
    reader = PdfReader(io.BytesIO(data))
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
    pdf_url: str | None = None,
    doc_title: str | None = None,
) -> int:
    """
    Download ``pdf_url`` (or ``ECI_PRESS_PDF_URL`` env), extract text, LLM-parse turnout for ``states``, upsert.

    Returns number of states updated.
    """
    if not llm_json_fn:
        return 0
    url = (pdf_url or os.getenv("ECI_PRESS_PDF_URL") or "").strip()
    if not url:
        print("   [i] ECI press PDF: no URL — set --link or ECI_PRESS_PDF_URL.")
        return 0
    if not url.lower().startswith(("http://", "https://")):
        print(f"   [!] ECI press PDF: invalid URL scheme: {url[:80]!r}")
        return 0

    title = ((doc_title or os.getenv("ECI_PRESS_DOC_TITLE") or "").strip() or url)[:500]
    states_set = {s.strip() for s in states if isinstance(s, str) and s.strip()}
    if not states_set:
        return 0

    timeout_ms = int((os.getenv("ECI_PRESS_TIMEOUT_MS") or "120000").strip() or "120000")
    debug = (os.getenv("ECI_PRESS_DEBUG") or "").strip().lower() in ("1", "true", "yes")
    warm_ms = int((os.getenv("ECI_PRESS_DIRECT_WARM_MS") or "2000").strip() or "2000")

    pdf_url_resolved = url
    if not urlparse(pdf_url_resolved).netloc:
        pdf_url_resolved = urljoin("https://www.eci.gov.in/", pdf_url_resolved)

    with _eci_press_playwright(timeout_ms) as (context, page):
        if debug:
            print(f"      [ECI_PRESS_DEBUG] PDF: {pdf_url_resolved[:160]}…")
        page.goto(ECINET_UPDATES_URL, wait_until="domcontentloaded", timeout=timeout_ms)
        page.wait_for_timeout(warm_ms)
        try:
            text = _download_pdf_text_via_context(context, pdf_url_resolved, timeout_ms=timeout_ms)
        except Exception as e:
            print(f"   [!] ECI press PDF fetch/extract failed: {e}")
            return 0

    if len(text.strip()) < 80:
        print("   [!] ECI press PDF: extracted text too short — skipping LLM.")
        return 0

    extracted = _llm_turnout_from_press_text(text, sorted(states_set), llm_json=llm_json_fn)
    if not extracted:
        print(
            f"   [i] ECI press PDF: LLM returned no turnout rows for states {sorted(states_set)} "
            f"— check PDF or --force-states."
        )

    run_ts = now.astimezone(IST).strftime("%Y-%m-%d %H:%M")
    slot = f"FINAL · ECI press PDF · {run_ts} IST"
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
            pdf_url_resolved,
            title,
            slot,
        )
        print(f"   -> [ECI PDF] {canon}  {nums['turnout_min']}%–{nums['turnout_max']}%  ({title[:60]}…)")
        n += 1
    return n
