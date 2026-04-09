"""
Grounded voter turnout + booth news via Gemini + Google Search (no RSS corpus).

Env:
  TURNOUT_INGEST_MODE=grounded|rss  (voting_day_ingestor.py chooses pipeline)
  TURNOUT_OFFICIAL_URLS_JSON='{"Kerala":["https://..."]}' optional override / extend CEO URLs

Token discipline: one search-grounded call per state per cycle; optional cheap official page crawl.
  TURNOUT_GROUNDED_MAX_OUTPUT_TOKENS  optional (512–8192, default 8192) — raise if JSON is cut off (finish_reason=MAX_TOKENS).
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime
from typing import TYPE_CHECKING, Any

import requests
from bs4 import BeautifulSoup
from google.genai import types

if TYPE_CHECKING:
    from google import genai as genai_mod

IST_ZONE = "Asia/Kolkata"


def _grounded_max_output_tokens() -> int:
    raw = (os.getenv("TURNOUT_GROUNDED_MAX_OUTPUT_TOKENS") or "").strip()
    if raw.isdigit():
        return max(512, min(8192, int(raw)))
    return 8192


def _response_diagnostics(resp: Any) -> str:
    bits: list[str] = []
    pf = getattr(resp, "prompt_feedback", None)
    if pf is not None:
        br = getattr(pf, "block_reason", None)
        if br is not None:
            bits.append(f"block_reason={br}")
    cands = getattr(resp, "candidates", None) or []
    if not cands:
        bits.append("candidates=0")
        return " ".join(bits) if bits else "no_feedback"
    c0 = cands[0]
    fr = getattr(c0, "finish_reason", None)
    if fr is not None:
        bits.append(f"finish_reason={fr}")
    return " ".join(bits) if bits else "ok"


def _strip_outer_code_fences(t: str) -> str:
    s = (t or "").strip()
    if not s:
        return s
    s = re.sub(r"^```(?:json)?\s*", "", s, count=1, flags=re.IGNORECASE)
    s = re.sub(r"\s*```\s*$", "", s, count=1)
    return s.strip()


def _fallback_parse_turnout_from_text(text: str) -> dict[str, Any] | None:
    """
    When JSON is truncated (MAX_TOKENS) or malformed, recover numeric band if present.
    """
    m_lo = re.search(r'"turnout_min"\s*:\s*([0-9]+(?:\.[0-9]+)?)', text)
    m_hi = re.search(r'"turnout_max"\s*:\s*([0-9]+(?:\.[0-9]+)?)', text)
    if not m_lo or not m_hi:
        return None
    try:
        lo = float(m_lo.group(1))
        hi = float(m_hi.group(1))
    except ValueError:
        return None
    if not (0 <= lo <= 100 and 0 <= hi <= 100):
        return None
    return {
        "turnout_min": lo,
        "turnout_max": hi,
        "confidence_0_1": 0.42,
        "methodology_note": "Recovered from partial model JSON after truncation or parse error.",
        "booth_news": [],
    }


def _load_official_urls() -> dict[str, list[str]]:
    defaults: dict[str, list[str]] = {
        "Kerala": ["https://ceo.kerala.gov.in/"],
        "Assam": ["https://ceoassam.in/"],
        "Puducherry": ["https://ceopuducherry.py.gov.in/"],
        "Tamil Nadu": ["https://www.elections.tn.gov.in/"],
        "West Bengal": ["https://ceowestbengal.wb.gov.in/"],
    }
    raw = os.getenv("TURNOUT_OFFICIAL_URLS_JSON", "").strip()
    if not raw:
        return defaults
    try:
        extra = json.loads(raw)
        for k, v in extra.items():
            if isinstance(v, list) and all(isinstance(x, str) for x in v):
                defaults[k] = v
    except json.JSONDecodeError:
        pass
    return defaults


def official_turnout_stub(state: str) -> dict[str, Any] | None:
    """
    Best-effort scrape of state CEO home / first path: look for % near turnout language.
    Returns None if nothing reliable (most of the time — still useful when a banner exists).
    """
    urls = _load_official_urls().get(state, [])[:2]
    ua = {"User-Agent": "Mozilla/5.0 (compatible; Dharma-OSINT/1.0; +https://github.com/sooryahprasath/election-osint)"}
    for url in urls:
        try:
            r = requests.get(url, headers=ua, timeout=12, allow_redirects=True)
            if r.status_code >= 400:
                continue
            soup = BeautifulSoup(r.content, "html.parser")
            for tag in soup(["script", "style", "nav", "footer"]):
                tag.decompose()
            text = soup.get_text("\n", strip=True)[:9000]
        except Exception:
            continue
        low = text.lower()
        if "turnout" not in low and "polling" not in low and "%" not in text:
            continue
        for m in re.finditer(r"(\d{1,2}(?:\.\d+)?)\s*%", text):
            try:
                val = float(m.group(1))
            except ValueError:
                continue
            if not (1.0 <= val <= 92.0):
                continue
            start = max(0, m.start() - 100)
            end = min(len(text), m.end() + 100)
            win = text[start:end].lower()
            if not any(k in win for k in ("turnout", "poll", "vot", "cast", "per cent", "percent")):
                continue
            return {
                "turnout_pct": val,
                "source_url": str(r.url).split("#")[0],
                "snippet": text[start:end].replace("\n", " ")[:200],
            }
    return None


def merge_official_stub_into_out(out: dict[str, Any], stub: dict[str, Any] | None) -> None:
    if not stub:
        return
    try:
        p = float(stub["turnout_pct"])
    except (KeyError, TypeError, ValueError):
        return
    if not (0 < p <= 100):
        return
    try:
        lo = float(out.get("turnout_min") or 0)
        hi = float(out.get("turnout_max") or 0)
    except (TypeError, ValueError):
        lo, hi = 0.0, 0.0
    url = str(stub.get("source_url") or "").strip()
    if lo <= 0 and hi <= 0:
        out["turnout_min"] = round(p, 1)
        out["turnout_max"] = round(p, 1)
        try:
            c = float(out.get("confidence_0_1") or 0.45)
        except (TypeError, ValueError):
            c = 0.45
        out["confidence_0_1"] = min(0.92, c + 0.12)
    bn = list(out.get("booth_news") or [])
    if url:
        line = {
            "text": f"State CEO page cites ~{p:g}% turnout context (verify on site).",
            "source": url,
            "type": "official_hint",
        }
        bn.insert(0, line)
    out["booth_news"] = bn


def validate_and_trim_grounded_json(data: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    try:
        lo = float(data.get("turnout_min") or 0)
        hi = float(data.get("turnout_max") or 0)
    except (TypeError, ValueError):
        lo, hi = 0.0, 0.0
    if lo > hi:
        lo, hi = hi, lo
    if lo < 0 or hi > 100:
        lo, hi = 0.0, 0.0
    out["turnout_min"] = lo
    out["turnout_max"] = hi
    try:
        conf = float(data.get("confidence_0_1") or 0.5)
    except (TypeError, ValueError):
        conf = 0.5
    out["confidence_0_1"] = max(0.0, min(1.0, conf))
    note = str(data.get("methodology_note") or "").strip()
    out["methodology_note"] = note[:400]

    booth: list[dict[str, Any]] = []
    for it in data.get("booth_news") or []:
        if not isinstance(it, dict):
            continue
        src = str(it.get("source") or "").strip()
        tx = str(it.get("text") or "").strip()
        if not src.startswith("https://"):
            continue
        if len(tx) < 15:
            continue
        booth.append(
            {
                "text": tx[:280],
                "source": src[:500],
                "type": str(it.get("type") or "grounded"),
            }
        )
    out["booth_news"] = booth[:6]
    return out


def _collect_response_text(resp: Any) -> str:
    """
    Prefer `resp.text`; if empty, concatenate **all** part texts (including thought parts —
    the SDK omits thought segments from `.text`, which can yield an empty string even when
    the model returned JSON in a thought segment).
    """
    t = (getattr(resp, "text", None) or "").strip()
    if t:
        return t
    cands = getattr(resp, "candidates", None) or []
    if not cands:
        return ""
    content = getattr(cands[0], "content", None)
    parts = getattr(content, "parts", None) if content else None
    if not parts:
        return ""
    chunks: list[str] = []
    for p in parts:
        pt = getattr(p, "text", None)
        if isinstance(pt, str) and pt.strip():
            chunks.append(pt)
    return "\n".join(chunks).strip()


def _extract_json_object(text: str) -> str | None:
    """Take the first `{` … `}` slice with balanced braces, ignoring braces inside strings."""
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    in_string = False
    escape = False
    for i in range(start, len(text)):
        c = text[i]
        if in_string:
            if escape:
                escape = False
                continue
            if c == "\\":
                escape = True
                continue
            if c == '"':
                in_string = False
            continue
        if c == '"':
            in_string = True
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None


def _repair_json_string_controls(s: str) -> str:
    """Replace raw control chars inside JSON string literals (invalid in strict JSON)."""
    out: list[str] = []
    in_string = False
    escape = False
    i = 0
    while i < len(s):
        c = s[i]
        if not in_string:
            out.append(c)
            if c == '"':
                in_string = True
            i += 1
            continue
        if escape:
            out.append(c)
            escape = False
            i += 1
            continue
        if c == "\\":
            out.append(c)
            escape = True
            i += 1
            continue
        if c == '"':
            in_string = False
            out.append(c)
            i += 1
            continue
        o = ord(c)
        if o < 32:
            out.append(" ")
            i += 1
            continue
        out.append(c)
        i += 1
    return "".join(out)


def _parse_json_response(text: str) -> dict[str, Any]:
    t = (text or "").strip()
    if t.startswith("\ufeff"):
        t = t[1:]
    t = _strip_outer_code_fences(t)
    blob = _extract_json_object(t) or t
    blob = _repair_json_string_controls(blob)
    return json.loads(blob)


def run_grounded_turnout_pipeline(
    client: "genai_mod.Client",
    state: str,
    finalize: bool,
    now: datetime,
) -> dict[str, Any] | None:
    """
    Single Gemini call with Google Search grounding → JSON turnout + booth_news.
    Post-process with optional CEO stub merge + shared sanitizers from voting_day_ingestor.
    """
    from zoneinfo import ZoneInfo

    IST = ZoneInfo(IST_ZONE)
    ist = now.astimezone(IST)
    date_s = ist.strftime("%Y-%m-%d")
    clock_s = ist.strftime("%H:%M")

    stub = official_turnout_stub(state)
    stub_hint = ""
    if stub:
        stub_hint = (
            f"\nOptional local crawl hint (may be stale or wrong): saw ~{stub['turnout_pct']}% "
            f"near turnout language on {stub.get('source_url', '')} — you MUST verify with search.\n"
        )

    phase_note = (
        "Focus on **final / closing** turnout bands if polls have ended or closing summaries exist."
        if finalize
        else "Focus on **intraday** figures: 'as of HH:MM', 'till X am', first hours, etc. Prefer the freshest attributed %."
    )

    prompt = f"""{phase_note}
