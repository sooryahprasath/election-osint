import argparse
import json
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests


ROOT = Path(__file__).resolve().parents[1]

def load_env_files() -> None:
    """
    Best-effort env loader so CLI scripts work without manual export.
    Supports simple KEY=VALUE lines (no complex quoting).
    """
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


STATE_ABBR_TO_NAME: dict[str, str] = {
    "TN": "Tamil Nadu",
    "WB": "West Bengal",
    "KL": "Kerala",
    "AS": "Assam",
    "PY": "Puducherry",
}


def _sb_rest_headers() -> dict[str, str]:
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or ""
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") or ""
    if not url or not key:
        raise RuntimeError("missing_supabase_env: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (preferred) or NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY")
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
    # Strip reservation suffixes like "(SC)" / "(ST)" frequently present in ECI PDFs.
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
    if not best:
        return None
    # ECI names are generally clean, but our DB names can have punctuation/aliases.
    if best.score < 0.66:
        return None
    return best


CONSTITUENCY_RE = re.compile(r"^Constituency\s+\d+\s*-\s*(?P<name>.+?)\s+TOTAL\s+ELECTORS\s+(?P<electors>\d+)\s*$", re.IGNORECASE)
TURNOUT_RE = re.compile(r"^TURN\s+OUT\s+TOTAL:\s+(?P<gen>\d+)\s+(?P<postal>\d+)\s+(?P<total>\d+)\s+(?P<pct>\d+(?:\.\d+)?)\s*$", re.IGNORECASE)

# Candidate row: "1 Name ... MALE 43 GENERAL IUML <symbol...> 65190 568 65758 38.14"
CAND_RE = re.compile(
    r"^(?P<idx>\d+)\s+(?P<name>.+?)\s+(?P<sex>MALE|FEMALE)\s+(?P<age>\d+)\s+(?P<cat>GENERAL|SC|ST)\s+(?P<party>[A-Z][A-Z0-9\(\)\.\-\/]{0,14})\s+.*\s+(?P<gen>\d+)\s+(?P<postal>\d+)\s+(?P<total>\d+)\s+(?P<pct>\d+(?:\.\d+)?)\s*$",
    re.IGNORECASE,
)


def extract_pdf_text(path: Path) -> str:
    # Prefer pypdf, then PyPDF2, then system pdftotext.
    try:
        from pypdf import PdfReader  # type: ignore

        reader = PdfReader(str(path))
        return "\n".join([(p.extract_text() or "") for p in reader.pages])
    except Exception:
        pass

    try:
        import PyPDF2  # type: ignore

        with path.open("rb") as f:
            reader = PyPDF2.PdfReader(f)
            return "\n".join([(p.extract_text() or "") for p in reader.pages])
    except Exception:
        pass

    try:
        import subprocess

        r = subprocess.run(["pdftotext", str(path), "-"], capture_output=True, text=True, check=False)
        if r.returncode == 0 and r.stdout:
            return r.stdout
    except Exception:
        pass

    raise RuntimeError("pdf_extract_failed: install `pypdf` (recommended) or `PyPDF2`, or ensure `pdftotext` is available")


