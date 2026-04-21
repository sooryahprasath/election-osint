import argparse
import json
import os
import re
import time
from pathlib import Path
from typing import Any

import pandas as pd
import requests


ROOT = Path(__file__).resolve().parents[1]

STATE_ABBR_TO_NAME: dict[str, str] = {
    "TN": "Tamil Nadu",
    "WB": "West Bengal",
    "KL": "Kerala",
    "AS": "Assam",
    "PY": "Puducherry",
}


def load_env_files() -> None:
    for p in [ROOT / ".env", ROOT / ".env.local"]:
        if not p.exists():
            continue
        for raw in p.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            key = k.strip()
            val = v.strip().strip('"').strip("'")
            if not key:
                continue
            os.environ.setdefault(key, val)


def _sb_rest_headers() -> dict[str, str]:
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or ""
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") or ""
    if not url or not key:
        raise RuntimeError("missing_supabase_env: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (preferred)")
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }


def _sb_rest_url() -> str:
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or ""
    if not url:
        raise RuntimeError("missing_supabase_env: set SUPABASE_URL (preferred) or NEXT_PUBLIC_SUPABASE_URL")
    return url.rstrip("/")


def sb_upsert(table: str, rows: list[dict[str, Any]], *, on_conflict: str) -> None:
    if not rows:
        return
    base = _sb_rest_url()
    headers = _sb_rest_headers()
    r = requests.post(
        f"{base}/rest/v1/{table}?on_conflict={on_conflict}",
        headers=headers,
        data=json.dumps(rows, ensure_ascii=False),
        timeout=120,
    )
    if r.status_code >= 300:
        raise RuntimeError(f"supabase_http_{r.status_code}: {r.text[:400]}")


def read_xlsx(path: Path) -> pd.DataFrame:
    # Small fixed-size summary sheet; simplest is to read raw and index by row labels.
    df = pd.read_excel(path, sheet_name=0, header=None, dtype=object)
    return df


def _to_int(x: Any) -> int | None:
    try:
        if x is None:
            return None
        if isinstance(x, str) and not x.strip():
            return None
        v = int(float(x))
        return v
    except Exception:
        return None


def _to_float(x: Any) -> float | None:
    try:
        if x is None:
            return None
        if isinstance(x, str) and not x.strip():
            return None
        return float(x)
    except Exception:
        return None


def parse_summary(df: pd.DataFrame) -> dict[str, dict[str, Any]]:
    """
    Returns mapping of constituency_type -> fields.
    Types: GEN / SC / ST / TOTAL.
    """
    # Find the row with headers "GEN SC ST TOTAL"
    # In your AS file it's on the row after "TYPE OF CONSTITUENCY".
    txt = df.fillna("").astype(str)
    header_rows = txt.index[txt.apply(lambda r: "GEN" in r.to_list() and "SC" in r.to_list() and "ST" in r.to_list() and "TOTAL" in r.to_list(), axis=1)].tolist()
    if not header_rows:
        raise RuntimeError("cannot_find_GEN_SC_ST_TOTAL_header")
    h = header_rows[0]
    header = [x.strip().upper() for x in txt.iloc[h].to_list()]
    # locate the columns for GEN/SC/ST/TOTAL
    col_by_type: dict[str, int] = {}
    for i, v in enumerate(header):
        if v in ("GEN", "SC", "ST", "TOTAL"):
            col_by_type[v] = i
    if any(t not in col_by_type for t in ("GEN", "SC", "ST", "TOTAL")):
        raise RuntimeError("missing_one_of_types_GEN_SC_ST_TOTAL")

    def find_row(substr: str) -> int | None:
        hits = txt.index[txt.apply(lambda r: any(substr in c.upper() for c in r.to_list()), axis=1)].tolist()
        return hits[0] if hits else None

    # Electors (including service voters)
    male_e = find_row("ELECTORS(INCLUDING SERVICE VOTERS)")
    # We want rows after this block with labels MALE/FEMALE/THIRD GENDER/TOTAL
    if male_e is None:
        raise RuntimeError("missing_electors_block")
    # Candidate rows are offset by known labels
    def row_after(start: int, label: str) -> int:
        for i in range(start, min(start + 10, len(txt))):
            if any(label in c.upper() for c in txt.iloc[i].to_list()):
                return i
        raise RuntimeError(f"missing_row_label:{label}")

    r_e_male = row_after(male_e, "MALE")
    r_e_female = row_after(male_e, "FEMALE")
    r_e_third = row_after(male_e, "THIRD")
    r_e_total = row_after(male_e, "TOTAL")

    # Electors who voted
    voted_blk = find_row("ELECTORS WHO VOTED")
    if voted_blk is None:
        raise RuntimeError("missing_voted_block")
    r_v_male = row_after(voted_blk, "MALE")
    r_v_female = row_after(voted_blk, "FEMALE")
    r_v_third = row_after(voted_blk, "THIRD")
    # "TOTAL" in voted block appears later (after postal/test votes). We'll compute voted_total from row with "3.f" TOTAL if present.
    r_v_total = None
    for i in range(voted_blk, min(voted_blk + 20, len(txt))):
        if any("TOTAL" == c.strip().upper() for c in txt.iloc[i].to_list()) and any("3" in c for c in txt.iloc[i].to_list()):
            r_v_total = i
            break
    # fallback: first TOTAL after voted block
    if r_v_total is None:
        for i in range(voted_blk, min(voted_blk + 25, len(txt))):
            if any("TOTAL" == c.strip().upper() for c in txt.iloc[i].to_list()):
                r_v_total = i
                break

    poll_row = find_row("POLL PERCENTAGE")

    out: dict[str, dict[str, Any]] = {}
    for t in ("GEN", "SC", "ST", "TOTAL"):
        ci = col_by_type[t]
        out[t] = {
            "electors_male": _to_int(df.iloc[r_e_male, ci]),
            "electors_female": _to_int(df.iloc[r_e_female, ci]),
            "electors_third": _to_int(df.iloc[r_e_third, ci]),
            "electors_total": _to_int(df.iloc[r_e_total, ci]),
            "voted_male": _to_int(df.iloc[r_v_male, ci]),
            "voted_female": _to_int(df.iloc[r_v_female, ci]),
            "voted_third": _to_int(df.iloc[r_v_third, ci]),
            "voted_total": _to_int(df.iloc[r_v_total, ci]) if r_v_total is not None else None,
            "poll_pct": _to_float(df.iloc[poll_row, ci]) if poll_row is not None else None,
        }
    return out


