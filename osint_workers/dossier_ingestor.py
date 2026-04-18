import argparse
import os
import re
import time
import json
import difflib
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime, timezone
from difflib import SequenceMatcher
import hashlib

import requests
from bs4 import BeautifulSoup, Tag
from dotenv import load_dotenv


# ----------------------------
# ENV / SUPABASE
# ----------------------------
env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
load_dotenv(dotenv_path=env_path)

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

SUPABASE_KEY = SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY

def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

try:
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise ValueError("Supabase credentials missing.")
    _SB_REST = f"{SUPABASE_URL.rstrip('/')}/rest/v1"
    _SB_HEADERS = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    supabase = True
except Exception as e:
    print(f"CRITICAL: Supabase offline: {e}")
    supabase = None


def _sb_req(method: str, table: str, *, params: dict | None = None, payload=None, headers: dict | None = None):
    if not supabase:
        raise RuntimeError("supabase_offline")
    url = f"{_SB_REST}/{table}"
    h = dict(_SB_HEADERS)
    if headers:
        h.update(headers)
    resp = requests.request(method, url, headers=h, params=params or {}, json=payload, timeout=45)
    if resp.status_code >= 400:
        raise RuntimeError(f"supabase_http_{resp.status_code}: {resp.text[:240]}")
    if resp.text.strip() == "":
        return None
    try:
        return resp.json()
    except Exception:
        return resp.text


def sb_select(
    table: str,
    select: str,
    *,
    filters: dict[str, str] | None = None,
    order: str | None = None,
    limit: int | None = None,
    offset: int | None = None,
) -> list[dict]:
    params: dict[str, str] = {"select": select}
    if filters:
        params.update(filters)
    if order:
        params["order"] = order
    if limit is not None:
        params["limit"] = str(int(limit))
    if offset is not None:
        params["offset"] = str(int(offset))
    data = _sb_req("GET", table, params=params)
    return data if isinstance(data, list) else []


def sb_upsert(table: str, rows: list[dict], *, on_conflict: str = "id") -> None:
    if not rows:
        return
    headers = {"Prefer": "resolution=merge-duplicates,return=minimal"}
    _sb_req("POST", table, params={"on_conflict": on_conflict}, payload=rows, headers=headers)


def sb_update(table: str, payload: dict, *, filters: dict[str, str]) -> None:
    headers = {"Prefer": "return=minimal"}
    _sb_req("PATCH", table, params=filters, payload=payload, headers=headers)


def sb_delete(table: str, *, filters: dict[str, str]) -> int:
    """
    Delete rows matching filters. Returns number of rows deleted when representation is available.
    """
    headers = {"Prefer": "return=representation"}
    data = _sb_req("DELETE", table, params=filters, headers=headers)
    return len(data) if isinstance(data, list) else 0


# ----------------------------
# INTERNET CONNECTIVITY
# ----------------------------
_CONNECTIVITY_CHECK_URL = "https://connectivitycheck.gstatic.com/generate_204"
_CONNECTIVITY_TIMEOUT_S = 5


def _is_net_error(exc: Exception) -> bool:
    """Return True if the exception looks like a network/connectivity failure."""
    msg = str(exc).lower()
    net_keywords = ("net::", "err_internet", "err_network", "err_name_not_resolved",
                    "err_connection", "err_timed_out", "connection refused",
                    "timed out", "timeout", "unreachable", "no route")
    return any(kw in msg for kw in net_keywords)


def wait_for_internet(*, max_wait: int = 1800, check_interval: int = 10, tag: str = "") -> bool:
    """
    Block until HTTP connectivity is restored or max_wait seconds have elapsed.
    Returns True when connectivity is back, False when timed-out.
    """
    prefix = f"[{tag}] " if tag else ""
    attempt = 0
    while True:
        try:
            r = requests.get(_CONNECTIVITY_CHECK_URL, timeout=_CONNECTIVITY_TIMEOUT_S)
            if r.status_code < 500:
                if attempt > 0:
                    print(f"{prefix}[internet] Reconnected after {attempt * check_interval}s.", flush=True)
                return True
        except Exception:
            pass
        attempt += 1
        waited = attempt * check_interval
        if waited >= max_wait:
            print(f"{prefix}[internet] Gave up waiting after {max_wait}s.", flush=True)
            return False
        if attempt == 1:
            print(f"{prefix}[internet] Connectivity lost — waiting to reconnect...", flush=True)
        time.sleep(check_interval)


# Optional LLM fallback (set DOSSIER_LLM_FALLBACK=1 and GEMINI_API_KEY)
_DOSSIER_LLM = os.getenv("DOSSIER_LLM_FALLBACK", "").lower() in ("1", "true", "yes")
_LLM_CALLS = 0
_LLM_MAX = int(os.getenv("DOSSIER_LLM_MAX_CALLS", "40"))
_gemini_client = None
if _DOSSIER_LLM and os.getenv("GEMINI_API_KEY"):
    try:
        from google import genai as _genai_mod

        _gemini_client = _genai_mod.Client(api_key=os.getenv("GEMINI_API_KEY"))
    except Exception as _e:
        print(f"[dossier] LLM disabled (import/init): {_e}")


# ----------------------------
# CONFIG
# ----------------------------
ECI_BASE_URL = "https://affidavit.eci.gov.in"
ELECTION_HASH = "32-AC-GENERAL-3-60"

# ECI uses numeric codes; TN/WB currently pending per your note (leave commented until live)
ECI_STATE_CONFIG = [
    # max_pages is optional; scraper auto-stops when result table becomes empty/missing.
    {"name": "Kerala", "code": "S11", "prefix": "KER"},
    {"name": "Assam", "code": "S03", "prefix": "ASM"},
    {"name": "Puducherry", "code": "U07", "prefix": "PY"},
    {"name": "Tamil Nadu", "code": "S22", "prefix": "TN"},
    {"name": "West Bengal", "code": "S25", "prefix": "WB"},
]

MYNETA_CONFIG = [
    # pages is optional; scraper auto-stops when summary pages return 0 candidate rows.
    {"name": "Kerala", "prefix": "KER", "base": "https://myneta.info/Kerala2026/"},
    {"name": "Assam", "prefix": "ASM", "base": "https://myneta.info/Assam2026/"},
    {"name": "Puducherry", "prefix": "PY", "base": "https://myneta.info/Puducherry2026/"},
    {"name": "West Bengal", "prefix": "WB", "base": "https://myneta.info/WestBengal2026/"},
]

# Safety caps to avoid infinite paging if upstream HTML changes.
ECI_HARD_PAGE_CAP = int(os.getenv("ECI_HARD_PAGE_CAP", "600"))
MYNETA_HARD_PAGE_CAP = int(os.getenv("MYNETA_HARD_PAGE_CAP", "60"))
PAGINATION_EMPTY_STREAK_STOP = int(os.getenv("PAGINATION_EMPTY_STREAK_STOP", "2"))
# ECI is noisy (intermittent empty pages / transient loads). Stop only after 3 consecutive "no data" pages.
ECI_EMPTY_STREAK_STOP = int(os.getenv("ECI_EMPTY_STREAK_STOP", "3"))


def _eci_page_is_no_data(html: str) -> bool:
    """
    ECI end-of-list patterns observed:
    - A table area renders but shows: "No Data Available"
    - The table is missing or has 0 rows
    This is a conservative detector; the caller still uses a 3-page streak before stopping.
    """
    blob = (html or "").lower()
    if "no data available" in blob:
        return True
    # If the table exists but has no <tr> in <tbody>, treat as no-data.
    try:
        soup = BeautifulSoup(html or "", "html.parser")
        table = soup.find("table", id="data-tab")
        if not table:
            return True
        tbody = table.find("tbody")
        rows = tbody.find_all("tr") if tbody else []
        return len(rows) == 0
    except Exception:
        # If parsing fails, do NOT call it no-data (avoid premature stop).
        return False


def _config_matches_state_token(cfg: dict, token: str) -> bool:
    t = (token or "").strip().lower()
    if not t:
        return False
    name = (cfg.get("name") or "").strip().lower()
    prefix = (cfg.get("prefix") or "").strip().lower()
    code = (cfg.get("code") or "").strip().lower()
    return t == name or t == prefix or (bool(code) and t == code)


def _parse_states_cli(states_append: list[str] | None) -> list[str] | None:
    if not states_append:
        return None
    out: list[str] = []
    for chunk in states_append:
        for part in str(chunk).split(","):
            s = part.strip()
            if s:
                out.append(s)
    return out or None


def _validate_state_tokens(tokens: list[str]) -> None:
    """Reject unknown tokens using ECI config (superset of known state names/prefixes/codes)."""
    bad = [tok for tok in tokens if not any(_config_matches_state_token(c, tok) for c in ECI_STATE_CONFIG)]
    if not bad:
        return
    hints = "; ".join(
        f"{c['name']} / {c['prefix']}" + (f" / {c['code']}" if c.get("code") else "")
        for c in ECI_STATE_CONFIG
    )
    raise SystemExit(f"Unknown --states token(s): {bad}. Known states: {hints}")


def _filter_configs_by_states(configs: list[dict], tokens: list[str] | None) -> list[dict]:
    if not tokens:
        return list(configs)
    return [c for c in configs if any(_config_matches_state_token(c, t) for t in tokens)]


# ----------------------------
# MATCHING HELPERS
# ----------------------------
def clean_full_name(name: str) -> str:
    """Aggressive normalization for ledger dedupe keys (may drop initials)."""
    name = (name or "").lower()
    name = re.sub(r"\b(adv|dr|prof|mrs|mr|shri|smt)\b\.?", " ", name)
    # Strip relationship suffixes even when written with spaces (S/O, S / O, S O)
    name = re.sub(r"\b([sdw])\s*/?\s*o\b.*$", " ", name)
    name = re.sub(r"[^\w\s@]", " ", name)  # keep @ for alias checking
    name = re.sub(r"\b[a-z]\b", " ", name)
    return " ".join(name.split())


