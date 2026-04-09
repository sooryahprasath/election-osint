"""
Official ECI "Polling Trend (Voter Turnout)" on ECINet unified portal.

URL: https://ecinet.eci.gov.in/homepage/home/pollingTrend

How it works (reverse-engineered from the public SPA bundle, main.*.js):
  - The React app is configured with REACT_APP_ENCORE_BASE_URL = https://encore.eci.gov.in
  - Constants include VTURNOUT / POLLDAY_URL = "/tcs/v1/get-voterturnout"
  - Dropdowns reference ENCORE_GET_ELECTION_LIST "/getElectionType", ENCORE_GET_STATE_LIST
    "/getStateList", ENCORE_GET_PHASE_LIST "/getPhaseList", etc.

Direct HTTP calls to encore.eci.gov.in/tcs/v1/get-voterturnout from a server often return 404 or
are blocked (WAF, routing, missing gateway prefix, or body schema). The reliable approach for
automation is to drive the **same UI** the public uses: Playwright (already used in dossier_ingestor).

Env:
  TURNOUT_NUMBERS_SOURCE=eci       — batch ECINet for %; AI only for booth lines (voting_day_ingestor).
  TURNOUT_ECI_POLLING_TREND=1      — per-state ECI merge inside full grounded pipeline (legacy).
  TURNOUT_ECI_HEADLESS=0           — visible browser for debugging
  ECI_SCRAPE_GRACE_MIN             — minutes after slot time before scrape (default 12).
                                     Cached batch results are reused until the IST fingerprint changes (new slot + grace
                                     or COP/final), so VOTING_INGEST_INTERVAL_SEC can refresh booth news often without
                                     re-running Playwright every cycle.

CLI test:
  cd osint_workers && source .venv/bin/activate && python eci_polling_trend.py Kerala
"""
from __future__ import annotations

import argparse
import os
import re
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")

ECI_INTRADAY_SLOT_MINUTES: tuple[int, ...] = (
    9 * 60 + 0,
    11 * 60 + 0,
    13 * 60 + 0,
    15 * 60 + 0,
    17 * 60 + 0,
)
ECI_COP_START_MINUTE = 18 * 60 + 30

ECINET_POLLING_TREND_URL = "https://ecinet.eci.gov.in/homepage/home/pollingTrend"

# In-process cache: avoid launching Playwright every cycle when ECI data window unchanged.
_eci_batch_cache: dict[str, Any] = {"fingerprint": None, "monotonic_ts": 0.0, "by_state": {}}

# Labels as shown in the "Select State" dropdown (Assembly — GENERAL), phase 1.
STATE_TO_ECI_LABEL: dict[str, str] = {
    "Kerala": "Kerala - GENERAL",
    "Assam": "Assam - GENERAL",
    "Tamil Nadu": "Tamil Nadu - GENERAL",
    "West Bengal": "West Bengal - GENERAL",
    "Puducherry": "Puducherry - GENERAL",
}


def _parse_table_turnout(page) -> dict[str, float]:
    """Read first numeric data row; map column header text -> float %."""
    table = page.locator("table").first
    table.wait_for(state="visible", timeout=60000)
    rows = table.locator("tr")
    n = rows.count()
    if n < 2:
        return {}
    header_cells = rows.nth(0).locator("th, td")
    hc = header_cells.count()
    headers = [(header_cells.nth(i).inner_text() or "").strip() or f"c{i}" for i in range(hc)]
    out: dict[str, float] = {}
    for r in range(1, min(n, 5)):
        data_cells = rows.nth(r).locator("td")
        dc = data_cells.count()
        if dc == 0:
            continue
        row_vals: list[float] = []
        for i in range(dc):
            raw = (data_cells.nth(i).inner_text() or "").strip()
            m = re.search(r"(\d+(?:\.\d+)?)", raw.replace(",", ""))
            if not m:
                continue
            try:
                row_vals.append(float(m.group(1)))
            except ValueError:
                continue
        if not row_vals:
            continue
        for i, val in enumerate(row_vals):
            key = headers[i] if i < len(headers) else f"col_{i}"
            out[key] = val
        break
    return out