def infer_state(path: Path, explicit: str | None) -> str:
    if explicit:
        s = explicit.strip()
        return STATE_ABBR_TO_NAME.get(s.upper(), s)
    m = re.search(r"_([A-Z]{2})\.(xlsx|xls)$", path.name)
    if m:
        ab = m.group(1).upper()
        return STATE_ABBR_TO_NAME.get(ab, ab)
    raise RuntimeError(f"cannot_infer_state: pass --state for {path.name}")


def ingest_file(*, path: Path, state: str, year: int, dry_run: bool) -> dict[str, Any]:
    df = read_xlsx(path)
    parsed = parse_summary(df)
    rows = []
    for ctype, fields in parsed.items():
        rows.append(
            {
                "state": state,
                "election_year": year,
                "constituency_type": ctype,
                **fields,
            }
        )
    if not dry_run:
        sb_upsert("state_electors_summary", rows, on_conflict="state,election_year,constituency_type")
        time.sleep(0.1)
    return {"state": state, "file": str(path), "rows": len(rows)}


def main() -> None:
    load_env_files()
    p = argparse.ArgumentParser(description="Ingest ECI 'Electors Data Summary' XLSX into state_electors_summary.")
    p.add_argument("--year", type=int, default=2021)
    p.add_argument("--state", help="State abbr (AS/KL/TN/WB/PY) or full name", required=False)
    p.add_argument("--path", help="Single XLSX path", required=False)
    p.add_argument("--dir", default=str(Path(__file__).resolve().parent / "historical_data"), help="Directory to scan for Electors Data Summary files")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    files: list[Path] = []
    if args.path:
        files = [Path(args.path)]
    else:
        d = Path(args.dir)
        files = sorted(d.glob("*Electors*Summary*.xlsx"))
        files += sorted(d.glob("*Electors*Summary*.xls"))
    if not files:
        raise RuntimeError(f"no_files_found: dir={args.dir} (or pass --path)")

    out = []
    for f in files:
        state = infer_state(f, args.state)
        print(f"[eci_electors] ingest state={state} year={args.year} file={f.name} dry_run={args.dry_run}", flush=True)
        r = ingest_file(path=f, state=state, year=args.year, dry_run=args.dry_run)
        out.append(r)
        print(f"[eci_electors] {state}: rows={r['rows']}", flush=True)
    print(f"[eci_electors] DONE files={len(out)}", flush=True)


if __name__ == "__main__":
    main()