def _eci_candidate_id(*, constituency_id: str, cand_name: str, party: str, source_url: str) -> str:
    """
    Collision-safe candidate id.
    IMPORTANT: We cannot truncate names; TN has thousands of candidates and short-prefix IDs collide.
    """
    base = "|".join(
        [
            (constituency_id or "").strip(),
            clean_full_name(cand_name or ""),
            (party or "").strip().lower(),
            (source_url or "").strip().lower(),
        ]
    )
    h = hashlib.sha1(base.encode("utf-8")).hexdigest()[:12]
    # Keep the id human-ish for debugging while being stable.
    return f"cand-{constituency_id}-{h}"


def _dedupe_key_for_candidate(row: dict) -> str:
    party_raw = (row.get("party") or "").strip().lower()
    party_norm = party_raw or "ind"
    return "|".join(
        [
            (row.get("constituency_id") or "").strip(),
            clean_full_name(row.get("name") or ""),
            party_norm,
        ]
    )


def _score_candidate_row(x: dict) -> tuple[int, int, str]:
    """
    Prefer keeping:
    - already MyNeta-enriched rows
    - active rows (removed=false)
    - most recent ECI sync
    """
    has_m = 1 if x.get("myneta_last_synced_at") else 0
    is_active = 1 if not x.get("removed") else 0
    eci_ts = str(x.get("eci_last_synced_at") or "")
    return (has_m, is_active, eci_ts)


def build_candidate_id_index_for_prefix(prefix: str) -> tuple[dict[str, str], list[str]]:
    """
    Build a mapping from dedupe-key -> keeper candidate.id for a state prefix.
    Also returns a list of duplicate candidate IDs to delete.

    This is used to ensure ECI re-scrapes UPDATE existing rows instead of INSERTing duplicates.
    """
    if not supabase:
        return {}, []
    if not prefix:
        return {}, []

    rows: list[dict] = []
    step = 1000
    offset = 0
    while True:
        chunk = sb_select(
            "candidates",
            "id,constituency_id,name,party,eci_last_synced_at,myneta_last_synced_at,removed",
            filters={"constituency_id": f"like.{prefix}-%"},
            limit=step,
            offset=offset,
        )
        if not chunk:
            break
        rows.extend(chunk)
        if len(chunk) < step:
            break
        offset += step

    by_key: dict[str, list[dict]] = {}
    for r in rows:
        k = _dedupe_key_for_candidate(r)
        if not k.strip("|"):
            continue
        by_key.setdefault(k, []).append(r)

    keep_by_key: dict[str, str] = {}
    drop_ids: list[str] = []
    for k, items in by_key.items():
        items_sorted = sorted(items, key=_score_candidate_row, reverse=True)
        keep = items_sorted[0]
        keep_id = keep.get("id")
        if keep_id:
            keep_by_key[k] = keep_id
        for extra in items_sorted[1:]:
            if extra.get("id"):
                drop_ids.append(extra["id"])

    return keep_by_key, drop_ids


def dedupe_candidates_in_db(*, prefixes: list[str]) -> dict:
    """
    Remove duplicate candidate rows created by earlier ID schemes.
    Dedupe key: (constituency_id, normalized name, party).
    Keep preference:
    - has myneta_last_synced_at (already enriched)
    - else latest eci_last_synced_at
    Deletes the rest.
    """
    if not supabase:
        return {"checked": 0, "groups": 0, "deleted": 0}
    if not prefixes:
        return {"checked": 0, "groups": 0, "deleted": 0}

    deleted = 0
    checked = 0
    groups = 0

    for prefix in prefixes:
        rows: list[dict] = []
        step = 1000
        offset = 0
        while True:
            chunk = sb_select(
                "candidates",
                "id,constituency_id,name,party,eci_last_synced_at,myneta_last_synced_at,removed",
                filters={"constituency_id": f"like.{prefix}-%"},
                limit=step,
                offset=offset,
            )
            if not chunk:
                break
            rows.extend(chunk)
            if len(chunk) < step:
                break
            offset += step
        checked += len(rows)
        by_key: dict[str, list[dict]] = {}
        for r in rows:
            k = _dedupe_key_for_candidate(r)
            if not k.strip("|"):
                continue
            by_key.setdefault(k, []).append(r)

        for k, items in by_key.items():
            if len(items) <= 1:
                continue
            groups += 1
            items_sorted = sorted(items, key=_score_candidate_row, reverse=True)
            keep = items_sorted[0]
            drop_ids = [x["id"] for x in items_sorted[1:] if x.get("id")]
            if not drop_ids:
                continue

            # Delete in chunks to avoid long URLs.
            for i in range(0, len(drop_ids), 50):
                chunk = drop_ids[i : i + 50]
                ids = ",".join(chunk)
                deleted += sb_delete("candidates", filters={"id": f"in.({ids})"})

    return {"checked": checked, "groups": groups, "deleted": deleted}


def nuke_candidates_in_db(*, prefixes: list[str]) -> dict:
    """
    Hard-delete ALL candidate rows for the given state prefixes.
    DESTRUCTIVE — candidates for the state must be re-scraped from ECI afterwards.
    """
    if not supabase:
        return {"deleted": 0, "error": "supabase_offline"}
    if not prefixes:
        return {"deleted": 0, "error": "no_prefixes"}
    total = 0
    for prefix in prefixes:
        n = sb_delete("candidates", filters={"constituency_id": f"like.{prefix}-%"})
        print(f"    [nuke] {prefix}: deleted={n}", flush=True)
        total += n
    return {"deleted": total}


def name_alias_parts(name: str) -> list[str]:
    """Split on @ or 'Alias' (Indian affidavit / MyNeta patterns)."""
    n = (name or "").strip()
    if not n:
        return []
    parts = re.split(r"\s*@\s*|\b[Aa]lias\b", n)
    return [p.strip() for p in parts if p.strip()]


def squish_alpha(s: str) -> str:
    """Collapse for fuzzy compare: T. I. X -> tix; handles periods and spaces."""
    x = (s or "").lower()
    x = re.sub(r"([a-z])\.(?=\s|$)", r"\1 ", x)
    x = re.sub(r"[.\s\-_]+", "", x)
    return re.sub(r"[^a-z]", "", x)


def name_similarity(a: str, b: str) -> float:
    """0–1 score; checks each alias segment on both sides."""
    best = 0.0
    parts_a = name_alias_parts(a) or [a]
    parts_b = name_alias_parts(b) or [b]
    for pa in parts_a:
        sa = squish_alpha(pa)
        if len(sa) < 2:
            continue
        for pb in parts_b:
            sb = squish_alpha(pb)
            if len(sb) < 2:
                continue
            best = max(best, SequenceMatcher(None, sa, sb).ratio())
    return best


def clean_full_name_overlap(name: str) -> str:
    """Token overlap on names: keep single-letter tokens (initials)."""
    name = (name or "").lower()
    name = re.sub(r"\b(adv|dr|prof|mrs|mr|shri|smt)\b\.?", " ", name)
    name = re.sub(r"\b([sdw])\s*/?\s*o\b.*$", " ", name)
    name = re.sub(r"[^\w\s@]", " ", name)
    return " ".join(name.split())


def overlap_tokens(name: str) -> set[str]:
    """Meaningful tokens + merged single-letter runs (A K M -> akm)."""
    raw = clean_full_name_overlap(name)
    toks: set[str] = set()
    for segment in re.split(r"\s*@\s*|\b[Aa]lias\b", raw):
        seg = segment.strip()
        if not seg:
            continue
        words = seg.split()
        i = 0
        while i < len(words):
            if len(words[i]) == 1 and words[i].isalpha():
                j = i
                while j < len(words) and len(words[j]) == 1 and words[j].isalpha():
                    j += 1
                chunk = "".join(words[i:j])
                if chunk:
                    toks.add(chunk)
                i = j
            else:
                w = words[i]
                if len(w) >= 2:
                    toks.add(w)
                i += 1
    return toks


def calculate_token_overlap_v2(name1: str, name2: str) -> float:
    s1, s2 = overlap_tokens(name1), overlap_tokens(name2)
    if not s1 or not s2:
        return 0.0
    inter = s1.intersection(s2)
    return len(inter) / min(len(s1), len(s2))


def get_core_word_v2(name: str) -> str:
    words = [w for w in clean_full_name_overlap(name).split() if len(w) > 1]
    return max(words, key=len) if words else ""


def intelligent_match(target: str, options: list[str]) -> str | None:
    if not options or not (target or "").strip():
        return None

    # Tier 0: squished / alias-aware string similarity (initials, T.I. vs T I, @ vs Alias)
    best_idx = None
    best_sim = 0.0
    for idx, opt in enumerate(options):
        sim = name_similarity(target, opt)
        if sim > best_sim:
            best_sim = sim
            best_idx = idx
    if best_idx is not None and best_sim >= 0.86:
        return options[best_idx]

    target_clean = clean_full_name_overlap(target)
    options_clean = [clean_full_name_overlap(o) for o in options]

    target_aliases = [target_clean]
    if "alias" in target_clean or "@" in target_clean:
        target_aliases = re.split(r"\balias\b|@", target_clean)
        target_aliases = [a.strip() for a in target_aliases if len(a.strip()) > 1]

    for alias in target_aliases:
        for idx, opt in enumerate(options):
            if calculate_token_overlap_v2(alias, opt) >= 0.55:
                return options[idx]

        alias_core = get_core_word_v2(alias)
        if alias_core and len(alias_core) > 3:
            for idx, opt in enumerate(options):
                if get_core_word_v2(opt) == alias_core:
                    return options[idx]

    matches = difflib.get_close_matches(target_clean, options_clean, n=1, cutoff=0.58)
    if matches:
        return options[options_clean.index(matches[0])]

    if best_idx is not None and best_sim >= 0.78:
        return options[best_idx]
    return None


