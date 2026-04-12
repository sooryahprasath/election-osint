import argparse
import os
import re
import time
import json
import difflib
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime, timezone
from difflib import SequenceMatcher

import requests
from bs4 import BeautifulSoup, Tag
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright
from supabase import create_client, Client


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
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
except Exception as e:
    print(f"CRITICAL: Supabase offline: {e}")
    supabase = None

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
    {"name": "Kerala", "code": "S11", "prefix": "KER", "max_pages": 89},
    {"name": "Assam", "code": "S03", "prefix": "ASM", "max_pages": 73},
    {"name": "Puducherry", "code": "U07", "prefix": "PY", "max_pages": 30},
    {"name": "Tamil Nadu", "code": "S22", "prefix": "TN", "max_pages": 403},
    {"name": "West Bengal", "code": "S25", "prefix": "WB", "max_pages": 148},
]

MYNETA_CONFIG = [
    {"name": "Kerala", "prefix": "KER", "base": "https://myneta.info/Kerala2026/", "pages": 9},
    {"name": "Assam", "prefix": "ASM", "base": "https://myneta.info/Assam2026/", "pages": 8},
    {"name": "Puducherry", "prefix": "PY", "base": "https://myneta.info/Puducherry2026/", "pages": 3},
]


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

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        context = browser.new_context(viewport={"width": 1280, "height": 800})
        page = context.new_page()

        for state in configs:
            state_name = state["name"]
            state_code = state["code"]
            prefix = state["prefix"]
            max_pages = state["max_pages"]
            seen_by_prefix.setdefault(prefix, set())

            print(f"\n======================================")
            print(f" ECI TARGET: {state_name.upper()} (max pages {max_pages})")
            print(f"======================================")

            for page_num in range(1, max_pages + 1):
                url = f"{ECI_BASE_URL}/CandidateCustomFilter?electionType={ELECTION_HASH}&election={ELECTION_HASH}&states={state_code}&submitName=100&page={page_num}"
                print(f" -> Page {page_num}: {url}")
                try:
                    page.goto(url, wait_until="domcontentloaded", timeout=20000)
                    try:
                        page.wait_for_selector("table#data-tab", timeout=10000)
                    except Exception:
                        print("    [END] No table found; stopping pagination for this state.")
                        break

                    soup = BeautifulSoup(page.content(), "html.parser")
                    table = soup.find("table", id="data-tab")
                    if not table:
                        break
                    tbody = table.find("tbody")
                    rows = tbody.find_all("tr") if tbody else []

                    if not rows:
                        print("    [END] No rows; stopping.")
                        break

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

                        ledger_key = f"{c_id}_{clean_full_name(cand_name)}"
                        if ledger_key in processed_ledger:
                            continue
                        processed_ledger.add(ledger_key)

                        cand_id = f"cand-{c_id}-{cand_name.replace(' ', '').lower()[:8]}"
                        seen_by_prefix[prefix].add(cand_id)

                        full_source_url = ""
                        if source_url_rel:
                            full_source_url = source_url_rel if source_url_rel.startswith("http") else f"{ECI_BASE_URL}/{source_url_rel.lstrip('/')}"

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
                        }
                        if age is not None:
                            payload["age"] = age
                        if gender:
                            payload["gender"] = gender

                        batch.append(payload)

                        if len(batch) >= 25:
                            unique = {item["id"]: item for item in batch}
                            supabase.table("candidates").upsert(list(unique.values())).execute()
                            print(f"    [>>>] Upserted {len(unique)} candidates.")
                            batch = []

                    time.sleep(0.8)  # be polite
                except Exception as e:
                    print(f"    [!] ECI page failed: {e}")
                    break

        if batch:
            unique = {item["id"]: item for item in batch}
            supabase.table("candidates").upsert(list(unique.values())).execute()
            print(f"    [>>>] Upserted final batch {len(unique)} candidates.")

        browser.close()

    return seen_by_prefix