def parse_detailed_results(text: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    cur_name: str | None = None
    cur_electors: int | None = None
    cur_candidates: list[dict[str, Any]] = []
    cur_turnout_pct: float | None = None

    def flush() -> None:
        nonlocal cur_name, cur_electors, cur_candidates, cur_turnout_pct
        if not cur_name:
            return
        cands = [c for c in cur_candidates if c.get("party", "").upper() != "NOTA" and c.get("name", "").upper() != "NOTA"]
        cands.sort(key=lambda x: int(x.get("total_votes") or 0), reverse=True)
        winner = cands[0] if len(cands) >= 1 else None
        runner = cands[1] if len(cands) >= 2 else None
        margin = None
        if winner and runner:
            margin = int(winner["total_votes"]) - int(runner["total_votes"])
        rows.append(
            {
                "constituency_name_raw": cur_name,
                "total_electors": cur_electors,
                "turnout_pct": cur_turnout_pct,
                "winner_name": winner["name"] if winner else None,
                "winner_party": winner["party"] if winner else None,
                "winner_votes": winner["total_votes"] if winner else None,
                "runner_up_name": runner["name"] if runner else None,
                "runner_up_party": runner["party"] if runner else None,
                "runner_up_votes": runner["total_votes"] if runner else None,
                "margin_votes": margin,
            }
        )
        cur_name = None
        cur_electors = None
        cur_candidates = []
        cur_turnout_pct = None

    cand_buf: str | None = None
    for raw_line in text.splitlines():
        line = str(raw_line or "").strip()
        if not line:
            continue
        m = CONSTITUENCY_RE.match(line)
        if m:
            flush()
            cur_name = m.group("name").strip()
            cur_electors = int(m.group("electors"))
            continue
        m = TURNOUT_RE.match(line)
        if m and cur_name:
            try:
                cur_turnout_pct = float(m.group("pct"))
            except Exception:
                cur_turnout_pct = None
            # do not flush yet; some PDFs continue candidates on next page then turnout later.
            continue

        # Candidate rows often wrap across multiple lines due to multi-line symbols (e.g. CPI(M)).
        # Buffer any line that looks like it starts a candidate row, then keep appending until it matches.
        is_cand_start = bool(re.match(r"^\d+\s+.+\s+(MALE|FEMALE)\s+\d+\s+(GENERAL|SC|ST)\s+", line, flags=re.IGNORECASE))
        if cur_name and (cand_buf or is_cand_start):
            cand_buf = (cand_buf + " " + line).strip() if cand_buf else line
            m = CAND_RE.match(cand_buf)
            if m:
                party = m.group("party").strip().upper()
                name = m.group("name").strip()
                total_votes = int(m.group("total"))
                cur_candidates.append({"name": name, "party": party, "total_votes": total_votes})
                cand_buf = None
            else:
                # If buffer gets too long without matching, drop it to avoid cross-contamination.
                if len(cand_buf) > 260:
                    cand_buf = None
            continue

    flush()
    return rows


def ingest_pdf(*, pdf_path: Path, state: str, year: int, dry_run: bool) -> dict[str, Any]:
    consts = sb_select("constituencies", "id,name,state", limit=5000)
    consts = [c for c in consts if str(c.get("state") or "") == state]

    text = extract_pdf_text(pdf_path)
    parsed = parse_detailed_results(text)

    upserts: list[dict[str, Any]] = []
    unmatched: list[dict[str, Any]] = []

    for r in parsed:
        hit = best_constituency_match(str(r["constituency_name_raw"]), consts)
        if not hit:
            unmatched.append(r)
            continue
        upserts.append(
            {
                "state": state,
                "election_year": year,
                "constituency_id": hit.constituency_id,
                "constituency_name_raw": r["constituency_name_raw"],
                "winner_name": r.get("winner_name"),
                "winner_party": r.get("winner_party"),
                "runner_up_name": r.get("runner_up_name"),
                "runner_up_party": r.get("runner_up_party"),
                "margin_votes": r.get("margin_votes"),
                "margin_pct": None,
                "turnout_pct": r.get("turnout_pct"),
                "source_url": None,
                "source_note": f"eci_pdf:{pdf_path.name}",
            }
        )

    if not dry_run and upserts:
        # PostgREST upsert batches cannot contain dup keys; dedupe.
        uniq: dict[tuple[str, int, str], dict[str, Any]] = {}
        for u in upserts:
            k = (state, year, str(u["constituency_id"]))
            uniq[k] = u
        upserts = list(uniq.values())
        for i in range(0, len(upserts), 250):
            sb_upsert("constituency_results", upserts[i : i + 250], on_conflict="state,election_year,constituency_id")
            time.sleep(0.15)

    report_dir = ROOT / "artifacts" / "eci_detailed_ingest"
    report_dir.mkdir(parents=True, exist_ok=True)
    (report_dir / f"unmatched_{state.replace(' ', '_').lower()}_{year}.json").write_text(
        json.dumps({"state": state, "year": year, "pdf": pdf_path.name, "unmatched": unmatched[:300]}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    return {"state": state, "pdf": str(pdf_path), "parsed": len(parsed), "upserted": len(upserts), "unmatched": len(unmatched)}


def main() -> None:
    load_env_files()
    p = argparse.ArgumentParser(description="Ingest ECI '10 - Detailed Results' PDFs into constituency_results (best-effort).")
    p.add_argument("--state", help="State abbreviation (TN/WB/KL/AS/PY) or full name", required=False)
    p.add_argument("--year", type=int, default=2021)
    p.add_argument("--path", help="Path to a single PDF to ingest", required=False)
    p.add_argument("--dir", help="Directory of PDFs (default: osint_workers/historical_data)", default=str(Path(__file__).resolve().parent / "historical_data"))
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    if args.path:
        pdfs = [Path(args.path)]
    else:
        pdfs = sorted(Path(args.dir).glob("*.pdf"))
    if not pdfs:
        raise RuntimeError(f"no_pdfs_found: dir={args.dir}")

    selected_state: str | None = None
    if args.state:
        s = str(args.state).strip()
        selected_state = STATE_ABBR_TO_NAME.get(s.upper(), s)

    out = []
    for pdf in pdfs:
        if not pdf.exists():
            continue
        # Infer state from filename suffix like "..._KL.pdf"
        inferred = None
        m = re.search(r"_([A-Z]{2})\.pdf$", pdf.name)
        if m:
            inferred = STATE_ABBR_TO_NAME.get(m.group(1).upper())
        if selected_state and inferred and inferred != selected_state:
            continue
        state = inferred or selected_state
        if not state:
            raise RuntimeError(f"cannot_infer_state: pass --state for {pdf.name}")
        print(f"[eci_pdf] ingest state={state} year={args.year} pdf={pdf.name} dry_run={args.dry_run}", flush=True)
        r = ingest_pdf(pdf_path=pdf, state=state, year=args.year, dry_run=args.dry_run)
        out.append(r)
        print(f"[eci_pdf] {state}: parsed={r['parsed']} upserted={r['upserted']} unmatched={r['unmatched']}", flush=True)

    print(f"[eci_pdf] DONE files={len(out)}", flush=True)


if __name__ == "__main__":
    main()