def best_constituency_name_match(raw: str, db_names: list[str]) -> str | None:
    """
    Map ECI / MyNeta constituency labels to an exact DB constituency name
    (e.g. Manjeshwaram vs MANJESHWAR, Kadirkamam vs KADIRGAMAM).
    """
    if not raw or not db_names:
        return None
    raw_l = raw.strip().lower()
    raw_sq = re.sub(r"[^a-z]", "", raw_l)

    best: str | None = None
    best_score = 0.0

    for n in db_names:
        nl = (n or "").strip().lower()
        if not nl:
            continue
        n_sq = re.sub(r"[^a-z]", "", nl)
        r1 = SequenceMatcher(None, raw_l, nl).ratio()
        r2 = SequenceMatcher(None, raw_sq, n_sq).ratio() if raw_sq and n_sq else 0.0
        # prefix / truncated variant (e.g. Manjeshwar ⊂ Manjeshwaram)
        r3 = 0.0
        shorter, longer = (raw_sq, n_sq) if len(raw_sq) <= len(n_sq) else (n_sq, raw_sq)
        if len(shorter) >= 6 and shorter != longer and longer.startswith(shorter):
            r3 = len(shorter) / len(longer) * 0.98
        sc = max(r1, r2, r3)
        if sc > best_score:
            best_score = sc
            best = n

    if best_score >= 0.74:
        return best

    # Token overlap on long tokens (≥4 chars)
    raw_toks = {t for t in re.split(r"\W+", raw_l) if len(t) >= 4}
    if raw_toks:
        cand2: str | None = None
        sc2 = 0.0
        for n in db_names:
            nl = (n or "").strip().lower()
            nt = {t for t in re.split(r"\W+", nl) if len(t) >= 4}
            if not nt:
                continue
            inter = raw_toks.intersection(nt)
            if not inter:
                continue
            j = len(inter) / max(1, min(len(raw_toks), len(nt)))
            if j > sc2:
                sc2 = j
                cand2 = n
        if cand2 and sc2 >= 0.5:
            return cand2

    return best if best_score >= 0.62 else None


def find_best_constituency_match(eci_state: str, eci_constituency: str, db_constituencies: list[dict]) -> str | None:
    state_constituencies = [c for c in db_constituencies if (c.get("state") or "").lower() == (eci_state or "").lower()]
    if not state_constituencies:
        return None
    names = [c["name"] for c in state_constituencies if c.get("name")]
    hit = best_constituency_name_match(eci_constituency, names)
    if not hit:
        return None
    for c in state_constituencies:
        if (c.get("name") or "") == hit:
            return c.get("id")
    return None


def _llm_pick_option(kind: str, query: str, options: list[str]) -> int | None:
    """Return index into options or None. Bounded by _LLM_MAX per run."""
    global _LLM_CALLS
    if not _gemini_client or _LLM_CALLS >= _LLM_MAX or len(options) > 80:
        return None
    try:
        payload = json.dumps({"query": query, "options": options[:80]}, ensure_ascii=False)
        prompt = f"""You match Indian election {kind} names between two sources (ECI vs MyNeta / DB).
Given QUERY and a list OPTIONS (exact strings), reply with ONLY a JSON object: {{"pick": <0-based index>}} or {{"pick": null}} if none clearly match.
Rules: tolerate spelling variants, missing 'm', truncated names, Malayalam/Tamil romanization differences. Same person = pick one index.

{payload}"""
        _LLM_CALLS += 1
        resp = _gemini_client.models.generate_content(
            model=os.getenv("DOSSIER_LLM_MODEL", "gemini-2.5-flash"),
            contents=prompt,
        )
        text = (getattr(resp, "text", None) or "").strip()
        if text.startswith("```"):
            text = re.sub(r"^```\w*\s*", "", text)
            text = re.sub(r"\s*```$", "", text)
        data = json.loads(text)
        idx = data.get("pick")
        if idx is None:
            return None
        i = int(idx)
        if 0 <= i < len(options):
            return i
    except Exception as e:
        print(f"    [LLM] {kind} match failed: {e}")
    return None


# ----------------------------
# CURRENCY PARSING
# ----------------------------
def clean_currency_to_int(s: str) -> int:
    if not s:
        return 0
    s = s.strip()
    if s.lower() in ["nil", "none", "0", "rs 0 ~", "rs 0", "0 ~"]:
        return 0
    # MyNeta strings are often like:
    #   "Rs 35,16,05,765 ~35 Crore+"
    # If we strip digits from the whole string we incorrectly append "35" to the rupee value,
    # producing 35160576535 (→ 3516 Cr). Always take the value *before* "~" if present.
    # Normalize common unicode tilde variants to "~" (Windows consoles can be cp1252).
    s = s.replace("\u223c", "~").replace("\u221c", "~")
    # Split on tilde-like separators (MyNeta sometimes uses unicode variants)
    head = re.split(r"[~∼≈]", s, maxsplit=1)[0]
    # If the separator is missing, still stop at the common unit suffixes to avoid digit bleed.
    head = re.split(r"\b(crore|crores|lakh|lakhs|lacs)\b", head, maxsplit=1, flags=re.IGNORECASE)[0]
    # MyNeta can include paise as decimals; ignore anything after the decimal point.
    head = head.split(".", 1)[0]
    # keep digits only
    digits = re.sub(r"[^\d]", "", head)
    if not digits:
        return 0
    try:
        v = int(digits)
    except Exception:
        return 0
    # Sanity guard: if something still looks absurdly large, prefer 0 over poisoning the DB/UI.
    # (₹1e12 = 1,00,000 Cr)
    if v > 1_000_000_000_000:
        return 0
    return v


