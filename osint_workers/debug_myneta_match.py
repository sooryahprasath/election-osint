import os
import sys
from typing import Any

import requests
from playwright.sync_api import sync_playwright

# Reuse the production parsing + matching logic.
from dossier_ingestor import (
    calculate_token_overlap_v2,
    fetch_myneta_summary_rows,
    intelligent_match,
    name_similarity,
)


def _must_env(name: str) -> str:
    v = (os.getenv(name) or "").strip()
    if not v:
        raise SystemExit(f"Missing env var: {name}")
    return v


def _sb_select(*, table: str, select: str, filters: dict[str, str], limit: int = 20000) -> list[dict[str, Any]]:
    url = _must_env("NEXT_PUBLIC_SUPABASE_URL").rstrip("/")
    anon = (os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY") or "").strip()
    sr = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    key = sr or anon
    if not key:
        raise SystemExit("Missing env var: SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY")
    rest = f"{url}/rest/v1/{table}"
    params = {"select": select, "limit": str(int(limit))}
    params.update(filters)
    r = requests.get(
        rest,
        params=params,
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        timeout=45,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"supabase_http_{r.status_code}: {r.text[:400]}")
    out = r.json()
    return out if isinstance(out, list) else []


def main() -> None:
    base = (os.getenv("MYNETA_BASE") or "https://myneta.info/TamilNadu2026/").strip()
    page_no = int(os.getenv("MYNETA_PAGE", "1") or "1")
    prefix = (os.getenv("STATE_PREFIX") or "TN").strip().upper()
    pick_idx = max(1, int(os.getenv("MYNETA_PICK_INDEX", "1") or "1"))
    target_const = (os.getenv("MYNETA_TARGET_CONST") or "").strip()
    target_name = (os.getenv("MYNETA_TARGET_NAME") or "").strip()
    search_pages = int(os.getenv("MYNETA_SEARCH_PAGES", "8") or "8")

    print(f"[dbg] base={base} page={page_no} prefix={prefix}", flush=True)

    def _scrape_page_rows(*, pw_page, pg: int) -> list[dict]:
        return fetch_myneta_summary_rows(pw_page, base, pg)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        pw_page = ctx.new_page()

        rows = _scrape_page_rows(pw_page=pw_page, pg=page_no)
        chosen = None
        if target_const or target_name:
            tc = target_const.lower()
            tn = target_name.lower()
            for pg in range(1, max(1, search_pages) + 1):
                rs = _scrape_page_rows(pw_page=pw_page, pg=pg)
                if not rs:
                    continue
                for r in rs:
                    c_ok = (not tc) or (tc in (r.get("constituency_name") or "").lower())
                    n_ok = (not tn) or (tn in (r.get("candidate_name") or "").lower())
                    if c_ok and n_ok:
                        chosen = r
                        page_no = pg
                        rows = rs
                        break
                if chosen:
                    break

        ctx.close()
        browser.close()

    if not rows:
        print("[dbg] no rows parsed", flush=True)
        return

    print(f"[dbg] parsed_rows={len(rows)}", flush=True)
    sample = rows[:10]
    for i, r in enumerate(sample, start=1):
        print(f"[myneta] {i:02d} const='{r['constituency_name']}' cand='{r['candidate_name']}'", flush=True)

    # Pick one row and compare against DB candidates in that constituency.
    if target_const or target_name:
        if not chosen:
            print(
                f"[dbg] target not found (const='{target_const}' name='{target_name}') within pages=1..{search_pages}",
                flush=True,
            )
            return
        pick = chosen
        print(
            f"[dbg] picked_from_search page={page_no} const='{pick.get('constituency_name')}' cand='{pick.get('candidate_name')}'",
            flush=True,
        )
    else:
        pick = sample[min(len(sample), pick_idx) - 1]
    const_raw = pick["constituency_name"]
    cand_raw = pick["candidate_name"]

    consts = _sb_select(
        table="constituencies",
        select="id,name",
        filters={"id": f"like.{prefix}-%"},
        limit=6000,
    )
    if not consts:
        print("[dbg] no constituencies found for prefix", flush=True)
        return

    # best-effort: simple squish compare locally (keep this script dependency-light)
    def _sq(x: str) -> str:
        import re

        return re.sub(r"[^a-z]", "", (x or "").lower())

    const_hit = None
    const_raw_sq = _sq(const_raw)
    best = 0.0
    for c in consts:
        sc = name_similarity(const_raw, c.get("name") or "")
        if const_raw_sq and _sq(c.get("name") or "") and (const_raw_sq in _sq(c.get("name") or "") or _sq(c.get("name") or "") in const_raw_sq):
            sc = max(sc, 0.92)
        if sc > best:
            best = sc
            const_hit = c
    if not const_hit or best < 0.70:
        print(f"[dbg] constituency_match_failed raw='{const_raw}' best={best:.2f}", flush=True)
        return

    constituency_id = const_hit["id"]
    print(f"[dbg] constituency raw='{const_raw}' -> '{const_hit['name']}' id={constituency_id} (score={best:.2f})", flush=True)

    cands = _sb_select(
        table="candidates",
        select="id,name,constituency_id",
        filters={"removed": "eq.false", "constituency_id": f"eq.{constituency_id}"},
        limit=2000,
    )
    print(f"[dbg] db_candidates_in_const={len(cands)}", flush=True)
    if not cands:
        return

    options = [c["name"] for c in cands if c.get("name")]
    picked = intelligent_match(cand_raw, options)
    print(f"[dbg] mynet_name='{cand_raw}' intelligent_match='{picked}'", flush=True)

    scored = sorted(
        ((o, name_similarity(cand_raw, o), calculate_token_overlap_v2(cand_raw, o)) for o in options),
        key=lambda x: (x[1], x[2]),
        reverse=True,
    )[:10]
    for n, s, ov in scored:
        print(f"[rank] {n} sim={s:.3f} ov={ov:.3f}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
