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
  TURNOUT_ECI_POLLING_TREND=1|true   — enable fetch in turnout_grounded.run_grounded_turnout_pipeline
  TURNOUT_ECI_HEADLESS=0            — set to run visible browser for debugging selectors

CLI test:
  cd osint_workers && source .venv/bin/activate && python eci_polling_trend.py Kerala
"""
from __future__ import annotations

import argparse
import os
import re
from typing import Any

ECINET_POLLING_TREND_URL = "https://ecinet.eci.gov.in/homepage/home/pollingTrend"

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


def fetch_eci_polling_trend_playwright(
    state: str,
    *,
    phase: str = "1",
    headless: bool | None = None,
    timeout_ms: int = 90000,
) -> dict[str, Any] | None:
    """
    Open ECINet polling trend, choose Assembly + state + phase, submit, parse table.
    Returns dict with slots, latest_pct, source_url — or None on failure.
    """
    label = STATE_TO_ECI_LABEL.get(state.strip())
    if not label:
        return None

    if headless is None:
        headless = (os.getenv("TURNOUT_ECI_HEADLESS") or "1").strip().lower() not in (
            "0",
            "false",
            "no",
        )

    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            ),
            locale="en-IN",
        )
        page = context.new_page()
        try:
            page.goto(ECINET_POLLING_TREND_URL, wait_until="domcontentloaded", timeout=timeout_ms)
            page.wait_for_timeout(2500)

            # Strategy A: native <select> elements (if present)
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
                        selects.nth(1).select_option(
                            label=re.compile(re.escape(label.split(" - ")[0]), re.I)
                        )
                try:
                    selects.nth(2).select_option(label=phase)
                except Exception:
                    try:
                        selects.nth(2).select_option(label=re.compile(rf"^\s*{re.escape(phase)}\s*$"))
                    except Exception:
                        selects.nth(2).select_option(index=int(phase) - 1 if phase.isdigit() else 0)
            else:
                # Strategy B: MUI / combobox
                combos = page.get_by_role("combobox")
                cnt = combos.count()
                if cnt >= 3:
                    combos.nth(0).click()
                    page.get_by_role("option", name=re.compile(r"assembly", re.I)).first.click()
                    page.wait_for_timeout(400)
                    combos.nth(1).click()
                    page.get_by_role("option", name=re.compile(re.escape(label), re.I)).first.click()
                    page.wait_for_timeout(400)
                    combos.nth(2).click()
                    page.get_by_role("option", name=re.compile(rf"^{re.escape(phase)}\b")).first.click()
                else:
                    browser.close()
                    return None

            page.wait_for_timeout(500)
            submit = page.get_by_role("button", name=re.compile(r"submit", re.I))
            if submit.count():
                submit.first.click()
            else:
                page.locator("button").filter(has_text=re.compile(r"submit", re.I)).first.click()

            page.wait_for_timeout(4000)
            slots = _parse_table_turnout(page)
            latest = _latest_nonzero_pct(slots)
            browser.close()
            if latest is None and not slots:
                return None
            return {
                "source_url": ECINET_POLLING_TREND_URL,
                "state": state,
                "phase": phase,
                "slots": slots,
                "latest_pct": latest,
                "turnout_pct": latest,
            }
        except Exception:
            browser.close()
            raise


def eci_polling_enabled() -> bool:
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