# ----------------------------
# ECI SCRAPER (Playwright)
# ----------------------------
def scrape_and_upsert_eci_candidates(
    db_constituencies: list[dict],
    headless: bool = False,
    *,
    state_configs: list[dict] | None = None,
) -> dict[str, set[str]]:
    """
    Scrape ECI per-state and upsert candidates.
    Returns: mapping {state_prefix: set(candidate_ids_seen_in_eci)}
    """
    seen_by_prefix: dict[str, set[str]] = {}
    if not supabase:
        return seen_by_prefix

    configs = state_configs if state_configs is not None else ECI_STATE_CONFIG

    print("\n[+] ECI: scraping contesting/accepted candidates...")
    print("    [!] Playwright will open a browser window." if not headless else "    [~] Running headless.")

    processed_ledger = set()  # (constituency_id, candidate_name_clean)
    batch: list[dict] = []
    # PostgREST upsert requires consistent object keys across the JSON array.
    eci_columns = (
        "id",
        "constituency_id",
        "name",
        "party",
        "photo_url",
        "source_url",
        "eci_affidavit_url",
        "nomination_status",
        "is_independent",
        "removed",
        "removed_at",
        "eci_last_synced_at",
        "age",
        "gender",
    )

    # Headless ECI often fails in the field; prefer visible browser always.
    if headless:
        print("    [!] NOTE: --eci-headless is ignored (ECI is unreliable headless). Running visible.", flush=True)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(viewport={"width": 1280, "height": 800})
        page = context.new_page()

        for state in configs:
            state_name = state["name"]
            state_code = state["code"]
            prefix = state["prefix"]
            seen_by_prefix.setdefault(prefix, set())
            max_pages = min(int(state.get("max_pages") or ECI_HARD_PAGE_CAP), ECI_HARD_PAGE_CAP)

            print(f"\n======================================")
            print(f" ECI TARGET: {state_name.upper()} (auto pages; cap={max_pages})")
            print(f"======================================")

            # Critical: avoid creating duplicates on re-scrapes.
            # Build a keeper-id map for this state so we UPDATE existing rows instead of INSERTing new ones.
            keep_by_key, drop_ids = build_candidate_id_index_for_prefix(prefix)
            if drop_ids:
                print(f"    [dedupe-pre] {prefix}: dup_rows={len(drop_ids)} (will delete after upsert)", flush=True)

            page_num = 1
            empty_streak = 0
            while page_num <= max_pages:
                url = f"{ECI_BASE_URL}/CandidateCustomFilter?electionType={ELECTION_HASH}&election={ELECTION_HASH}&states={state_code}&submitName=100&page={page_num}"
                print(f" -> Page {page_num}: {url}")
                try:
                    page.goto(url, wait_until="domcontentloaded", timeout=20000)
                    try:
                        page.wait_for_selector("table#data-tab", timeout=10000)
                    except Exception:
                        empty_streak += 1
                        print(f"    [..] No table found (empty_streak={empty_streak}/{ECI_EMPTY_STREAK_STOP})")
                        if empty_streak >= max(1, ECI_EMPTY_STREAK_STOP):
                            print("    [END] No-data streak reached; stopping pagination for this state.")
                            break
                        page_num += 1
                        continue

                    html = page.content()
                    if _eci_page_is_no_data(html):
                        empty_streak += 1
                        print(f"    [..] No data on page (empty_streak={empty_streak}/{ECI_EMPTY_STREAK_STOP})")
                        if empty_streak >= max(1, ECI_EMPTY_STREAK_STOP):
                            print("    [END] No-data streak reached; stopping pagination for this state.")
                            break
                        page_num += 1
                        continue

                    empty_streak = 0
                    soup = BeautifulSoup(html, "html.parser")
                    table = soup.find("table", id="data-tab")
                    tbody = table.find("tbody") if table else None
                    rows = tbody.find_all("tr") if tbody else []

                    for row in rows:
                        tds = row.find_all("td")
                        if len(tds) < 2:
                            continue

                        img_tag = tds[0].find("img")
                        photo_url = img_tag.get("src", "") if img_tag else ""

                        details_div = tds[1]
                        name_tag = details_div.find("h4")
                        cand_name = name_tag.text.strip() if name_tag else "Unknown"

                        party, status, const_name = "", "", ""
                        source_url_rel = ""
                        for p_tag in details_div.find_all("p"):
                            text = p_tag.text.strip()
                            if "Party" in text:
                                party = text.split(":")[-1].strip()
                            elif "Status" in text:
                                status = text.split(":")[-1].strip().lower()
                            elif "Constituency" in text:
                                const_name = text.split(":")[-1].strip()

                        hover_lay = details_div.find("div", class_="hover-lay")
                        if hover_lay:
                            a_tag = hover_lay.find("a")
                            if a_tag and a_tag.get("href"):
                                source_url_rel = a_tag["href"]

                        if status not in ["accepted", "contesting"]:
                            continue

                        c_id = find_best_constituency_match(state_name, const_name, db_constituencies)
                        if not c_id:
                            print(f"    [?] UNMAPPED constituency for {cand_name}: '{const_name}'")
                            continue

                        full_source_url = ""
                        if source_url_rel:
                            full_source_url = source_url_rel if source_url_rel.startswith("http") else f"{ECI_BASE_URL}/{source_url_rel.lstrip('/')}"

                        ledger_key = f"{c_id}_{clean_full_name(cand_name)}_{(party or '').strip().lower()}"
                        if ledger_key in processed_ledger:
                            continue
                        processed_ledger.add(ledger_key)

                        # Reuse existing id when the candidate already exists by natural key.
                        dedupe_key = _dedupe_key_for_candidate(
                            {"constituency_id": c_id, "name": cand_name, "party": party}
                        )
                        cand_id = keep_by_key.get(dedupe_key)
                        if not cand_id:
                            cand_id = _eci_candidate_id(
                                constituency_id=c_id,
                                cand_name=cand_name,
                                party=party,
                                source_url=full_source_url,
                            )
                            keep_by_key[dedupe_key] = cand_id
                        seen_by_prefix[prefix].add(cand_id)

                        # Deep dive for age/gender
                        age = None
                        gender = None
                        if full_source_url:
                            try:
                                profile_page = context.new_page()
                                profile_page.goto(full_source_url, wait_until="domcontentloaded", timeout=15000)
                                profile_soup = BeautifulSoup(profile_page.content(), "html.parser")

                                age_tag = profile_soup.find(lambda tag: tag.name == "p" and "Age:" in tag.text)
                                if age_tag:
                                    age_val = age_tag.find_parent("label").find_next_sibling("div").text.strip()
                                    if age_val.isdigit():
                                        age = int(age_val)

                                gender_tag = profile_soup.find(lambda tag: tag.name == "p" and "Gender:" in tag.text)
                                if gender_tag:
                                    gender = gender_tag.find_parent("label").find_next_sibling("div").text.strip().lower()

                                profile_page.close()
                            except Exception:
                                try:
                                    profile_page.close()
                                except Exception:
                                    pass

                        payload = {
                            "id": cand_id,
                            "constituency_id": c_id,
                            "name": cand_name.title(),
                            "party": party,
                            "photo_url": photo_url,
                            "source_url": full_source_url,
                            "eci_affidavit_url": full_source_url,
                            "nomination_status": "eci_verified",
                            "is_independent": (party or "").upper() in ["IND", "INDEPENDENT"],
                            "removed": False,
                            "removed_at": None,
                            "eci_last_synced_at": _utc_now_iso(),
                            "age": age,
                            "gender": gender or None,
                        }
                        payload = {k: payload.get(k) for k in eci_columns}

                        batch.append(payload)

                        if len(batch) >= 25:
                            unique = {item["id"]: item for item in batch}
                            sb_upsert("candidates", list(unique.values()), on_conflict="id")
                            print(f"    [>>>] Upserted {len(unique)} candidates.")
                            batch = []

                    time.sleep(0.8)  # be polite
                except Exception as e:
                    print(f"    [!] ECI page failed: {e}")
                    empty_streak += 1
                    if empty_streak >= max(1, ECI_EMPTY_STREAK_STOP):
                        print("    [END] Too many failed/empty pages; stopping.")
                        break

                page_num += 1

            # Delete duplicates discovered before this state run.
            if drop_ids:
                for i in range(0, len(drop_ids), 50):
                    ids = ",".join(drop_ids[i : i + 50])
                    sb_delete("candidates", filters={"id": f"in.({ids})"})
                print(f"    [dedupe-post] {prefix}: deleted={len(drop_ids)}", flush=True)

        if batch:
            unique = {item["id"]: item for item in batch}
            sb_upsert("candidates", list(unique.values()), on_conflict="id")
            print(f"    [>>>] Upserted final batch {len(unique)} candidates.")

        browser.close()

    return seen_by_prefix


def _eci_worker_run(state: dict, *, headless: bool) -> dict:
    """
    Run ECI scrape for ONE state config in an isolated process.
    Uses Supabase REST (no supabase python dependency).
    Returns {prefix, seen_ids, error}
    """
    url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    anon = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    sr = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    key = sr or anon
    if not url or not key:
        return {"prefix": state.get("prefix"), "seen_ids": [], "error": "missing_supabase_env"}

    rest = f"{url.rstrip('/')}/rest/v1"
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    def _req(method: str, table: str, *, params: dict | None = None, payload=None, extra_headers: dict | None = None):
        h = dict(headers)
        if extra_headers:
            h.update(extra_headers)
        r = requests.request(method, f"{rest}/{table}", headers=h, params=params or {}, json=payload, timeout=45)
        if r.status_code >= 400:
            raise RuntimeError(f"supabase_http_{r.status_code}: {r.text[:240]}")
        if r.text.strip() == "":
            return None
        try:
            return r.json()
        except Exception:
            return r.text

    def _select(table: str, select: str, *, filters: dict[str, str] | None = None, limit: int | None = None):
        p = {"select": select}
        if filters:
            p.update(filters)
        if limit is not None:
            p["limit"] = str(int(limit))
        out = _req("GET", table, params=p)
        return out if isinstance(out, list) else []

    def _delete_ids(table: str, ids: list[str]) -> int:
        if not ids:
            return 0
        deleted = 0
        for i in range(0, len(ids), 50):
            chunk = ids[i : i + 50]
            ids_q = ",".join(chunk)
            # Prefer representation to get a rowcount back.
            out = _req("DELETE", table, params={"id": f"in.({ids_q})"}, extra_headers={"Prefer": "return=representation"})
            deleted += len(out) if isinstance(out, list) else 0
        return deleted

    def _upsert(table: str, rows: list[dict], *, on_conflict: str = "id"):
        if not rows:
            return
        _req(
            "POST",
            table,
            params={"on_conflict": on_conflict},
            payload=rows,
            extra_headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
        )

    state_name = state["name"]
    state_code = state["code"]
    prefix = state["prefix"]
    max_pages = min(int(state.get("max_pages") or ECI_HARD_PAGE_CAP), ECI_HARD_PAGE_CAP)

    # Pull only the relevant constituency rows for matching.
    db_constituencies = _select(
        "constituencies",
        "id,name,state",
        filters={"id": f"like.{prefix}-%"},
        limit=6000,
    )
    if not db_constituencies:
        return {"prefix": prefix, "seen_ids": [], "error": "empty_constituencies_for_prefix"}

    seen_ids: set[str] = set()
    processed_ledger = set()
    batch: list[dict] = []
    eci_columns = (
        "id",
        "constituency_id",
        "name",
        "party",
        "photo_url",
        "source_url",
        "eci_affidavit_url",
        "nomination_status",
        "is_independent",
        "removed",
        "removed_at",
        "eci_last_synced_at",
        "age",
        "gender",
    )

    # Build keeper-id map so worker updates existing rows instead of inserting duplicates.
    existing = _select(
        "candidates",
        "id,constituency_id,name,party,eci_last_synced_at,myneta_last_synced_at,removed",
        filters={"constituency_id": f"like.{prefix}-%"},
        limit=50000,
    )
    by_key: dict[str, list[dict]] = {}
    for r in existing:
        k = _dedupe_key_for_candidate(r)
        if not k.strip("|"):
            continue
        by_key.setdefault(k, []).append(r)
    keep_by_key: dict[str, str] = {}
    drop_ids: list[str] = []
    for k, items in by_key.items():
        items_sorted = sorted(items, key=_score_candidate_row, reverse=True)
        keep = items_sorted[0]
        if keep.get("id"):
            keep_by_key[k] = keep["id"]
        for extra in items_sorted[1:]:
            if extra.get("id"):
                drop_ids.append(extra["id"])

    try:
        # Headless ECI is unreliable; run visible browser always in workers.
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=False)
            context = browser.new_context(viewport={"width": 1280, "height": 800})
            page = context.new_page()

            page_num = 1
            empty_streak = 0
            while page_num <= max_pages:
                url = f"{ECI_BASE_URL}/CandidateCustomFilter?electionType={ELECTION_HASH}&election={ELECTION_HASH}&states={state_code}&submitName=100&page={page_num}"
                try:
                    page.goto(url, wait_until="domcontentloaded", timeout=20000)
                    try:
                        page.wait_for_selector("table#data-tab", timeout=10000)
                    except Exception:
                        empty_streak += 1
                        if empty_streak >= max(1, ECI_EMPTY_STREAK_STOP):
                            break
                        page_num += 1
                        continue

                    html = page.content()
                    if _eci_page_is_no_data(html):
                        empty_streak += 1
                        if empty_streak >= max(1, ECI_EMPTY_STREAK_STOP):
                            break
                        page_num += 1
                        continue

                    empty_streak = 0
                    soup = BeautifulSoup(html, "html.parser")
                    table = soup.find("table", id="data-tab")
                    tbody = table.find("tbody") if table else None
                    rows = tbody.find_all("tr") if tbody else []

                    for row in rows:
                        tds = row.find_all("td")
                        if len(tds) < 2:
                            continue

                        img_tag = tds[0].find("img")
                        photo_url = img_tag.get("src", "") if img_tag else ""

                        details_div = tds[1]
                        name_tag = details_div.find("h4")
                        cand_name = name_tag.text.strip() if name_tag else "Unknown"

                        party, status, const_name = "", "", ""
                        source_url_rel = ""
                        for p_tag in details_div.find_all("p"):
                            text = p_tag.text.strip()
                            if "Party" in text:
                                party = text.split(":")[-1].strip()
                            elif "Status" in text:
                                status = text.split(":")[-1].strip().lower()
                            elif "Constituency" in text:
                                const_name = text.split(":")[-1].strip()

                        hover_lay = details_div.find("div", class_="hover-lay")
                        if hover_lay:
                            a_tag = hover_lay.find("a")
                            if a_tag and a_tag.get("href"):
                                source_url_rel = a_tag["href"]

                        if status not in ["accepted", "contesting"]:
                            continue

                        c_id = find_best_constituency_match(state_name, const_name, db_constituencies)
                        if not c_id:
                            continue

                        full_source_url = ""
                        if source_url_rel:
                            full_source_url = source_url_rel if source_url_rel.startswith("http") else f"{ECI_BASE_URL}/{source_url_rel.lstrip('/')}"

                        ledger_key = f"{c_id}_{clean_full_name(cand_name)}_{(party or '').strip().lower()}"
                        if ledger_key in processed_ledger:
                            continue
                        processed_ledger.add(ledger_key)

                        dedupe_key = _dedupe_key_for_candidate(
                            {"constituency_id": c_id, "name": cand_name, "party": party}
                        )
                        cand_id = keep_by_key.get(dedupe_key)
                        if not cand_id:
                            cand_id = _eci_candidate_id(
                                constituency_id=c_id,
                                cand_name=cand_name,
                                party=party,
                                source_url=full_source_url,
                            )
                            keep_by_key[dedupe_key] = cand_id
                        seen_ids.add(cand_id)

                        age = None
                        gender = None
                        if full_source_url:
                            try:
                                profile_page = context.new_page()
                                profile_page.goto(full_source_url, wait_until="domcontentloaded", timeout=15000)
                                profile_soup = BeautifulSoup(profile_page.content(), "html.parser")

                                age_tag = profile_soup.find(lambda tag: tag.name == "p" and "Age:" in tag.text)
                                if age_tag:
                                    age_val = age_tag.find_parent("label").find_next_sibling("div").text.strip()
                                    if age_val.isdigit():
                                        age = int(age_val)

                                gender_tag = profile_soup.find(lambda tag: tag.name == "p" and "Gender:" in tag.text)
                                if gender_tag:
                                    gender = gender_tag.find_parent("label").find_next_sibling("div").text.strip().lower()

                                profile_page.close()
                            except Exception:
                                try:
                                    profile_page.close()
                                except Exception:
                                    pass

                        payload = {
                            "id": cand_id,
                            "constituency_id": c_id,
                            "name": cand_name.title(),
                            "party": party,
                            "photo_url": photo_url,
                            "source_url": full_source_url,
                            "eci_affidavit_url": full_source_url,
                            "nomination_status": "eci_verified",
                            "is_independent": (party or "").upper() in ["IND", "INDEPENDENT"],
                            "removed": False,
                            "removed_at": None,
                            "eci_last_synced_at": _utc_now_iso(),
                            "age": age,
                            "gender": gender or None,
                        }
                        payload = {k: payload.get(k) for k in eci_columns}

                        batch.append(payload)
                        if len(batch) >= 25:
                            unique = {item["id"]: item for item in batch}
                            _upsert("candidates", list(unique.values()), on_conflict="id")
                            batch = []

                    time.sleep(0.2)
                except Exception:
                    empty_streak += 1
                    if empty_streak >= max(1, ECI_EMPTY_STREAK_STOP):
                        break

                page_num += 1

            if batch:
                unique = {item["id"]: item for item in batch}
                _upsert("candidates", list(unique.values()), on_conflict="id")

            if drop_ids:
                _delete_ids("candidates", drop_ids)

            browser.close()
    except Exception as e:
        return {"prefix": prefix, "seen_ids": list(seen_ids), "error": f"eci_worker:{e}"}

    return {"prefix": prefix, "seen_ids": list(seen_ids), "error": None}