State: {state} — India Legislative Assembly election 2026.
IST date: {date_s} (now about {clock_s} IST).

Use Google Search. Find **only** factual items from roughly the last 24–36 hours:

1) **Voter turnout** percentages **explicitly** tied to **{state}** for **{date_s}** (or clearly "today" IST).
   - Include time-slice figures (e.g. % till 9am) as separate logical readings if multiple sources give different slices.
2) Up to **3** short **booth / field** lines for **{state}** today (EVM, re-poll, violence, queues). One short sentence per line.

{stub_hint}
Output **only** valid JSON — no markdown, no code fences, no commentary before or after.
{{
  "turnout_min": 0,
  "turnout_max": 0,
  "confidence_0_1": 0.55,
  "methodology_note": "max 90 chars, no double-quotes inside",
  "booth_news": [{{"text": "min 15 chars factual line", "source": "https://publisher/..."}}]
}}

Hard rules:
- If search finds **no** explicit % for {state} for {date_s}, set turnout_min and turnout_max to **0**.
- If one clear point estimate, set min=max (or tight band if sources give a range).
- Every booth_news.source MUST be **https** from a page you actually found; text ≥ 15 characters.
- Do **not** invent numbers, times, or URLs.
- Lower confidence_0_1 when sources disagree or are only unverified social.
- **One compact line of JSON** if possible; no raw line breaks inside strings.
- Do **not** put a double-quote character inside any string value (rephrase; use 'single quotes' in prose if needed).
- methodology_note: max ~90 characters, **no** double-quotes inside it.
"""

    tool = types.Tool(google_search=types.GoogleSearch())
    cfg = types.GenerateContentConfig(
        tools=[tool],
        temperature=0.15,
        max_output_tokens=_grounded_max_output_tokens(),
        thinking_config=types.ThinkingConfig(thinking_budget=0),
    )

    try:
        resp = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=cfg,
        )
        raw_text = _collect_response_text(resp)
    except Exception as e:
        print(f"      [!] Grounded turnout {state}: {e}")
        return None

    if not raw_text:
        diag = _response_diagnostics(resp)
        print(f"      [!] Grounded turnout {state}: empty model text ({diag})")
        return None

    try:
        data = validate_and_trim_grounded_json(_parse_json_response(raw_text))
    except (json.JSONDecodeError, ValueError) as e:
        preview = raw_text[:240].replace("\n", " ")
        diag = _response_diagnostics(resp)
        fb = _fallback_parse_turnout_from_text(raw_text)
        if fb:
            print(
                f"      [~] Grounded JSON parse {state}: {e} — using numeric fallback ({diag}) | head={preview!r}"
            )
            data = validate_and_trim_grounded_json(fb)
        else:
            print(f"      [!] Grounded JSON parse {state}: {e} ({diag}) | head={preview!r}")
            return None

    merge_official_stub_into_out(data, stub)

    # Re-validate booth after merge (official_hint has https)
    data = validate_and_trim_grounded_json(data)

    note = str(data.get("methodology_note") or "").strip()
    if len(note) >= 24:
        booth = list(data.get("booth_news") or [])
        booth.append({"text": note[:280], "source": "", "type": "methodology"})
        data["booth_news"] = booth

    import voting_day_ingestor as vd

    booth = list(data.get("booth_news") or [])
    booth = vd.prune_booth_news_items(booth)
    data["booth_news"] = vd.sanitize_booth_news_urls(booth)

    try:
        lo = float(data.get("turnout_min") or 0)
        hi = float(data.get("turnout_max") or 0)
    except (TypeError, ValueError):
        lo, hi = 0.0, 0.0
    if lo <= 0 and hi <= 0 and not data.get("booth_news"):
        print(f"      [SKIP] Grounded {state}: no turnout and no booth lines")
        return None
    return data
