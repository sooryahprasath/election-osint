import argparse
import csv
import json
import os
import re
import time
from pathlib import Path
from typing import Any


def load_env_files() -> None:
    root = Path(__file__).resolve().parents[1]
    for rel in [".env", ".env.local"]:
        p = root / rel
        if not p.exists():
            continue
        for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
            s = line.strip()
            if not s or s.startswith("#") or "=" not in s:
                continue
            k, v = s.split("=", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k and k not in os.environ:
                os.environ[k] = v


def supabase_env() -> tuple[str, str]:
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not url:
        raise RuntimeError("missing_supabase_env: set SUPABASE_URL (preferred) or NEXT_PUBLIC_SUPABASE_URL")
    if not key:
        raise RuntimeError("missing_supabase_env: set SUPABASE_SERVICE_ROLE_KEY (preferred) or NEXT_PUBLIC_SUPABASE_ANON_KEY")
    return url, key


def http_request(method: str, url: str, headers: dict[str, str], body: Any | None = None) -> Any:
    import urllib.request
    from urllib.error import HTTPError

    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers = {**headers, "Content-Type": "application/json"}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read().decode("utf-8", errors="ignore")
            if not raw:
                return None
            return json.loads(raw)
    except HTTPError as e:
        body_txt = ""
        try:
            body_txt = (e.read() or b"").decode("utf-8", errors="ignore")
        except Exception:
            body_txt = ""
        if e.code == 404:
            raise RuntimeError(
                "supabase_table_missing: got 404 from PostgREST. "
                "Run `constituency_results_migration.sql` (it now includes `constituency_electors_summary`) in Supabase SQL editor first."
            ) from e
        raise RuntimeError(f"supabase_http_error: {e.code} {e.reason} {body_txt}".strip()) from e


def sb_upsert(table: str, rows: list[dict[str, Any]], on_conflict: str) -> None:
    if not rows:
        return
    base, key = supabase_env()
    endpoint = f"{base}/rest/v1/{table}?on_conflict={on_conflict}"
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Prefer": "resolution=merge-duplicates,return=minimal"}
    http_request("POST", endpoint, headers=headers, body=rows)


def sb_select(
    table: str,
    select: str,
    *,
    filters: dict[str, str] | None = None,
    limit: int = 10000,
) -> list[dict[str, Any]]:
    import urllib.parse

    base, key = supabase_env()
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    step = 1000
    out: list[dict[str, Any]] = []
    for offset in range(0, max(0, int(limit)), step):
        params = {"select": select, "limit": str(step), "offset": str(offset)}
        if filters:
            params.update(filters)
        # Important: PostgREST filter values contain spaces and '%' (like.XXX-%).
        # Always URL-encode to avoid Cloudflare 1101 / worker exceptions upstream.
        qs = urllib.parse.urlencode(params, safe="(),.:*+-_", quote_via=urllib.parse.quote)
        url = f"{base.rstrip('/')}/rest/v1/{table}?{qs}"
        chunk = http_request("GET", url, headers=headers)
        if not chunk:
            break
        if not isinstance(chunk, list):
            break
        out.extend(chunk)
        if len(chunk) < step:
            break
    return out


STATE_PREFIX: dict[str, str] = {
    "Tamil Nadu": "TN",
    "Kerala": "KER",
    "West Bengal": "WB",
    "Assam": "ASM",
    "Puducherry": "PY",
}


def parse_index_card_csv(path: Path, *, year: int) -> dict[str, Any] | None:
    # CSV is an index-card style export with labels in col0/col1 and values in col2-5.
    rows: list[list[str]] = []
    with path.open("r", encoding="utf-8-sig", errors="ignore", newline="") as f:
        reader = csv.reader(f)
        for r in reader:
            rows.append([str(c or "").strip() for c in r])
    return parse_index_card_rows(rows, year=year, source_note=f"eci_constituency_summary_csv:{path.name}")


def parse_index_card_rows(rows_any: list[list[Any]], *, year: int, source_note: str) -> dict[str, Any] | None:
    """
    Parse an ECI 'Constituency Data Summary' index-card grid.
    Works for both CSV exports and XLSX sheets (list-of-lists).
    """
    rows: list[list[str]] = [[str(c or "").strip() for c in r] for r in (rows_any or [])]

    header = next((r for r in rows if r and r[0].strip().lower() == "state/ut"), None)
    if not header or len(header) < 4:
        return None

    state_raw = header[1].strip()
    constituency_raw = header[3].strip()

    state_name = None
    for k in STATE_PREFIX.keys():
        if k.lower() in state_raw.lower():
            state_name = k
            break
    if not state_name:
        # fall back: try to parse "S25-West Bengal"
        m = re.search(r"-\s*([A-Za-z ]+)\s*$", state_raw)
        if m:
            guess = m.group(1).strip()
            state_name = guess

    if not state_name or state_name not in STATE_PREFIX:
        return None

    m_ac = re.match(r"^\s*(\d+)\s*-\s*(.+?)\s*$", constituency_raw)
    if not m_ac:
        return None
    ac_no = int(m_ac.group(1))
    constituency_name_raw = m_ac.group(2).strip()
    constituency_id = f"{STATE_PREFIX[state_name]}-{ac_no:03d}"

    electors = None
    voters = None
    poll_pct = None

    def parse_gender_counts(r: list[str]) -> dict[str, int] | None:
        # expected: col2=male col3=female col4=third col5=total
        if len(r) < 6:
            return None
        try:
            male = int(float(r[2] or 0))
            female = int(float(r[3] or 0))
            third = int(float(r[4] or 0))
            total = int(float(r[5] or 0))
            return {"male": male, "female": female, "third": third, "total": total}
        except Exception:
            return None

    # Walk sections
    section = None
    for r in rows:
        if r and r[0].strip().startswith("II. Electors"):
            section = "ELECTORS"
            continue
        if r and r[0].strip().startswith("III. VOTERS"):
            section = "VOTERS"
            continue
        if r and r[0].strip().startswith("III. Polling Percentage"):
            try:
                poll_pct = float((r[5] if len(r) > 5 else "").strip() or 0)
            except Exception:
                poll_pct = None
            continue

        if section == "ELECTORS" and len(r) >= 2 and r[1].strip().lower().startswith("4. total"):
            electors = parse_gender_counts(r)
            continue
        if section == "VOTERS" and len(r) >= 2 and r[1].strip().lower().startswith("5. total"):
            voters = parse_gender_counts(r)
            continue

    out: dict[str, Any] = {
        "state": state_name,
        "election_year": year,
        "constituency_id": constituency_id,
        "constituency_name_raw": constituency_name_raw,
        "poll_pct": poll_pct,
        "source_note": source_note,
    }
    if electors:
        out.update(
            {
                "electors_male": electors["male"],
                "electors_female": electors["female"],
                "electors_third": electors["third"],
                "electors_total": electors["total"],
            }
        )
    if voters:
        out.update(
            {
                "voters_male": voters["male"],
                "voters_female": voters["female"],
                "voters_third": voters["third"],
                "voters_total": voters["total"],
            }
        )
    return out


def parse_index_card_xlsx(path: Path, *, year: int) -> tuple[list[dict[str, Any]], list[str]]:
    """
    XLSX workbooks from ECI often contain one sheet per constituency.
    We iterate all sheets and parse those that match the index-card structure.
    """
    try:
        from python_calamine import CalamineWorkbook
    except Exception as e:
        raise RuntimeError(
            "missing_dependency: python-calamine is required to read ECI XLSX (openpyxl often fails on invalid styles). "
            "Run: pip install -r osint_workers/requirements.txt"
        ) from e

    wb = CalamineWorkbook.from_path(str(path))
    out: list[dict[str, Any]] = []
    bad_sheets: list[str] = []
    for sheet_name in wb.sheet_names:
        try:
            grid = wb.get_sheet_by_name(sheet_name).to_python()
            r = parse_index_card_rows(
                grid,
                year=year,
                source_note=f"eci_constituency_summary_xlsx:{path.name}#{sheet_name}",
            )
            if not r:
                bad_sheets.append(sheet_name)
                continue
            out.append(r)
        except Exception:
            bad_sheets.append(sheet_name)
    return out, bad_sheets


def main() -> None:
    load_env_files()
    ap = argparse.ArgumentParser(description="Ingest ECI 'Constituency Data Summary' index-card CSV into constituency_electors_summary.")
    ap.add_argument("--year", type=int, default=2021)
    ap.add_argument("--path", type=str, default="")
    ap.add_argument("--dir", type=str, default=str(Path(__file__).resolve().parent / "historical_data"))
    ap.add_argument(
        "--report-missing",
        action="store_true",
        help="After ingest, print per-state coverage and missing constituency IDs for this year.",
    )
    ap.add_argument(
        "--report-limit",
        type=int,
        default=80,
        help="Max missing constituency IDs to print per state (default 80).",
    )
    args = ap.parse_args()

    if args.path:
        files = [Path(args.path)]
    else:
        d = Path(args.dir)
        # Prefer ECI's common naming, but fall back to all CSVs in the folder.
        files = (
            sorted(d.glob("8*Constituency*Summary*.csv"))
            + sorted(d.glob("8*Constituency*Summery*.csv"))
        )
        if not files:
            files = sorted(d.glob("*.csv")) + sorted(d.glob("*.xlsx"))

    if not files:
        raise SystemExit("no_input_files: place CSVs in osint_workers/historical_data or pass --path")

    ok = 0
    bad: list[str] = []
    rows: list[dict[str, Any]] = []
    for fp in files:
        try:
            if fp.suffix.lower() == ".xlsx":
                parsed, bad_sheets = parse_index_card_xlsx(fp, year=args.year)
                rows.extend(parsed)
                ok += len(parsed)
                if bad_sheets and len(parsed) == 0:
                    bad.append(fp.name)
            else:
                r = parse_index_card_csv(fp, year=args.year)
                if not r:
                    bad.append(fp.name)
                    continue
                rows.append(r)
                ok += 1
        except Exception:
            bad.append(fp.name)

    parsed_states = sorted({str(r.get("state") or "").strip() for r in rows if str(r.get("state") or "").strip()})

    # Deduplicate by PK
    uniq: dict[tuple[str, int, str], dict[str, Any]] = {}
    for r in rows:
        k = (str(r.get("state") or ""), int(r.get("election_year") or args.year), str(r.get("constituency_id") or ""))
        if not k[0] or not k[2]:
            continue
        uniq[k] = r
    rows = list(uniq.values())

    t0 = time.time()
    sb_upsert("constituency_electors_summary", rows, on_conflict="state,election_year,constituency_id")
    dt = time.time() - t0
    print(f"ingested={len(rows)} parsed_ok={ok} bad={len(bad)} seconds={dt:.2f}")
    if bad:
        print("bad_files:", ", ".join(bad[:50]))

    if args.report_missing:
        year = int(args.year)
        states_to_report = parsed_states or sorted(STATE_PREFIX.keys())
        print(f"[report] year={year} states={states_to_report}")
        for state in states_to_report:
            try:
                prefix = STATE_PREFIX.get(state)
                if not prefix:
                    continue
                consts = sb_select(
                    "constituencies",
                    "id",
                    filters={"id": f"like.{prefix}-%"},
                    limit=10000,
                )
                expected = sorted({str(c.get("id") or "") for c in consts if str(c.get("id") or "")})
                have_rows = sb_select(
                    "constituency_electors_summary",
                    "constituency_id",
                    filters={
                        "state": f"eq.{state}",
                        "election_year": f"eq.{year}",
                    },
                    limit=20000,
                )
                have = {str(r.get("constituency_id") or "") for r in have_rows if str(r.get("constituency_id") or "")}
                missing = [cid for cid in expected if cid not in have]
                print(f"[report] {state}: have={len(have)}/{len(expected)} missing={len(missing)}")
                if missing:
                    lim = max(0, int(args.report_limit or 0))
                    show = missing if lim <= 0 else missing[:lim]
                    print(f"         missing_ids: {', '.join(show)}" + ("" if len(show) == len(missing) else f" … (+{len(missing) - len(show)} more)"))
            except Exception as e:
                print(f"[report] {state}: error={e}")


if __name__ == "__main__":
    main()

