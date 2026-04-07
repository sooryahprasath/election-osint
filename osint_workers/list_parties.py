from __future__ import annotations

import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone

from dotenv import load_dotenv
from supabase import create_client, Client


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _make_supabase() -> Client:
    env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
    load_dotenv(dotenv_path=env_path)

    url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not url or not key:
        raise RuntimeError("Missing Supabase env: NEXT_PUBLIC_SUPABASE_URL and (SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY)")
    return create_client(url, key)


def main() -> None:
    try:
        db = _make_supabase()
    except Exception as e:
        print(f"CRITICAL: Supabase offline: {e}")
        sys.exit(1)

    # Pull candidate parties; RLS allows SELECT.
    res = (
        db.table("candidates")
        .select("party,party_abbreviation,removed")
        .limit(20000)
        .execute()
    )
    rows = res.data or []

    counts: dict[tuple[str, str], int] = defaultdict(int)
    for r in rows:
        if r.get("removed") is True:
            continue
        party = str(r.get("party") or "").strip()
        abbr = str(r.get("party_abbreviation") or "").strip()
        if not party and not abbr:
            continue
        counts[(party or abbr, abbr)] += 1

    items = [
        {"party": k[0], "abbr": k[1] or None, "candidates": v}
        for (k, v) in sorted(counts.items(), key=lambda kv: (-kv[1], (kv[0][0] or "").lower()))
    ]

    print(f"[list_parties] rows={len(rows)} unique_parties={len(items)} at={_utc_now_iso()}")
    for i, it in enumerate(items, start=1):
        ab = f" ({it['abbr']})" if it.get("abbr") else ""
        print(f"{i:>3}. {it['party']}{ab} — {it['candidates']} candidates")

    out_path = os.getenv("PARTY_LIST_OUT")
    if out_path:
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(items, f, ensure_ascii=False, indent=2)
        print(f"\nSaved JSON to: {out_path}")


if __name__ == "__main__":
    main()

