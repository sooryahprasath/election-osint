import argparse
import json
import os
import re
import time
from dataclasses import dataclass
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

STATE_NAME_TO_PREFIX: dict[str, str] = {
    "Tamil Nadu": "TN",
    "West Bengal": "WB",
    "Kerala": "KER",
    "Assam": "ASM",
    "Puducherry": "PY",
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


def sb_select(table: str, select: str, *, limit: int = 10000) -> list[dict[str, Any]]:
    base = _sb_rest_url()
    headers = _sb_rest_headers()
    out: list[dict[str, Any]] = []
    step = 1000
    for i in range(0, limit, step):
        r = requests.get(
            f"{base}/rest/v1/{table}",
            headers=headers,
            params={"select": select, "limit": step, "offset": i},
            timeout=60,
        )
        if r.status_code >= 300:
            raise RuntimeError(f"supabase_http_{r.status_code}: {r.text[:400]}")
        rows = r.json() if r.text else []
        if not rows:
            break
        out.extend(rows)
        if len(rows) < step:
            break
    return out


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


def norm_name(s: str) -> str:
    s2 = re.sub(r"[\u200b-\u200f\u202a-\u202e]", " ", s or "")
    s2 = re.sub(r"\((sc|st)\)", " ", s2, flags=re.IGNORECASE)
    s2 = s2.lower()
    s2 = re.sub(r"[^a-z0-9\s]", " ", s2)
    s2 = re.sub(r"\s+", " ", s2).strip()
    return s2


def token_overlap(a: str, b: str) -> float:
    ta = set(norm_name(a).split())
    tb = set(norm_name(b).split())
    if not ta or not tb:
        return 0.0
    inter = len(ta & tb)
    return inter / max(1, min(len(ta), len(tb)))


@dataclass(frozen=True)
class MatchHit:
    constituency_id: str
    score: float


def best_constituency_match(raw_name: str, consts: list[dict[str, Any]]) -> MatchHit | None:
    rn = norm_name(raw_name)
    if not rn:
        return None
    best: MatchHit | None = None
    for c in consts:
        cid = str(c.get("id") or "")
        cn = str(c.get("name") or "")
        sc = token_overlap(rn, cn)
        if best is None or sc > best.score:
            best = MatchHit(constituency_id=cid, score=sc)
    if not best or best.score < 0.66:
        return None
    return best


def read_eci_xlsx(path: Path) -> pd.DataFrame:
    # ECI files have preamble + merged headers. We detect the real header row by the first cell.
    raw = pd.read_excel(path, sheet_name=0, header=None, dtype=object)
    col0 = raw.iloc[:, 0].astype(str)
    hits = raw.index[col0.str.contains("STATE/UT NAME", case=False, na=False)].tolist()
    if not hits:
        raise RuntimeError(f"header_not_found: {path.name}")
    h = hits[0]
    df = raw.iloc[h + 1 :].copy()
    df.columns = [str(x).strip() for x in raw.iloc[h].tolist()]
    df = df.dropna(how="all")
    return df


def parse_state_file(df: pd.DataFrame, *, state: str, year: int, consts: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    req = ["AC NO.", "AC NAME", "CANDIDATE NAME", "PARTY", "TOTAL", "TOTAL ELECTORS"]
    for c in req:
        if c not in df.columns:
            raise RuntimeError(f"missing_column:{c}")

    def clean_candidate_name(x: Any) -> str:
        s = str(x or "").strip()
        s = re.sub(r"^\s*\d+\s+", "", s)
        return s.strip()

    df2 = df.copy()
    df2["AC NAME"] = df2["AC NAME"].astype(str).str.strip()
    df2["CANDIDATE NAME"] = df2["CANDIDATE NAME"].map(clean_candidate_name)
    df2["PARTY"] = df2["PARTY"].astype(str).str.strip().str.upper()
    df2["TOTAL"] = pd.to_numeric(df2["TOTAL"], errors="coerce")
    df2["TOTAL ELECTORS"] = pd.to_numeric(df2["TOTAL ELECTORS"], errors="coerce")

    upserts: list[dict[str, Any]] = []
    unmatched: list[dict[str, Any]] = []
    const_ids = {str(c.get("id") or "") for c in consts}
    prefix = STATE_NAME_TO_PREFIX.get(state, "")

    for (ac_no, ac_name), g in df2.groupby(["AC NO.", "AC NAME"], dropna=False):
        ac_name_raw = str(ac_name or "").strip()
        if not ac_name_raw or ac_name_raw.lower() == "nan":
            continue
        try:
            ac_int = int(float(ac_no))
        except Exception:
            ac_int = None
        if ac_int is None:
            continue
        electors = int(g["TOTAL ELECTORS"].dropna().iloc[0]) if g["TOTAL ELECTORS"].dropna().shape[0] else None

        gg = g.dropna(subset=["TOTAL"]).copy()
        if gg.empty:
            continue
        # Exclude NOTA from winner/runner-up selection
        gg = gg[~gg["CANDIDATE NAME"].astype(str).str.fullmatch("NOTA", case=False, na=False)]
        if gg.empty:
            continue
        gg = gg.sort_values("TOTAL", ascending=False)
        winner = gg.iloc[0]
        runner = gg.iloc[1] if len(gg) > 1 else None

        winner_votes = int(winner["TOTAL"]) if pd.notna(winner["TOTAL"]) else None
        runner_votes = int(runner["TOTAL"]) if runner is not None and pd.notna(runner["TOTAL"]) else None
        margin_votes = (winner_votes - runner_votes) if winner_votes is not None and runner_votes is not None else None

        total_votes_polled = int(g["TOTAL"].dropna().sum()) if g["TOTAL"].dropna().shape[0] else None
        turnout_pct = None
        if total_votes_polled is not None and electors:
            turnout_pct = round((total_votes_polled / electors) * 100.0, 2)

        hit = None
        if prefix and ac_int is not None:
            cid = f"{prefix}-{ac_int:03d}"
            if cid in const_ids:
                hit = MatchHit(constituency_id=cid, score=1.0)
        if not hit:
            hit = best_constituency_match(ac_name_raw, consts)
        if not hit:
            unmatched.append(
                {
                    "ac_no": ac_no,
                    "constituency_name_raw": ac_name_raw,
                    "winner_name": str(winner["CANDIDATE NAME"]),
                    "winner_party": str(winner["PARTY"]),
                    "winner_votes": winner_votes,
                    "runner_up_name": str(runner["CANDIDATE NAME"]) if runner is not None else None,
                    "runner_up_party": str(runner["PARTY"]) if runner is not None else None,
                    "runner_up_votes": runner_votes,
                    "margin_votes": margin_votes,
                    "total_votes_polled": total_votes_polled,
                    "total_electors": electors,
                    "turnout_pct": turnout_pct,
                }
            )
            continue

        upserts.append(
            {
                "state": state,
                "election_year": year,
                "constituency_id": hit.constituency_id,
                "constituency_name_raw": ac_name_raw,
                "winner_name": str(winner["CANDIDATE NAME"]),
                "winner_party": str(winner["PARTY"]),
                "runner_up_name": str(runner["CANDIDATE NAME"]) if runner is not None else None,
                "runner_up_party": str(runner["PARTY"]) if runner is not None else None,
                "winner_votes": winner_votes,
                "runner_up_votes": runner_votes,
                "margin_votes": margin_votes,
                "total_votes_polled": total_votes_polled,
                "total_electors": electors,
                "turnout_pct": turnout_pct,
                "margin_pct": None,
                "source_url": None,
                "source_note": "eci_xlsx",
            }
        )

    return upserts, unmatched


def ingest_xlsx(*, path: Path, state: str, year: int, dry_run: bool) -> dict[str, Any]:
    consts = sb_select("constituencies", "id,name,state", limit=5000)
    consts = [c for c in consts if str(c.get("state") or "") == state]

    df = read_eci_xlsx(path)
    upserts, unmatched = parse_state_file(df, state=state, year=year, consts=consts)

    if not dry_run and upserts:
        uniq: dict[tuple[str, int, str], dict[str, Any]] = {}
        for u in upserts:
            uniq[(state, year, str(u["constituency_id"]))] = u
        rows = list(uniq.values())
        for i in range(0, len(rows), 250):
            sb_upsert("constituency_results", rows[i : i + 250], on_conflict="state,election_year,constituency_id")
            time.sleep(0.15)

    report_dir = ROOT / "artifacts" / "eci_xlsx_ingest"
    report_dir.mkdir(parents=True, exist_ok=True)
    (report_dir / f"unmatched_{state.replace(' ', '_').lower()}_{year}.json").write_text(
        json.dumps({"state": state, "year": year, "xlsx": path.name, "unmatched": unmatched[:400]}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    return {"state": state, "xlsx": str(path), "upserted": len(upserts), "unmatched": len(unmatched)}


def main() -> None:
    load_env_files()
    p = argparse.ArgumentParser(description="Ingest ECI XLSX '10 - Detailed Results' into constituency_results (best-effort).")
    p.add_argument("--state", help="State abbreviation (TN/WB/KL/AS/PY) or full name", required=False)
    p.add_argument("--year", type=int, default=2021)
    p.add_argument("--path", help="Path to a single XLSX to ingest", required=False)
    p.add_argument("--dir", help="Directory of XLSX (default: osint_workers/historical_data)", default=str(Path(__file__).resolve().parent / "historical_data"))
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    if args.path:
        files = [Path(args.path)]
    else:
        files = sorted(Path(args.dir).glob("*.xlsx"))
    if not files:
        raise RuntimeError(f"no_xlsx_found: dir={args.dir}")

    selected_state: str | None = None
    if args.state:
        s = str(args.state).strip()
        selected_state = STATE_ABBR_TO_NAME.get(s.upper(), s)

    out = []
    for path in files:
        m = re.search(r"_([A-Z]{2})\.xlsx$", path.name)
        inferred = STATE_ABBR_TO_NAME.get(m.group(1).upper()) if m else None
        if selected_state and inferred and inferred != selected_state:
            continue
        state = inferred or selected_state
        if not state:
            raise RuntimeError(f"cannot_infer_state: pass --state for {path.name}")
        print(f"[eci_xlsx] ingest state={state} year={args.year} xlsx={path.name} dry_run={args.dry_run}", flush=True)
        r = ingest_xlsx(path=path, state=state, year=args.year, dry_run=args.dry_run)
        out.append(r)
        print(f"[eci_xlsx] {state}: upserted={r['upserted']} unmatched={r['unmatched']}", flush=True)

    print(f"[eci_xlsx] DONE files={len(out)}", flush=True)


if __name__ == "__main__":
    main()