def run_parallel_dossier_sync(*, eci_cfgs: list[dict], myneta_cfgs: list[dict], headless_eci: bool, headless_myneta: bool, max_workers: int) -> None:
    """
    Run ECI for multiple states in parallel (processes). As each ECI state finishes,
    schedule MyNeta for that state (also Playwright) without waiting for other ECI states.
    """
    if not eci_cfgs:
        print("CRITICAL: No ECI states selected.", flush=True)
        return

    max_workers = max(1, min(int(max_workers or 1), 4))
    myneta_by_prefix = {c["prefix"]: c for c in (myneta_cfgs or [])}

    print(f"\n[+] Parallel sync: max_workers={max_workers} ECI_states={len(eci_cfgs)} MyNeta_states={len(myneta_by_prefix)}", flush=True)

    eci_futs = {}
    myneta_futs = {}

    with ProcessPoolExecutor(max_workers=max_workers) as ex:
        for cfg in eci_cfgs:
            eci_futs[ex.submit(_eci_worker_run, cfg, headless=headless_eci)] = cfg

        for fut in as_completed(list(eci_futs.keys())):
            cfg = eci_futs[fut]
            prefix = cfg.get("prefix")
            try:
                r = fut.result()
            except Exception as e:
                print(f"    [!] ECI {prefix}: {e}", flush=True)
                continue

            if r.get("error"):
                print(f"    [!] ECI {prefix}: {r.get('error')}", flush=True)
                continue

            seen_ids = set(r.get("seen_ids") or [])
            print(f"    [OK] ECI {prefix}: seen={len(seen_ids)}", flush=True)
            # Clean up duplicates from earlier ID schemes before marking removed or running MyNeta.
            try:
                dd = dedupe_candidates_in_db(prefixes=[prefix] if prefix else [])
                if dd.get("deleted"):
                    print(f"    [dedupe] {prefix}: deleted={dd.get('deleted')} groups={dd.get('groups')}", flush=True)
            except Exception as e:
                print(f"    [!] dedupe {prefix}: {e}", flush=True)
            try:
                mark_removed_candidates(prefix, seen_ids)
            except Exception as e:
                print(f"    [!] ECI {prefix}: mark_removed failed: {e}", flush=True)

            # Immediately schedule MyNeta for this prefix if configured.
            mcfg = myneta_by_prefix.get(prefix)
            if mcfg:
                myneta_futs[ex.submit(_myneta_worker_run, mcfg, headless=headless_myneta)] = prefix

        # Drain MyNeta tasks (with per-task timeout to prevent silent hangs).
        _MYNETA_TASK_TIMEOUT = int(os.getenv("MYNETA_TASK_TIMEOUT", "3600"))  # 1h per state
        if myneta_futs:
            print(f"\n[+] Waiting for MyNeta jobs (timeout={_MYNETA_TASK_TIMEOUT}s each)...", flush=True)
        for fut in as_completed(list(myneta_futs.keys())):
            prefix = myneta_futs[fut]
            try:
                r = fut.result(timeout=_MYNETA_TASK_TIMEOUT)
            except TimeoutError:
                print(f"    [!] MyNeta {prefix}: timed out after {_MYNETA_TASK_TIMEOUT}s — killing worker.", flush=True)
                fut.cancel()
                continue
            except Exception as e:
                print(f"    [!] MyNeta {prefix}: {e}", flush=True)
                continue
            if r.get("error"):
                print(f"    [!] MyNeta {prefix}: {r.get('error')}", flush=True)
            else:
                print(f"    [OK] MyNeta {prefix}: Enriched={r.get('merged')} Unresolved={r.get('unresolved')}", flush=True)

def mark_removed_candidates(prefix: str, seen_ids: set[str]) -> None:
    """
    Mark candidates as removed if they were previously present but not seen in the latest ECI scrape.
    """
    if not supabase:
        return
    if not seen_ids:
        return

    # fetch current candidates for this state prefix
    rows = sb_select(
        "candidates",
        "id",
        filters={"constituency_id": f"like.{prefix}-%", "removed": "eq.false"},
        limit=10000,
    )
    current_ids = {row["id"] for row in (rows or []) if row.get("id")}
    removed_ids = sorted(list(current_ids - seen_ids))
    if not removed_ids:
        return

    print(f"[!] Marking removed candidates for {prefix}: {len(removed_ids)}")
    now_iso = _utc_now_iso()
    for i in range(0, len(removed_ids), 50):
        chunk = removed_ids[i : i + 50]
        # Do not set nomination_status to "removed" — many DBs use a CHECK constraint
        # on nomination_status (ECI values only). The `removed` flag carries soft-delete.
        ids = ",".join(chunk)
        sb_update(
            "candidates",
            {
                "removed": True,
                "removed_at": now_iso,
                "eci_last_synced_at": now_iso,
            },
            filters={"id": f"in.({ids})"},
        )


# ----------------------------
# MYNETA ENRICH (Requests + profile parsing)
# ----------------------------
def _pick_myneta_summary_candidate_table(soup: BeautifulSoup) -> Tag | None:
    """
    MyNeta summary pages have multiple tables; the first is a 2-column HIGHLIGHTS block.
    Pick the table that actually lists candidates (links to candidate.php in column 2).
    """
    best_table = None
    best_hits = 0
    for table in soup.find_all("table"):
        hits = 0
        for tr in table.find_all("tr"):
            tds = tr.find_all(["td", "th"])
            if len(tds) < 6:
                continue
            link = tds[1].find("a") if len(tds) > 1 else None
            href = (link.get("href") or "") if link else ""
            if "candidate.php" in href and "candidate_id=" in href:
                hits += 1
        if hits > best_hits:
            best_hits = hits
            best_table = table
    return best_table