def _latest_nonzero_pct(slots: dict[str, float]) -> float | None:
    positives = [v for v in slots.values() if 0 < v <= 100]
    return max(positives) if positives else None


def eci_numbers_primary_enabled() -> bool:
    return (os.getenv("TURNOUT_NUMBERS_SOURCE") or "").strip().lower() == "eci"


def eci_batch_fingerprint(ist_now: datetime, *, finalize: bool) -> str:
    """
    Changes when IST crosses into a new ECI publish window (+ grace), so we re-scrape.
    """
    if ist_now.tzinfo is None:
        ist_now = ist_now.replace(tzinfo=IST)
    else:
        ist_now = ist_now.astimezone(IST)
    m = ist_now.hour * 60 + ist_now.minute
    grace = int((os.getenv("ECI_SCRAPE_GRACE_MIN") or "12").strip() or "12")
    parts = [ist_now.strftime("%Y-%m-%d")]
    for slot_m in ECI_INTRADAY_SLOT_MINUTES:
        if m >= slot_m + grace:
            parts.append(f"s{slot_m}")
    if finalize or m >= ECI_COP_START_MINUTE + grace:
        parts.append("COP")
    return "|".join(parts)


def _eci_cache_store(fingerprint: str, by_state: dict[str, Any]) -> None:
    import time

    _eci_batch_cache["fingerprint"] = fingerprint
    _eci_batch_cache["monotonic_ts"] = time.monotonic()
    _eci_batch_cache["by_state"] = by_state


def clear_eci_batch_cache() -> None:
    """Drop in-memory ECI batch (e.g. after deploy or to recover from a bad parse)."""
    _eci_batch_cache["fingerprint"] = None
    _eci_batch_cache["monotonic_ts"] = 0.0
    _eci_batch_cache["by_state"] = {}


def fetch_eci_batch_cached(
    states: list[str],
    phase: str,
    ist_now: datetime,
    *,
    finalize: bool,
    headless: bool | None = None,
    bust_cache: bool = False,
) -> dict[str, Any]:
    """
    One Playwright session: all states. Reuses cache while the IST schedule fingerprint is unchanged
    (so booth-only cycles can run often without re-scraping ECINet). New scrape when the day/slot/COP
    window advances (see eci_batch_fingerprint).

    """
    if ist_now.tzinfo is None:
        ist_now = ist_now.replace(tzinfo=IST)
    else:
        ist_now = ist_now.astimezone(IST)

    if bust_cache:
        clear_eci_batch_cache()

    st_key = "+".join(sorted(s.strip() for s in states))
    fp = f"{eci_batch_fingerprint(ist_now, finalize=finalize)}|ph={phase}|{st_key}"

    if _eci_batch_cache.get("fingerprint") == fp:
        return dict(_eci_batch_cache.get("by_state") or {})

    by_state = fetch_eci_polling_trend_batch_playwright(states, phase, headless=headless)
    _eci_cache_store(fp, by_state)
    return by_state