def mark_removed_candidates(prefix: str, seen_ids: set[str]) -> None:
    """
    Mark candidates as removed if they were previously present but not seen in the latest ECI scrape.
    """
    if not supabase:
        return
    if not seen_ids:
        return

    # fetch current candidates for this state prefix
    res = supabase.table("candidates").select("id").like("constituency_id", f"{prefix}-%").eq("removed", False).execute()
    current_ids = {row["id"] for row in (res.data or [])}
    removed_ids = sorted(list(current_ids - seen_ids))
    if not removed_ids:
        return

    print(f"[!] Marking removed candidates for {prefix}: {len(removed_ids)}")
    now_iso = _utc_now_iso()
    for i in range(0, len(removed_ids), 50):
        chunk = removed_ids[i : i + 50]
        # Do not set nomination_status to "removed" — many DBs use a CHECK constraint
        # on nomination_status (ECI values only). The `removed` flag carries soft-delete.
        supabase.table("candidates").update({
            "removed": True,
            "removed_at": now_iso,
            "eci_last_synced_at": now_iso,
        }).in_("id", chunk).execute()


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
        end = min(start + step - 1, hard_cap - 1)
        res = supabase.table("candidates").select("id, education").range(start, end).execute()
        batch = res.data or []
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
        supabase.table("candidates").update({"education": row["education"]}).eq("id", row["id"]).execute()
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
    cands_res = supabase.table("candidates").select("id, name, constituency_id").eq("removed", False).execute()
    db_candidates = cands_res.data or []
    const_res = supabase.table("constituencies").select("id, name, state").execute()
    db_constituencies = const_res.data or []

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
            pages = cfg["pages"]

            state_db_consts = {c["id"]: c["name"] for c in db_constituencies if (c.get("id") or "").startswith(prefix)}
            state_db_cands = [c for c in db_candidates if (c.get("constituency_id") or "").startswith(prefix)]

            print(f"\n======================================", flush=True)
            print(f" MYNETA TARGET: {state_name.upper()} (pages {pages})", flush=True)
            print(f"======================================", flush=True)

            merged = 0
            unresolved = 0

            for page in range(1, pages + 1):
                print(f" -> Summary page {page}/{pages}", flush=True)
                try:
                    rows = fetch_myneta_summary_rows(pw_page, base, page)
                except Exception as e:
                    print(f"    [!] Failed summary page {page}: {e}")
                    continue

                if not rows:
                    print(f"    [!] 0 rows parsed on page {page} — check MyNeta layout or network", flush=True)

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

                    supabase.table("candidates").update(payload).eq("id", target_cand_id).execute()
                    merged += 1

                time.sleep(0.4)

            print(f"    [OK] Enriched: {merged} | Unresolved: {unresolved}", flush=True)

        ctx.close()
        browser.close()


def _myneta_worker_run(cfg: dict, *, headless: bool) -> dict:
    """
    Run MyNeta enrichment for ONE state config in an isolated process.
    This avoids Playwright thread-safety issues and speeds up total runtime.
    """
    # Recreate Supabase client in the child process.
    url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    anon = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    sr = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    key = sr or anon
    if not url or not key:
        return {"state": cfg.get("name"), "merged": 0, "unresolved": 0, "error": "missing_supabase_env"}
    try:
        db: Client = create_client(url, key)
    except Exception as e:
        return {"state": cfg.get("name"), "merged": 0, "unresolved": 0, "error": f"supabase_init:{e}"}

    prefix = cfg["prefix"]
    base = cfg["base"]
    pages = int(cfg["pages"])

    # Load only the minimum we need for this state.
    cands_res = db.table("candidates").select("id, name, constituency_id").eq("removed", False).like("constituency_id", f"{prefix}-%").execute()
    db_candidates = cands_res.data or []
    const_res = db.table("constituencies").select("id, name, state").like("id", f"{prefix}-%").execute()
    db_constituencies = const_res.data or []

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

        for page in range(1, pages + 1):
            try:
                rows = fetch_myneta_summary_rows(pw_page, base, page)
            except Exception:
                continue

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

                db.table("candidates").update(payload).eq("id", target_cand_id).execute()
                merged += 1

            time.sleep(0.25)

        ctx.close()
        browser.close()

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

    c_res = supabase.table("constituencies").select("id, name, state").execute()
    db_constituencies = c_res.data or []
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

    if args.eci_only:
        print("\n[OK] ECI SYNC COMPLETE (--eci-only; skipped MyNeta).")
        return

    myneta_cfgs = _filter_configs_by_states(MYNETA_CONFIG, state_tokens)
    if not myneta_cfgs:
        print(
            "\n[~] Skipping MyNeta: no MyNeta configuration for selected --states "
            f"(MyNeta: {', '.join(c['name'] for c in MYNETA_CONFIG)}).",
            flush=True,
        )
        print("\n[OK] PIPELINE COMPLETE (ECI only for this selection).")
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
    print("\n[OK] FULL DOSSIER PIPELINE COMPLETE (ECI + MyNeta).")


if __name__ == "__main__":
    main()

