"""
DHARMA-OSINT — Intel metrics on constituencies (volatility_score).

Hotspots in the UI are computed live from signals (no DB table needed).
Volatility is a persisted 0–100 mathematical index so maps and sorts stay fast.

Run on a schedule (e.g. hourly) after signal_ingestor / dossier jobs:
    python intel_ingestor.py
    python intel_ingestor.py --once

Requires SUPABASE_SERVICE_ROLE_KEY (RLS-safe writes).
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any

from dotenv import load_dotenv
from supabase import create_client, Client

env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
load_dotenv(dotenv_path=env_path)

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")

try:
    supabase: Client | None = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_URL and SUPABASE_KEY else None
except Exception:
    supabase = None

# --- Formula (v1): transparent, deterministic, easy to tune ---
SIGNAL_LOOKBACK_DAYS = 14
MAX_CONTEST_POINTS = 28.0  # extra candidates beyond 2
PER_EXTRA_CANDIDATE = 5.0
MAX_CRIM_POINTS = 32.0
PER_CRIM_UNIT = 2.0  # per capped case unit per candidate
CRIM_CAP_PER_CANDIDATE = 4
MAX_SIG_POINTS = 45.0
PER_SEVERITY_UNIT = 3.5  # sum(severity) over recent signals


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def volatility_for_seat(candidate_rows: list[dict[str, Any]], signal_rows: list[dict[str, Any]]) -> float:
    n = len(candidate_rows)
    # Contest: two-candidate race is baseline; each additional contestant adds noise
    extra = max(0, n - 2)
    contest = min(MAX_CONTEST_POINTS, extra * PER_EXTRA_CANDIDATE)

    crim_units = 0
    for c in candidate_rows:
        raw = int(c.get("criminal_cases") or 0)
        crim_units += min(CRIM_CAP_PER_CANDIDATE, max(0, raw))
    criminal = min(MAX_CRIM_POINTS, crim_units * PER_CRIM_UNIT)

    sev_sum = 0.0
    for s in signal_rows:
        sev_sum += float(s.get("severity") or 1)
    signals = min(MAX_SIG_POINTS, sev_sum * PER_SEVERITY_UNIT)

    total = contest + criminal + signals
    return max(0.0, min(100.0, round(total, 2)))


def run_once() -> None:
    if not supabase:
        print("CRITICAL: Supabase client missing.")
        sys.exit(1)
    print("[intel] Supabase client ready.")

    since = (_utc_now() - timedelta(days=SIGNAL_LOOKBACK_DAYS)).isoformat()
    const_res = supabase.table("constituencies").select("id").limit(5000).execute()
    cand_res = supabase.table("candidates").select("id,constituency_id,criminal_cases").limit(15000).execute()
    sig_res = (
        supabase.table("signals")
        .select("id,constituency_id,severity,created_at")
        .gte("created_at", since)
        .limit(8000)
        .execute()
    )

    c_ids = [r["id"] for r in (const_res.data or [])]
    by_cand: dict[str, list[dict[str, Any]]] = {}
    for row in cand_res.data or []:
        cid = row.get("constituency_id")
        if not cid:
            continue
        by_cand.setdefault(str(cid), []).append(row)

    by_sig: dict[str, list[dict[str, Any]]] = {}
    for row in sig_res.data or []:
        cid = row.get("constituency_id")
        if cid is None or cid == "":
            continue
        by_sig.setdefault(str(cid), []).append(row)

    updated = 0
    now_iso = _utc_now().isoformat()
    for cid in c_ids:
        score = volatility_for_seat(by_cand.get(cid, []), by_sig.get(cid, []))
        try:
            supabase.table("constituencies").update(
                {"volatility_score": score, "volatility_updated_at": now_iso}
            ).eq("id", cid).execute()
            updated += 1
        except Exception as e:
            err = str(e).lower()
            if "volatility_updated_at" in err or "column" in err or "schema" in err:
                try:
                    supabase.table("constituencies").update({"volatility_score": score}).eq("id", cid).execute()
                    updated += 1
                except Exception as e2:
                    print(f"   [!] {cid}: {e2}")
            else:
                print(f"   [!] {cid}: {e}")

    print(f"[intel] Updated volatility_score for {updated} constituencies (formula v1).")


def main() -> None:
    print("=== DHARMA-OSINT intel_ingestor (volatility) ===")
    run_once()


if __name__ == "__main__":
    main()