def _apply_eci_form_submit_parse(page, label: str, phase: str, timeout_ms: int) -> dict[str, Any] | None:
    selects = page.locator("select")
    nsel = selects.count()
    if nsel >= 3:
        try:
            selects.nth(0).select_option(label=re.compile(r"assembly", re.I))
        except Exception:
            try:
                selects.nth(0).select_option(index=1)
            except Exception:
                pass
        try:
            selects.nth(1).select_option(label=label)
        except Exception:
            try:
                selects.nth(1).select_option(label=re.compile(re.escape(label), re.I))
            except Exception:
                selects.nth(1).select_option(label=re.compile(re.escape(label.split(" - ")[0]), re.I))
        try:
            selects.nth(2).select_option(label=phase)
        except Exception:
            try:
                selects.nth(2).select_option(label=re.compile(rf"^\s*{re.escape(phase)}\s*$"))
            except Exception:
                selects.nth(2).select_option(index=int(phase) - 1 if phase.isdigit() else 0)
    else:
        combos = page.get_by_role("combobox")
        if combos.count() < 3:
            return None
        combos.nth(0).click()
        page.get_by_role("option", name=re.compile(r"assembly", re.I)).first.click()
        page.wait_for_timeout(400)
        combos.nth(1).click()
        page.get_by_role("option", name=re.compile(re.escape(label), re.I)).first.click()
        page.wait_for_timeout(400)
        combos.nth(2).click()
        page.get_by_role("option", name=re.compile(rf"^{re.escape(phase)}\b")).first.click()

    page.wait_for_timeout(500)
    submit = page.get_by_role("button", name=re.compile(r"submit", re.I))
    if submit.count():
        submit.first.click()
    else:
        page.locator("button").filter(has_text=re.compile(r"submit", re.I)).first.click()

    # SPA table update is sometimes delayed; retry once before declaring "no data".
    page.wait_for_timeout(4500)
    slots = _parse_table_turnout(page)
    latest = _latest_nonzero_pct(slots)
    if latest is None:
        page.wait_for_timeout(6500)
        slots2 = _parse_table_turnout(page)
        if slots2:
            slots = slots2
            latest = _latest_nonzero_pct(slots)
    if latest is None and not slots:
        return None
    return {
        "source_url": ECINET_POLLING_TREND_URL,
        "phase": phase,
        "slots": slots,
        "latest_pct": latest,
        "turnout_pct": latest,
    }


def fetch_eci_polling_trend_batch_playwright(
    states: list[str],
    phase: str,
    *,
    headless: bool | None = None,
    timeout_ms: int = 120000,
) -> dict[str, Any]:
    """Single browser: iterate states, re-submit each time. Returns { state_name: snapshot }."""
    out: dict[str, Any] = {}
    to_fetch = [s for s in states if isinstance(s, str) and STATE_TO_ECI_LABEL.get(s.strip())]
    if not to_fetch:
        return out

    if headless is None:
        headless = (os.getenv("TURNOUT_ECI_HEADLESS") or "1").strip().lower() not in (
            "0",
            "false",
            "no",
        )

    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        launch_args: list[str] = []
        if headless:
            # ECINet is sensitive to automation signals; reduce the most obvious ones.
            launch_args = [
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-dev-shm-usage",
            ]
        browser = p.chromium.launch(headless=headless, args=launch_args)
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            ),
            locale="en-IN",
        )
        if headless:
            context.add_init_script(
                """
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                """
            )
        page = context.new_page()
        try:
            page.goto(ECINET_POLLING_TREND_URL, wait_until="domcontentloaded", timeout=timeout_ms)
            page.wait_for_timeout(2500)
            for st in to_fetch:
                try:
                    label = STATE_TO_ECI_LABEL[st.strip()]
                    snap = _apply_eci_form_submit_parse(page, label, phase, timeout_ms)
                    if snap:
                        snap["state"] = st
                    out[st] = snap
                except Exception:
                    out[st] = None
            browser.close()
        except Exception:
            browser.close()
            raise
    return out


def fetch_eci_polling_trend_playwright(
    state: str,
    *,
    phase: str = "1",
    headless: bool | None = None,
    timeout_ms: int = 90000,
) -> dict[str, Any] | None:
    """Single-state wrapper around batch fetch (opens one browser)."""
    m = fetch_eci_polling_trend_batch_playwright([state], phase, headless=headless, timeout_ms=timeout_ms)
    return m.get(state) or None


def eci_polling_enabled() -> bool:
    if eci_numbers_primary_enabled():
        return True
    v = (os.getenv("TURNOUT_ECI_POLLING_TREND") or "").strip().lower()
    return v in ("1", "true", "yes", "on")


def main() -> None:
    ap = argparse.ArgumentParser(description="Test ECINet polling trend scrape (Playwright).")
    ap.add_argument("state", nargs="?", default="Kerala", help="State key, e.g. Kerala")
    ap.add_argument("--phase", default="1")
    ap.add_argument("--visible", action="store_true", help="Non-headless browser")
    args = ap.parse_args()
    data = fetch_eci_polling_trend_playwright(
        args.state, phase=args.phase, headless=not args.visible
    )
    print(data)


if __name__ == "__main__":
    main()
