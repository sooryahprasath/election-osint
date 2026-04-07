from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from supabase import create_client, Client


def _make_supabase() -> Client:
    env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
    load_dotenv(dotenv_path=env_path)
    url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not url or not key:
        raise RuntimeError("Missing Supabase env: NEXT_PUBLIC_SUPABASE_URL and (SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY)")
    return create_client(url, key)


def main() -> None:
    db = _make_supabase()

    # Conservative purge: delete only rows that look like they came from social_ingestor
    # (youtube/telegram/rss markers) and were inserted recently.
    hours = int(os.getenv("PURGE_SOCIAL_HOURS") or "168")  # default 7 days
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()

    # 1) Delete by category used by social_ingestor (youtube inserts used category="social")
    # 2) Also delete official/rss inserts that have pipeline_version tag (v2 runs added this)
    # Note: Supabase delete filters are ANDed; do two passes.
    deleted_total = 0

    # Pass A: category == social
    res_a = db.table("signals").delete().gte("created_at", since).eq("category", "social").execute()
    deleted_total += len(res_a.data or [])

    # Pass B: entities_involved->>pipeline_version like social_v2%
    # Supabase-py supports raw filters via .filter
    res_b = (
        db.table("signals")
        .delete()
        .gte("created_at", since)
        .filter("entities_involved->>pipeline_version", "like", "social_v2%")
        .execute()
    )
    deleted_total += len(res_b.data or [])

    print(f"[purge_social_from_signals] deleted={deleted_total} since={since} hours={hours}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"CRITICAL: purge failed: {e}")
        sys.exit(1)