def fetch_myneta_summary_rows(pw_page, base: str, page: int) -> list[dict]:
    """
    Load MyNeta summary in a real browser — the candidate table is JS-rendered; raw HTTP has no rows.
    Returns list of {candidate_name, constituency_name, candidate_id, candidate_url, criminal_cases, education}
    """
    url = f"{base}index.php?action=summary&subAction=candidates_analyzed&sort=candidate&page={page}"
    pw_page.goto(url, wait_until="domcontentloaded", timeout=60000)
    try:
        pw_page.wait_for_selector('a[href*="candidate_id="]', timeout=30000)
    except Exception:
        pw_page.wait_for_timeout(5000)

    soup = BeautifulSoup(pw_page.content(), "html.parser")
    table = _pick_myneta_summary_candidate_table(soup)
    if not table:
        return []

    rows = []
    for tr in table.find_all("tr"):
        tds = tr.find_all(["td", "th"])
        # Sno | Candidate | Constituency | Party | Crime | Education | [Assets] | [Liabilities]
        if len(tds) < 6:
            continue

        cand_link = tds[1].find("a")
        if not cand_link or not cand_link.get("href"):
            continue
        href_raw = cand_link["href"]
        if "candidate.php" not in href_raw or "candidate_id=" not in href_raw:
            continue

        cand_name = tds[1].get_text(" ", strip=True)
        const_name = tds[2].get_text(" ", strip=True)
        criminal_raw = tds[4].get_text(" ", strip=True) if len(tds) > 4 else "0"
        edu_raw = tds[5].get_text(" ", strip=True) if len(tds) > 5 else ""

        candidate_url = href_raw if href_raw.startswith("http") else f"{base}{href_raw.lstrip('/')}"
        m = re.search(r"candidate_id=(\d+)", candidate_url)
        cand_id = m.group(1) if m else None

        try:
            criminal_cases = int(criminal_raw) if criminal_raw.strip().isdigit() else 0
        except Exception:
            criminal_cases = 0

        rows.append({
            "candidate_name": cand_name,
            "constituency_name": const_name,
            "myneta_candidate_id": cand_id,
            "myneta_url": candidate_url,
            "criminal_cases": criminal_cases,
            "education": edu_raw,
        })

    return rows


def _parse_myneta_profile_html(text: str) -> dict:
    """Extract assets / liabilities / education / crime from rendered candidate.php HTML."""
    soup = BeautifulSoup(text, "html.parser")
    assets_value = 0
    liabilities_value = 0

    assets_cell = soup.find(lambda tag: tag.name in ["td", "th"] and "assets:" in tag.get_text(" ", strip=True).lower())
    if assets_cell:
        tr = assets_cell.find_parent("tr")
        tds = tr.find_all("td") if tr else []
        if len(tds) >= 2:
            assets_value = clean_currency_to_int(tds[1].get_text(" ", strip=True))

    liab_cell = soup.find(lambda tag: tag.name in ["td", "th"] and "liabilities:" in tag.get_text(" ", strip=True).lower())
    if liab_cell:
        tr = liab_cell.find_parent("tr")
        tds = tr.find_all("td") if tr else []
        if len(tds) >= 2:
            liabilities_value = clean_currency_to_int(tds[1].get_text(" ", strip=True))

    # Education: keep it SHORT and local to the education section.
    education = ""
    m = re.search(
        r"Educational Details.*?Category:\s*([^\n<]+)",
        text,
        re.IGNORECASE | re.DOTALL,
    )
    if m:
        education = m.group(1).strip()
    if not education:
        m2 = re.search(r"\bCategory:\s*([^\n<]+)", text, re.IGNORECASE)
        if m2:
            education = m2.group(1).strip()
    # Guardrail: if something huge slips through, drop it.
    if education and len(education) > 120:
        education = education[:120].strip()

    criminal_cases = None
    m = re.search(r"Number of Criminal Cases:\s*(\d+)", text, re.IGNORECASE)
    if m:
        criminal_cases = int(m.group(1))
    elif re.search(r"\bNo criminal cases\b", text, re.IGNORECASE):
        criminal_cases = 0

    return {
        "assets_value": assets_value,
        "liabilities_value": liabilities_value,
        "education_detail": education,
        "criminal_cases": criminal_cases,
    }


def fetch_myneta_profile(candidate_url: str, pw_page) -> dict:
    """
    Profile pages are also JS-heavy; load with the same Playwright page used for summaries.
    """
    pw_page.goto(candidate_url, wait_until="domcontentloaded", timeout=60000)
    try:
        pw_page.wait_for_selector("td", timeout=20000)
    except Exception:
        pw_page.wait_for_timeout(3000)
    return _parse_myneta_profile_html(pw_page.content())


def _sanitize_education_blob(raw: str) -> str:
    """
    Some runs accidentally stored a full MyNeta HTML/text dump into candidates.education.
    Recover the short 'Category:' value if present; otherwise return empty string (so UI shows '-').
    """
    if not raw:
        return ""
    s = " ".join(str(raw).split())
    if not s:
        return ""
    # Prefer the education category value and stop before PAN/ITR/Criminal/Assets sections.
    m = re.search(
        r"Educational Details.*?Category:\s*(.+?)(?:Details of PAN|Details of Criminal Cases|Assets\s*&\s*Liabilities|Disclaimer:|$)",
        s,
        re.IGNORECASE,
    )
    if m:
        return " ".join(m.group(1).split()).strip()[:120]
    m2 = re.search(
        r"\bCategory:\s*(.+?)(?:Details of PAN|Details of Criminal Cases|Assets\s*&\s*Liabilities|Disclaimer:|$)",
        s,
        re.IGNORECASE,
    )
    if m2:
        return " ".join(m2.group(1).split()).strip()[:120]
    # If it's a huge blob without a category, drop it.
    if len(s) > 140:
        return ""
    return s[:120]


def cleanup_bad_education_fields(*, dry_run: bool = False) -> int:
    """
    Fix already-corrupted rows in Supabase where education contains full page dumps.
    Returns number of rows updated.
    """
    if not supabase:
        return 0

    print("\n[+] Cleanup: sanitizing corrupted candidates.education fields...", flush=True)
    updated = 0

    # PostgREST often caps to 1000 rows per request; paginate.
    print("    [..] Fetching candidates (id, education)...", flush=True)
    rows: list[dict] = []
    step = 1000
    start = 0
    hard_cap = 15000
    while start < hard_cap:
        batch = sb_select("candidates", "id,education", limit=step, offset=start)
        rows.extend(batch)
        if len(batch) < step:
            break
        start += step
    print(f"    [..] Loaded {len(rows)} candidate rows.", flush=True)
    bad = []
    for idx, r in enumerate(rows, start=1):
        edu = r.get("education") or ""
        s = str(edu)
        su = s.upper()
        looks_like_dump = (
            ("→" in s)
            or ("HOME" in su and "2026" in su)
            or ("DETAILS OF PAN" in su)
            or ("DATA READABILITY REPORT" in su)
            or (len(s) > 220)
        )
        if looks_like_dump:
            fixed = _sanitize_education_blob(s)
            if fixed != s:
                bad.append({"id": r["id"], "education": fixed})
        if idx % 2500 == 0:
            print(f"    [..] Scanned {idx}/{len(rows)} rows...", flush=True)

    if not bad:
        print("    [OK] No corrupted education fields detected.")
        return 0

    print(f"    [~] Detected {len(bad)} corrupted rows.", flush=True)
    if dry_run:
        print("    [dry-run] Not writing changes.")
        return 0

    # Update row-by-row to avoid accidental NULLing on strict schemas.
    for i, row in enumerate(bad, start=1):
        sb_update("candidates", {"education": row["education"]}, filters={"id": f"eq.{row['id']}"})
        updated += 1
        if i % 50 == 0:
            print(f"    [..] Updated {i}/{len(bad)} rows...", flush=True)

    print(f"    [OK] Updated {updated} rows.", flush=True)
    return updated


