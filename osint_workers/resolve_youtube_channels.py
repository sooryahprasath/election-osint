from __future__ import annotations

import json
import os
import re
import sys
import urllib.parse
from dataclasses import dataclass

import requests


@dataclass
class Resolved:
    url: str
    handle: str
    channel_id: str | None


def _norm_handle(url: str) -> str:
    u = url.strip()
    # Accept @handle URLs and /channel/ URLs
    if "/@" in u:
        return u.split("/@", 1)[1].split("/", 1)[0].strip()
    if "/channel/" in u:
        return u.split("/channel/", 1)[1].split("/", 1)[0].strip()
    return u


def _extract_channel_id(html: str) -> str | None:
    # Common patterns in YouTube HTML
    m = re.search(r'"channelId"\s*:\s*"([A-Za-z0-9_-]{20,})"', html)
    if m:
        return m.group(1)
    m = re.search(r'itemprop="channelId"\s+content="([^"]+)"', html)
    if m:
        return m.group(1)
    m = re.search(r'"externalId"\s*:\s*"([A-Za-z0-9_-]{20,})"', html)
    if m:
        return m.group(1)
    return None


def resolve(url: str) -> Resolved:
    url = url.strip()
    handle = _norm_handle(url)
    # Fetch the canonical channel page (not /videos)
    base = url.split("?", 1)[0].rstrip("/")
    base = re.sub(r"/videos$", "", base)
    headers = {"User-Agent": "Mozilla/5.0"}
    r = requests.get(base, headers=headers, timeout=25, allow_redirects=True)
    r.raise_for_status()
    cid = _extract_channel_id(r.text)
    return Resolved(url=url, handle=handle, channel_id=cid)


def make_key(handle: str) -> str:
    k = re.sub(r"[^a-z0-9]+", "_", handle.lower()).strip("_")
    if not k:
        k = "channel"
    return k[:60]


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python osint_workers/resolve_youtube_channels.py <youtube_url> [more_urls...]")
        sys.exit(2)

    out: list[dict] = []
    for u in sys.argv[1:]:
        try:
            res = resolve(u)
            if not res.channel_id:
                print(f"[WARN] No channel_id found for: {u}")
            else:
                print(f"[OK] @{res.handle} -> {res.channel_id}")
            out.append({"url": res.url, "handle": res.handle, "channel_id": res.channel_id})
        except Exception as e:
            print(f"[ERR] {u}: {e}")
            out.append({"url": u, "handle": _norm_handle(u), "channel_id": None, "error": str(e)})

    # Print JSON for easy copy/paste
    print("\n--- JSON ---")
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

