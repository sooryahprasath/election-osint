import argparse
import json
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[1]
load_dotenv(dotenv_path=str(ROOT / ".env"))


def _default_cursor_uploads_dir() -> Path:
    # Workspace-specific Cursor uploads folder (best-effort default for this repo).
    home = Path(os.environ.get("USERPROFILE") or str(Path.home()))
    return home / ".cursor" / "projects" / "c-Users-Sooryah-Prasath-Documents-election-osint" / "uploads"


STATE_SOURCES = {
    "Tamil Nadu": {
        "year": 2021,
        "state": "Tamil Nadu",
        "source_url": "https://en.wikipedia.org/wiki/2021_Tamil_Nadu_Legislative_Assembly_election",
        "md_path_hint": "2021_Tamil_Nadu_Legislative_Assembly_election-0.md",
        "heading": "### By constituency",
        "has_turnout": True,
    },
    "West Bengal": {
        "year": 2021,
        "state": "West Bengal",
        "source_url": "https://en.wikipedia.org/wiki/2021_West_Bengal_Legislative_Assembly_election",
        "md_path_hint": "2021_West_Bengal_Legislative_Assembly_election-1.md",
        "heading": "### Results by constituency",
        "has_turnout": False,
    },
    "Assam": {
        "year": 2021,
        "state": "Assam",
        "source_url": "https://en.wikipedia.org/wiki/2021_Assam_Legislative_Assembly_election",
        "md_path_hint": "2021_Assam_Legislative_Assembly_election-2.md",
        "heading": "### Results by constituency",
        "has_turnout": False,
    },
    "Kerala": {
        "year": 2021,
        "state": "Kerala",
        "source_url": "https://en.wikipedia.org/wiki/2021_Kerala_Legislative_Assembly_election",
        "md_path_hint": "2021_Kerala_Legislative_Assembly_election-3.md",
        "heading": "### By constituency",
        "has_turnout": True,
    },
    "Puducherry": {
        "year": 2021,
        "state": "Puducherry",
        "source_url": "https://en.wikipedia.org/wiki/2021_Puducherry_Legislative_Assembly_election",
        "md_path_hint": "2021_Puducherry_Legislative_Assembly_election-4.md",
        "heading": "### Results by constituency",
        "has_turnout": True,
    },
}


def _must_env(name: str) -> str:
    v = (os.getenv(name) or "").strip()
    if not v:
        raise SystemExit(f"Missing env var: {name}")
    return v