def enrich_candidates_from_myneta(*, headless: bool = True, myneta_configs: list[dict] | None = None) -> None:
    if not supabase:
        return
    configs = myneta_configs if myneta_configs is not None else MYNETA_CONFIG
    print("\n[+] MyNeta: enriching candidates (Playwright - summary + profiles are JS-rendered)...", flush=True)
    if _gemini_client:
        print(
            f"    [~] LLM fallback enabled (max {_LLM_MAX} calls, model={os.getenv('DOSSIER_LLM_MODEL', 'gemini-2.5-flash')})"
        )

    # fetch baseline mapping
    db_candidates = sb_select(
        "candidates",
        "id,name,constituency_id",
        filters={"removed": "eq.false"},
        limit=20000,
    )
    db_constituencies = sb_select("constituencies", "id,name,state", limit=4000)

    from playwright.sync_api import sync_playwright

    print(f"    [..] Launching Chromium (headless={headless})...", flush=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        ctx = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 900},
        )
        pw_page = ctx.new_page()

        for cfg in configs:
            state_name = cfg["name"]
            prefix = cfg["prefix"]
            base = cfg["base"]
            max_pages = min(int(cfg.get("pages") or MYNETA_HARD_PAGE_CAP), MYNETA_HARD_PAGE_CAP)

            state_db_consts = {c["id"]: c["name"] for c in db_constituencies if (c.get("id") or "").startswith(prefix)}
            state_db_cands = [c for c in db_candidates if (c.get("constituency_id") or "").startswith(prefix)]

            print(f"\n======================================", flush=True)
            print(f" MYNETA TARGET: {state_name.upper()} (auto pages; cap={max_pages})", flush=True)
            print(f"======================================", flush=True)

            merged = 0
            unresolved = 0

            page_no = 1
            empty_streak = 0
            while page_no <= max_pages:
                print(f" -> Summary page {page_no}", flush=True)
                try:
                    rows = fetch_myneta_summary_rows(pw_page, base, page_no)
                except Exception as e:
                    print(f"    [!] Failed summary page {page_no}: {e}")
                    empty_streak += 1
                    if empty_streak >= max(1, PAGINATION_EMPTY_STREAK_STOP):
                        print("    [END] Too many failed pages; stopping.")
                        break
                    continue

                if not rows:
                    print(f"    [END] 0 rows parsed on page {page_no} — stopping.", flush=True)
                    empty_streak += 1
                    if empty_streak >= max(1, PAGINATION_EMPTY_STREAK_STOP):
                        break
                    page_no += 1
                    continue
                empty_streak = 0

                for row in rows:
                    const_name_raw = row["constituency_name"]
                    cand_name_raw = row["candidate_name"]
                    mynet_url = row["myneta_url"]
                    mynet_cid = row["myneta_candidate_id"]

                    const_name_list = sorted(set(state_db_consts.values()))
                    matched_const_name = best_constituency_name_match(const_name_raw, const_name_list)
                    if not matched_const_name and _gemini_client:
                        li = _llm_pick_option("constituency", const_name_raw, const_name_list)
                        if li is not None:
                            matched_const_name = const_name_list[li]
                    if not matched_const_name:
                        unresolved += 1
                        continue

                    constituency_id = next((k for k, v in state_db_consts.items() if v == matched_const_name), None)
                    if not constituency_id:
                        unresolved += 1
                        continue
                    cands_in_const = [c for c in state_db_cands if c["constituency_id"] == constituency_id]
                    if not cands_in_const:
                        unresolved += 1
                        continue

                    cand_names_in_seat = [c["name"] for c in cands_in_const]
                    matched_cand_name = intelligent_match(cand_name_raw, cand_names_in_seat)
                    if not matched_cand_name:
                        best_c = None
                        best_s = 0.0
                        for c in cands_in_const:
                            s = name_similarity(cand_name_raw, c["name"])
                            if s > best_s:
                                best_s = s
                                best_c = c
                        if best_c is not None and best_s >= 0.82:
                            matched_cand_name = best_c["name"]
                    if not matched_cand_name and _gemini_client:
                        ci = _llm_pick_option("candidate", cand_name_raw, cand_names_in_seat)
                        if ci is not None:
                            matched_cand_name = cand_names_in_seat[ci]
                    if not matched_cand_name:
                        unresolved += 1
                        continue

                    target_cand = next((c for c in cands_in_const if c["name"] == matched_cand_name), None)
                    if not target_cand:
                        unresolved += 1
                        continue
                    target_cand_id = target_cand["id"]

                    try:
                        prof = fetch_myneta_profile(mynet_url, pw_page)
                    except Exception:
                        prof = {}

                    criminal_cases = prof.get("criminal_cases")
                    if criminal_cases is None:
                        criminal_cases = row.get("criminal_cases", 0)

                    education = prof.get("education_detail") or row.get("education") or ""

                    payload = {
                        "criminal_cases": criminal_cases,
                        "education": education,
                        "assets_value": prof.get("assets_value", 0),
                        "liabilities_value": prof.get("liabilities_value", 0),
                        "myneta_url": mynet_url,
                        "myneta_candidate_id": mynet_cid,
                        "myneta_last_synced_at": _utc_now_iso(),
                        "background": f"Data verified via ADR MyNeta. Candidate holds {prof.get('assets_value', 0)} INR in declared assets.",
                    }

                    sb_update("candidates", payload, filters={"id": f"eq.{target_cand_id}"})
                    merged += 1

                time.sleep(0.4)
                page_no += 1

            print(f"    [OK] Enriched: {merged} | Unresolved: {unresolved}", flush=True)

        ctx.close()
        browser.close()


def _myneta_worker_run(cfg: dict, *, headless: bool) -> dict:
    """
    Run MyNeta enrichment for ONE state config in an isolated process.
    This avoids Playwright thread-safety issues and speeds up total runtime.
    """
    # Child process: use REST client (no supabase python dependency).
    url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    anon = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    sr = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    key = sr or anon
    if not url or not key:
        return {"state": cfg.get("name"), "merged": 0, "unresolved": 0, "error": "missing_supabase_env"}

    rest = f"{url.rstrip('/')}/rest/v1"
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    def _req(method: str, table: str, *, params: dict | None = None, payload=None, extra_headers: dict | None = None):
        h = dict(headers)
        if extra_headers:
            h.update(extra_headers)
        r = requests.request(method, f"{rest}/{table}", headers=h, params=params or {}, json=payload, timeout=45)
        if r.status_code >= 400:
            raise RuntimeError(f"supabase_http_{r.status_code}: {r.text[:240]}")
        if r.text.strip() == "":
            return None
        try:
            return r.json()
        except Exception:
            return r.text

    def _select(table: str, select: str, *, filters: dict[str, str] | None = None, limit: int | None = None):
        p = {"select": select}
        if filters:
            p.update(filters)
        if limit is not None:
            p["limit"] = str(int(limit))
        out = _req("GET", table, params=p)
        return out if isinstance(out, list) else []

    def _update(table: str, payload: dict, *, filters: dict[str, str]):
        _req("PATCH", table, params=filters, payload=payload, extra_headers={"Prefer": "return=minimal"})

    prefix = cfg["prefix"]
    base = cfg["base"]
    max_pages = min(int(cfg.get("pages") or MYNETA_HARD_PAGE_CAP), MYNETA_HARD_PAGE_CAP)

    # Load only the minimum we need for this state.
    db_candidates = _select(
        "candidates",
        "id,name,constituency_id",
        filters={"removed": "eq.false", "constituency_id": f"like.{prefix}-%"},
        limit=20000,
    )
    db_constituencies = _select(
        "constituencies",
        "id,name,state",
        filters={"id": f"like.{prefix}-%"},
        limit=4000,
    )

    state_db_consts = {c["id"]: c["name"] for c in db_constituencies if (c.get("id") or "").startswith(prefix)}
    state_db_cands = [c for c in db_candidates if (c.get("constituency_id") or "").startswith(prefix)]

    merged = 0
    unresolved = 0

    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        ctx = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 900},
        )
        pw_page = ctx.new_page()

        page_no = 1
        empty_streak = 0
        net_retries = 0
        saw_any_rows = False
        last_good_page = 0  # tracks last page that returned rows (for reconnect verification)
        print(f"[MyNeta {prefix}] Starting pagination (base={base})", flush=True)
        while page_no <= max_pages:
            try:
                rows = fetch_myneta_summary_rows(pw_page, base, page_no)
            except Exception as e:
                if _is_net_error(e) and net_retries < 3:
                    net_retries += 1
                    print(f"[MyNeta {prefix}] Net error page {page_no}: {e}. Waiting for reconnect...", flush=True)
                    reconnected = wait_for_internet(tag=f"MyNeta {prefix}")
                    if not reconnected:
                        break
                    # Verify the last 3 successfully processed pages before continuing.
                    if last_good_page > 0:
                        verify_from = max(1, last_good_page - 2)
                        print(f"[MyNeta {prefix}] Verifying pages {verify_from}–{last_good_page} after reconnect...", flush=True)
                        for vp in range(verify_from, last_good_page + 1):
                            try:
                                vrows = fetch_myneta_summary_rows(pw_page, base, vp)
                                print(f"[MyNeta {prefix}]  page {vp}: {len(vrows)} rows OK", flush=True)
                            except Exception as ve:
                                print(f"[MyNeta {prefix}]  page {vp}: verify failed ({ve})", flush=True)
                    continue  # retry current page_no
                empty_streak += 1
                if empty_streak >= max(1, PAGINATION_EMPTY_STREAK_STOP):
                    break
                page_no += 1
                continue

            if not rows:
                empty_streak += 1
                if empty_streak >= max(1, PAGINATION_EMPTY_STREAK_STOP):
                    break
                page_no += 1
                continue

            saw_any_rows = True
            empty_streak = 0
            net_retries = 0
            last_good_page = page_no
            print(f"[MyNeta {prefix}] page {page_no}: {len(rows)} rows", flush=True)

            for row in rows:
                const_name_raw = row["constituency_name"]
                cand_name_raw = row["candidate_name"]
                mynet_url = row["myneta_url"]
                mynet_cid = row["myneta_candidate_id"]

                const_name_list = sorted(set(state_db_consts.values()))
                matched_const_name = best_constituency_name_match(const_name_raw, const_name_list)
                if not matched_const_name and _gemini_client:
                    li = _llm_pick_option("constituency", const_name_raw, const_name_list)
                    if li is not None:
                        matched_const_name = const_name_list[li]
                if not matched_const_name:
                    unresolved += 1
                    continue

                constituency_id = next((k for k, v in state_db_consts.items() if v == matched_const_name), None)
                if not constituency_id:
                    unresolved += 1
                    continue
                cands_in_const = [c for c in state_db_cands if c["constituency_id"] == constituency_id]
                if not cands_in_const:
                    unresolved += 1
                    continue

                cand_names_in_seat = [c["name"] for c in cands_in_const]
                matched_cand_name = intelligent_match(cand_name_raw, cand_names_in_seat)
                if not matched_cand_name:
                    best_c = None
                    best_s = 0.0
                    for c in cands_in_const:
                        s = name_similarity(cand_name_raw, c["name"])
                        if s > best_s:
                            best_s = s
                            best_c = c
                    if best_c is not None and best_s >= 0.82:
                        matched_cand_name = best_c["name"]
                if not matched_cand_name and _gemini_client:
                    ci = _llm_pick_option("candidate", cand_name_raw, cand_names_in_seat)
                    if ci is not None:
                        matched_cand_name = cand_names_in_seat[ci]
                if not matched_cand_name:
                    unresolved += 1
                    continue

                target_cand = next((c for c in cands_in_const if c["name"] == matched_cand_name), None)
                if not target_cand:
                    unresolved += 1
                    continue
                target_cand_id = target_cand["id"]

                try:
                    prof = fetch_myneta_profile(mynet_url, pw_page)
                except Exception:
                    prof = {}

                criminal_cases = prof.get("criminal_cases")
                if criminal_cases is None:
                    criminal_cases = row.get("criminal_cases", 0)

                education = prof.get("education_detail") or row.get("education") or ""

                payload = {
                    "criminal_cases": criminal_cases,
                    "education": education,
                    "assets_value": prof.get("assets_value", 0),
                    "liabilities_value": prof.get("liabilities_value", 0),
                    "myneta_url": mynet_url,
                    "myneta_candidate_id": mynet_cid,
                    "myneta_last_synced_at": _utc_now_iso(),
                    "background": f"Data verified via ADR MyNeta. Candidate holds {prof.get('assets_value', 0)} INR in declared assets.",
                }

                _update("candidates", payload, filters={"id": f"eq.{target_cand_id}"})
                merged += 1

            time.sleep(0.25)
            page_no += 1

        ctx.close()
        browser.close()

    if not saw_any_rows:
        return {"state": cfg.get("name"), "merged": 0, "unresolved": 0, "error": "myneta_no_rows_parsed"}

    return {"state": cfg.get("name"), "merged": merged, "unresolved": unresolved, "error": None}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Dossier pipeline: ECI affidavit scrape + MyNeta enrichment.",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--eci-only",
        action="store_true",
        help="Only scrape ECI and mark removed candidates (no MyNeta).",
    )
    mode.add_argument(
        "--myneta-only",
        action="store_true",
        help="Only run MyNeta enrichment (expects candidates already in Supabase).",
    )
    parser.add_argument(
        "--eci-headless",
        action="store_true",
        help="Run ECI Playwright in headless mode (default: visible browser).",
    )
    parser.add_argument(
        "--eci-workers",
        type=int,
        default=0,
        help="Parallel Playwright workers for ECI (processes). 0=auto (min(4, selected states)).",
    )
    parser.add_argument(
        "--myneta-visible",
        action="store_true",
        help="Show Chromium for MyNeta pages (default: headless).",
    )
    parser.add_argument(
        "--myneta-workers",
        type=int,
        default=1,
        help="Parallel workers for MyNeta enrichment (processes). Recommended: 1–3.",
    )
    parser.add_argument(
        "--cleanup-education",
        action="store_true",
        help="Sanitize corrupted candidates.education blobs in Supabase before running (safe).",
    )
    parser.add_argument(
        "--cleanup-dry-run",
        action="store_true",
        help="Detect corrupted education blobs but do not write changes (use with --cleanup-education).",
    )
    parser.add_argument(
        "--clear-duplicates",
        action="store_true",
        help=(
            "Remove duplicate candidate rows from the DB for the selected states "
            "(determined by constituency_id + normalised name + party) and exit. "
            "Safe: keeps the most enriched/recent copy."
        ),
    )
    parser.add_argument(
        "--nuke-candidates",
        action="store_true",
        help=(
            "Hard-delete ALL candidate rows for the selected states and exit. "
            "DESTRUCTIVE — you must re-run ECI scrape afterwards. "
            "Requires --states to be set (refuses to nuke everything)."
        ),
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Skip interactive confirmation prompts (use with --nuke-candidates).",
    )
    parser.add_argument(
        "--states",
        action="append",
        metavar="LIST",
        help="Limit to these states only (repeat flag and/or comma-separated). Matches name, prefix (e.g. KER), or ECI code (e.g. S11).",
    )
    args = parser.parse_args()

    if not supabase:
        print("CRITICAL: Supabase offline.")
        return

    state_tokens = _parse_states_cli(args.states)
    if state_tokens:
        _validate_state_tokens(state_tokens)
        print(f"[+] States filter: {', '.join(state_tokens)}", flush=True)

    # ── Utility modes: run and exit without touching the scrape pipeline ──────

    if args.clear_duplicates:
        if not state_tokens:
            print("[clear-duplicates] No --states specified; running across ALL states in ECI config.", flush=True)
            all_prefixes = [c["prefix"] for c in ECI_STATE_CONFIG]
        else:
            all_prefixes = [c["prefix"] for c in ECI_STATE_CONFIG if any(_config_matches_state_token(c, t) for t in state_tokens)]
        if not all_prefixes:
            print("[clear-duplicates] No matching state prefixes found.", flush=True)
            return
        print(f"[clear-duplicates] Scanning: {', '.join(all_prefixes)}", flush=True)
        result = dedupe_candidates_in_db(prefixes=all_prefixes)
        print(
            f"\n[clear-duplicates] Done — checked={result.get('checked')} "
            f"dup-groups={result.get('groups')} deleted={result.get('deleted')}",
            flush=True,
        )
        return

    if args.nuke_candidates:
        if not state_tokens:
            print(
                "CRITICAL: --nuke-candidates requires --states to avoid accidental full wipe.\n"
                "  Example: python dossier_ingestor.py --nuke-candidates --states TN,WB",
                flush=True,
            )
            return
        nuke_prefixes = [c["prefix"] for c in ECI_STATE_CONFIG if any(_config_matches_state_token(c, t) for t in state_tokens)]
        if not nuke_prefixes:
            print("[nuke-candidates] No matching state prefixes found.", flush=True)
            return
        if not args.yes:
            print(
                f"\n[nuke-candidates] ABOUT TO DELETE ALL candidates for: {', '.join(nuke_prefixes)}\n"
                "  This cannot be undone — you must re-run ECI scrape afterwards.\n"
                "  Type YES to confirm: ",
                end="",
                flush=True,
            )
            confirm = input().strip()
            if confirm != "YES":
                print("[nuke-candidates] Aborted.", flush=True)
                return
        result = nuke_candidates_in_db(prefixes=nuke_prefixes)
        print(f"\n[nuke-candidates] Done — deleted={result.get('deleted')}", flush=True)
        return

    if args.myneta_only:
        print("[mode] MyNeta enrichment only\n")
        myneta_cfgs = _filter_configs_by_states(MYNETA_CONFIG, state_tokens)
        if not myneta_cfgs:
            print(
                "CRITICAL: No MyNeta coverage for selected --states. "
                f"MyNeta is configured for: {', '.join(c['name'] for c in MYNETA_CONFIG)}.",
                flush=True,
            )
            return
        if args.cleanup_education:
            cleanup_bad_education_fields(dry_run=args.cleanup_dry_run)
        if int(args.myneta_workers or 1) <= 1:
            enrich_candidates_from_myneta(headless=not args.myneta_visible, myneta_configs=myneta_cfgs)
        else:
            workers = max(1, min(int(args.myneta_workers), 3))
            print(f"[+] MyNeta: running in parallel (workers={workers})", flush=True)
            cfgs = list(myneta_cfgs)
            results = []
            with ProcessPoolExecutor(max_workers=workers) as ex:
                futs = [ex.submit(_myneta_worker_run, cfg, headless=not args.myneta_visible) for cfg in cfgs]
                for fut in as_completed(futs):
                    results.append(fut.result())
                    r = results[-1]
                    if r.get("error"):
                        print(f"    [!] {r.get('state')}: {r.get('error')}", flush=True)
                    else:
                        print(f"    [OK] {r.get('state')}: Enriched={r.get('merged')} Unresolved={r.get('unresolved')}", flush=True)
        print("\n[OK] MYNETA SYNC COMPLETE.")
        return

    if args.eci_only:
        print("[mode] ECI scrape only\n", flush=True)
        db_constituencies = sb_select("constituencies", "id,name,state", limit=4000)
        if not db_constituencies:
            print("CRITICAL: constituencies table is empty.")
            return
        eci_cfgs = _filter_configs_by_states(ECI_STATE_CONFIG, state_tokens)
        seen_map = scrape_and_upsert_eci_candidates(
            db_constituencies, headless=args.eci_headless, state_configs=eci_cfgs
        )
        for state in eci_cfgs:
            prefix = state["prefix"]
            seen = seen_map.get(prefix, set())
            mark_removed_candidates(prefix, seen)
        print("\n[OK] ECI SYNC COMPLETE (--eci-only; skipped MyNeta).")
        return

    db_constituencies = sb_select("constituencies", "id,name,state", limit=4000)
    if not db_constituencies:
        print("CRITICAL: constituencies table is empty.")
        return

    eci_cfgs = _filter_configs_by_states(ECI_STATE_CONFIG, state_tokens)
    myneta_cfgs = _filter_configs_by_states(MYNETA_CONFIG, state_tokens)

    # User requirement: do not run TN then WB sequentially; parallelize per-state Playwright.
    auto_workers = min(4, len(eci_cfgs) if eci_cfgs else 1)
    eci_workers = int(args.eci_workers or 0)
    if eci_workers <= 0:
        eci_workers = auto_workers

    run_parallel_dossier_sync(
        eci_cfgs=eci_cfgs,
        myneta_cfgs=myneta_cfgs,
        headless_eci=bool(args.eci_headless),
        headless_myneta=not bool(args.myneta_visible),
        max_workers=min(4, max(1, eci_workers)),
    )

    print("\n[OK] FULL DOSSIER PIPELINE COMPLETE (ECI + MyNeta).")


if __name__ == "__main__":
    main()