def _supabase_rest() -> tuple[str, dict[str, str]]:
    url = _must_env("NEXT_PUBLIC_SUPABASE_URL").rstrip("/")
    anon = (os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY") or "").strip()
    sr = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    key = sr or anon
    if not key:
        raise SystemExit("Missing env var: SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY")
    rest = f"{url}/rest/v1"
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    return rest, headers


def sb_select(table: str, select: str, *, filters: dict[str, str], limit: int = 10000) -> list[dict[str, Any]]:
    rest, headers = _supabase_rest()
    params: dict[str, str] = {"select": select, "limit": str(int(limit))}
    params.update(filters)
    r = requests.get(f"{rest}/{table}", params=params, headers=headers, timeout=60)
    if r.status_code >= 400:
        raise RuntimeError(f"supabase_http_{r.status_code}: {r.text[:400]}")
    out = r.json()
    return out if isinstance(out, list) else []


def sb_upsert(table: str, rows: list[dict[str, Any]], *, on_conflict: str) -> None:
    if not rows:
        return
    rest, headers = _supabase_rest()
    r = requests.post(
        f"{rest}/{table}",
        params={"on_conflict": on_conflict},
        headers={**headers, "Prefer": "resolution=merge-duplicates,return=minimal"},
        json=rows,
        timeout=90,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"supabase_http_{r.status_code}: {r.text[:400]}")


def _strip_md_links(s: str) -> str:
    x = str(s or "")
    x = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", x)
    x = re.sub(r"\[\d+\]", "", x)
    x = re.sub(r"\[\w+\]", "", x)
    x = x.replace("**", "")
    x = x.replace("_", " ")
    return " ".join(x.split()).strip()


def _parse_int(s: str) -> int | None:
    raw = _strip_md_links(s)
    raw = raw.replace(",", "").replace(" ", "")
    raw = raw.replace("₹", "")
    if not raw:
        return None
    m = re.search(r"-?\d+", raw)
    if not m:
        return None
    try:
        return int(m.group(0))
    except Exception:
        return None


def _parse_float(s: str) -> float | None:
    raw = _strip_md_links(s)
    raw = raw.replace(",", "").strip()
    if not raw:
        return None
    try:
        return float(raw)
    except Exception:
        m = re.search(r"(\d+(?:\.\d+)?)", raw)
        if not m:
            return None
        try:
            return float(m.group(1))
        except Exception:
            return None


def _squish_name(s: str) -> str:
    x = _strip_md_links(s).lower()
    x = re.sub(r"\([^)]*\)", " ", x)  # remove (SC)/(ST)
    x = re.sub(r"[^a-z0-9]+", "", x)
    return x


def _ratio(a: str, b: str) -> float:
    from difflib import SequenceMatcher

    return SequenceMatcher(None, a, b).ratio()


@dataclass
class MapHit:
    constituency_id: str
    constituency_name: str
    score: float


def best_constituency_match(raw: str, options: list[dict[str, Any]]) -> MapHit | None:
    if not raw or not options:
        return None
    raw_s = _squish_name(raw)
    if not raw_s:
        return None
    best: MapHit | None = None
    for o in options:
        oid = str(o.get("id") or "")
        oname = str(o.get("name") or "")
        if not oid or not oname:
            continue
        sc = max(_ratio(raw.lower(), oname.lower()), _ratio(raw_s, _squish_name(oname)))
        if best is None or sc > best.score:
            best = MapHit(constituency_id=oid, constituency_name=oname, score=sc)
    if not best:
        return None
    return best if best.score >= 0.74 else None


def _find_table_block(md: str, heading: str) -> list[str]:
    lines = (md or "").splitlines()
    start = None
    for i, ln in enumerate(lines):
        if ln.strip().lower() == heading.strip().lower():
            start = i
            break
    if start is None:
        return []
    # scan for first markdown table row after heading
    i = start + 1
    while i < len(lines) and "|" not in lines[i]:
        i += 1
    if i >= len(lines):
        return []
    out: list[str] = []
    while i < len(lines):
        ln = lines[i]
        if not ln.strip():
            break
        if not ln.lstrip().startswith("|"):
            # stop when we leave the table
            if out:
                break
            i += 1
            continue
        out.append(ln)
        i += 1
    return out


def _parse_table_rows(table_lines: list[str]) -> list[list[str]]:
    rows: list[list[str]] = []
    for ln in table_lines:
        # split into cells; keep empty cells but strip
        parts = [p.strip() for p in ln.strip().strip("|").split("|")]
        # ignore separator rows
        if len(parts) >= 2 and all(set(p) <= {"-", " "} for p in parts):
            continue
        rows.append(parts)
    return rows


def _extract_result_from_row(cells: list[str], *, has_turnout: bool) -> dict[str, Any] | None:
    vals = [_strip_md_links(c) for c in cells]
    vals = [v for v in vals if v not in ("", None)]
    if len(vals) < 8:
        return None
    # skip district label rows (usually bold and not numeric seat index)
    if vals[0].startswith("Thiruv") and "District" in vals[0]:
        return None
    if vals[0].lower().endswith("district") or "district" in vals[0].lower():
        return None

    # seat no detection (optional)
    seat_no = _parse_int(vals[0])
    if seat_no is not None and len(vals) >= 3:
        constituency = vals[1]
        rest = vals[2:]
    else:
        constituency = vals[0]
        rest = vals[1:]

    # margin at end (votes)
    margin_votes = _parse_int(rest[-1])
    if margin_votes is None:
        return None
    # Walk backwards for runner-up + winner components
    runner_pct = None
    runner_votes = None
    runner_party = None
    runner_name = None
    winner_pct = None
    winner_votes = None
    winner_party = None
    winner_name = None

    i = len(rest) - 2
    # runner pct
    while i >= 0 and runner_pct is None:
        runner_pct = _parse_float(rest[i])
        i -= 1
    # runner votes
    while i >= 0 and runner_votes is None:
        runner_votes = _parse_int(rest[i])
        i -= 1
    # runner party
    while i >= 0 and runner_party is None:
        tok = rest[i]
        if tok and len(tok) <= 12 and re.fullmatch(r"[A-Z0-9\-\+\(\)\/\.]+", tok):
            runner_party = tok
        i -= 1
    # runner name
    while i >= 0 and runner_name is None:
        tok = rest[i]
        if tok and not re.fullmatch(r"[A-Z0-9\-\+\(\)\/\.]+", tok):
            runner_name = tok
        i -= 1

    # winner pct
    while i >= 0 and winner_pct is None:
        winner_pct = _parse_float(rest[i])
        i -= 1
    # winner votes
    while i >= 0 and winner_votes is None:
        winner_votes = _parse_int(rest[i])
        i -= 1
    # winner party
    while i >= 0 and winner_party is None:
        tok = rest[i]
        if tok and len(tok) <= 12 and re.fullmatch(r"[A-Z0-9\-\+\(\)\/\.]+", tok):
            winner_party = tok
        i -= 1
    # winner name
    while i >= 0 and winner_name is None:
        tok = rest[i]
        if tok and not re.fullmatch(r"[A-Z0-9\-\+\(\)\/\.]+", tok):
            winner_name = tok
        i -= 1

    turnout_pct = None
    if has_turnout:
        # turnout often appears early in the row (immediately after constituency)
        for tok in rest[:4]:
            f = _parse_float(tok)
            if f is not None and 30.0 <= f <= 95.0:
                turnout_pct = f
                break

    if not constituency or not winner_name or not winner_party or not runner_name or not runner_party:
        return None

    return {
        "constituency_name_raw": constituency,
        "winner_name": winner_name,
        "winner_party": winner_party,
        "runner_up_name": runner_name,
        "runner_up_party": runner_party,
        "margin_votes": margin_votes,
        "turnout_pct": turnout_pct,
    }


def _resolve_md_path(hint: str) -> Path | None:
    # Prefer explicit env override
    env_dir = os.getenv("WIKI_UPLOADS_DIR")
    candidates: list[Path] = []
    if env_dir:
        candidates.append(Path(env_dir) / hint)
    # Default cursor uploads path for this workspace
    candidates.append(_default_cursor_uploads_dir() / hint)
    # Fallback: search common locations near workspace
    candidates.append(ROOT / "uploads" / hint)
    for p in candidates:
        try:
            if p.exists():
                return p
        except Exception:
            pass
    return None


def ingest_state(state_cfg: dict[str, Any], *, dry_run: bool) -> dict[str, Any]:
    state = state_cfg["state"]
    year = int(state_cfg.get("year") or 2021)
    source_url = state_cfg.get("source_url") or ""
    hint = state_cfg.get("md_path_hint") or ""
    heading = state_cfg.get("heading") or ""
    has_turnout = bool(state_cfg.get("has_turnout"))

    md_path = _resolve_md_path(hint)
    if not md_path:
        return {"state": state, "error": f"missing_md:{hint}", "inserted": 0, "unmatched": 0}

    md = md_path.read_text(encoding="utf-8", errors="ignore")
    table_lines = _find_table_block(md, heading)
    if not table_lines:
        return {"state": state, "error": f"table_not_found:{heading}", "inserted": 0, "unmatched": 0}

    rows = _parse_table_rows(table_lines)
    # Load constituencies for state (best-effort mapping)
    consts = sb_select("constituencies", "id,name,state", filters={"state": f"eq.{state}"}, limit=4000)
    if not consts:
        return {"state": state, "error": "no_constituencies_for_state", "inserted": 0, "unmatched": 0}

    upserts: list[dict[str, Any]] = []
    unmatched: list[dict[str, Any]] = []

    for cells in rows:
        res = _extract_result_from_row(cells, has_turnout=has_turnout)
        if not res:
            continue
        hit = best_constituency_match(res["constituency_name_raw"], consts)
        if not hit:
            unmatched.append(
                {
                    "constituency_name_raw": res["constituency_name_raw"],
                    "winner_name": res.get("winner_name"),
                    "winner_party": res.get("winner_party"),
                    "runner_up_name": res.get("runner_up_name"),
                    "runner_up_party": res.get("runner_up_party"),
                    "margin_votes": res.get("margin_votes"),
                    "turnout_pct": res.get("turnout_pct"),
                }
            )
            continue

        upserts.append(
            {
                "state": state,
                "election_year": year,
                "constituency_id": hit.constituency_id,
                "constituency_name_raw": res["constituency_name_raw"],
                "winner_name": res["winner_name"],
                "winner_party": res["winner_party"],
                "runner_up_name": res["runner_up_name"],
                "runner_up_party": res["runner_up_party"],
                "margin_votes": res["margin_votes"],
                "margin_pct": None,
                "turnout_pct": res.get("turnout_pct"),
                "source_url": source_url,
                "source_note": f"wikipedia_md:{md_path.name}",
                "updated_at": None,
            }
        )

    if not dry_run and upserts:
        # Deduplicate within this run: PostgREST will 500 if the same ON CONFLICT key
        # appears twice inside a single INSERT ... ON CONFLICT batch.
        uniq: dict[tuple[str, int, str], dict[str, Any]] = {}
        for r in upserts:
            k = (str(r.get("state") or ""), int(r.get("election_year") or 2021), str(r.get("constituency_id") or ""))
            if not k[0] or not k[2]:
                continue
            uniq[k] = r
        upserts = list(uniq.values())

        # Fill updated_at server-side by omitting it
        for r in upserts:
            r.pop("updated_at", None)
        # Upsert in chunks
        for i in range(0, len(upserts), 250):
            sb_upsert("constituency_results", upserts[i : i + 250], on_conflict="state,election_year,constituency_id")
            time.sleep(0.2)

    report_dir = ROOT / "artifacts" / "history_ingest"
    report_dir.mkdir(parents=True, exist_ok=True)
    (report_dir / f"unmatched_{state.replace(' ', '_').lower()}_{year}.json").write_text(
        json.dumps({"state": state, "year": year, "unmatched": unmatched[:200]}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    return {"state": state, "error": None, "inserted": len(upserts), "unmatched": len(unmatched)}


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest 2021 constituency results from Wikipedia exports (best-effort).")
    parser.add_argument("--states", action="append", help="Comma-separated list of states (e.g. 'Tamil Nadu,Kerala')", default=[])
    parser.add_argument("--dry-run", action="store_true", help="Parse + report but do not write to Supabase.")
    args = parser.parse_args()

    selected: set[str] = set()
    for chunk in args.states or []:
        for s in str(chunk).split(","):
            ss = s.strip()
            if ss:
                selected.add(ss)
    cfgs = list(STATE_SOURCES.values())
    if selected:
        cfgs = [c for c in cfgs if c["state"] in selected]

    print(f"[history2021] states={', '.join(c['state'] for c in cfgs)} dry_run={args.dry_run}", flush=True)

    out = []
    for cfg in cfgs:
        r = ingest_state(cfg, dry_run=args.dry_run)
        out.append(r)
        if r.get("error"):
            print(f"[history2021] {cfg['state']}: ERROR {r['error']}", flush=True)
        else:
            print(f"[history2021] {cfg['state']}: inserted={r['inserted']} unmatched={r['unmatched']}", flush=True)

    total_ins = sum(int(x.get("inserted") or 0) for x in out)
    total_unm = sum(int(x.get("unmatched") or 0) for x in out)
    print(f"[history2021] DONE inserted={total_ins} unmatched={total_unm}", flush=True)


if __name__ == "__main__":
    main()

