import os
import re
import time
import json
import difflib
from datetime import datetime, timezone

import requests
from bs4 import BeautifulSoup
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
    # {"name": "Tamil Nadu", "code": "S??", "prefix": "TN", "max_pages": ???},
    # {"name": "West Bengal", "code": "S??", "prefix": "WB", "max_pages": ???},
]

MYNETA_CONFIG = [
    {"name": "Kerala", "prefix": "KER", "base": "https://myneta.info/Kerala2026/", "pages": 9},
    {"name": "Assam", "prefix": "ASM", "base": "https://myneta.info/Assam2026/", "pages": 8},
    {"name": "Puducherry", "prefix": "PY", "base": "https://myneta.info/Puducherry2026/", "pages": 3},
]


# ----------------------------
# MATCHING HELPERS
# ----------------------------
def clean_full_name(name: str) -> str:
    name = (name or "").lower()
    name = re.sub(r"\b(adv|dr|prof|mrs|mr|shri|smt)\b\.?", " ", name)
    name = re.sub(r"\b[swd]/o\b.*$", " ", name)
    name = re.sub(r"[^\w\s@]", " ", name)  # keep @ for alias checking
    name = re.sub(r"\b[a-z]\b", " ", name)
    return " ".join(name.split())

def get_core_word(name: str) -> str:
    words = clean_full_name(name).split()
    return max(words, key=len) if words else ""

def calculate_token_overlap(name1: str, name2: str) -> float:
    set1 = set(clean_full_name(name1).split())
    set2 = set(clean_full_name(name2).split())
    if not set1 or not set2:
        return 0.0
    overlap = set1.intersection(set2)
    return len(overlap) / min(len(set1), len(set2))

def intelligent_match(target: str, options: list[str]) -> str | None:
    target_clean = clean_full_name(target)
    options_clean = [clean_full_name(o) for o in options]

    target_aliases = [target_clean]
    if "alias" in target_clean or "@" in target_clean:
        target_aliases = re.split(r"\balias\b|@", target_clean)
        target_aliases = [a.strip() for a in target_aliases if len(a.strip()) > 3]

    for alias in target_aliases:
        # Tier 1: token overlap
        for idx, opt_clean in enumerate(options_clean):
            if calculate_token_overlap(alias, opt_clean) >= 0.6:
                return options[idx]

        # Tier 2: core word
        alias_core = get_core_word(alias)
        if alias_core and len(alias_core) > 4:
            for idx, opt in enumerate(options):
                if get_core_word(opt) == alias_core:
                    return options[idx]

    # Tier 3: difflib
    matches = difflib.get_close_matches(target_clean, options_clean, n=1, cutoff=0.65)
    if matches:
        return options[options_clean.index(matches[0])]
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
    # keep digits only (handles "Rs 3,14,54,433 ~3 Crore+")
    digits = re.sub(r"[^\d]", "", s)
    return int(digits) if digits else 0


# ----------------------------
# ECI SCRAPER (Playwright)
# ----------------------------
def find_best_constituency_match(eci_state: str, eci_constituency: str, db_constituencies: list[dict]) -> str | None:
    state_constituencies = [c for c in db_constituencies if (c.get("state") or "").lower() == (eci_state or "").lower()]
    if not state_constituencies:
        return None
    db_names = [c["name"].lower() for c in state_constituencies if c.get("name")]
    eci_c_clean = (eci_constituency or "").lower().strip()
    matches = difflib.get_close_matches(eci_c_clean, db_names, n=1, cutoff=0.5)
    if matches:
        best = matches[0]
        for c in state_constituencies:
            if (c.get("name") or "").lower() == best:
                return c.get("id")
    return None


def scrape_and_upsert_eci_candidates(db_constituencies: list[dict], headless: bool = False) -> dict[str, set[str]]:
    """
    Scrape ECI per-state and upsert candidates.
    Returns: mapping {state_prefix: set(candidate_ids_seen_in_eci)}
    """
    seen_by_prefix: dict[str, set[str]] = {}
    if not supabase:
        return seen_by_prefix

    print("\n[+] ECI: scraping contesting/accepted candidates...")
    print("    [!] Playwright will open a browser window." if not headless else "    [~] Running headless.")

    processed_ledger = set()  # (constituency_id, candidate_name_clean)
    batch: list[dict] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        context = browser.new_context(viewport={"width": 1280, "height": 800})
        page = context.new_page()

        for state in ECI_STATE_CONFIG:
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
def fetch_myneta_summary_rows(base: str, page: int) -> list[dict]:
    """
    Returns list of {candidate_name, constituency_name, candidate_id, candidate_url, criminal_cases, education}
    """
    url = f"{base}index.php?action=summary&subAction=candidates_analyzed&sort=candidate&page={page}"
    r = requests.get(url, timeout=25, headers={"User-Agent": "Mozilla/5.0"})
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    table = soup.find("table")
    if not table:
        return []

    rows = []
    for tr in table.find_all("tr"):
        tds = tr.find_all(["td", "th"])
        if len(tds) < 7:
            continue
        # skip header row
        if tds[0].name == "th":
            continue

        cand_link = tds[1].find("a")
        if not cand_link or not cand_link.get("href"):
            continue

        cand_name = tds[1].get_text(" ", strip=True)
        const_name = tds[2].get_text(" ", strip=True)
        criminal_raw = tds[4].get_text(" ", strip=True)
        edu_raw = tds[5].get_text(" ", strip=True)

        href = cand_link["href"]
        candidate_url = href if href.startswith("http") else f"{base}{href.lstrip('/')}"
        m = re.search(r"candidate_id=(\d+)", candidate_url)
        cand_id = m.group(1) if m else None

        try:
            criminal_cases = int(criminal_raw) if criminal_raw.isdigit() else 0
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


def fetch_myneta_profile(candidate_url: str) -> dict:
    """
    Parse candidate.php profile page for assets/liabilities and better education/crime.
    This avoids the 'assets as image' issue in summary tables.
    """
    r = requests.get(candidate_url, timeout=25, headers={"User-Agent": "Mozilla/5.0"})
    r.raise_for_status()
    text = r.text
    soup = BeautifulSoup(text, "html.parser")

    # Assets & Liabilities appear as a small 2-row table "Assets:" / "Liabilities:"
    assets_value = 0
    liabilities_value = 0

    # Find the first table row that contains "Assets:"
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

    # Education block: "Category: ..."
    education = ""
    edu_h = soup.find(lambda tag: tag.name in ["h3", "h4", "h5", "h6"] and "educational details" in tag.get_text(" ", strip=True).lower())
    if edu_h:
        # next text containing "Category:"
        cat = soup.find(lambda tag: tag.name in ["p", "div"] and "category:" in tag.get_text(" ", strip=True).lower())
        if cat:
            education = cat.get_text(" ", strip=True)
    if not education:
        # fallback: search raw html
        m = re.search(r"Category:\s*([^<\n]+)", text, re.IGNORECASE)
        if m:
            education = m.group(0).strip()

    # Crime cases: "Number of Criminal Cases: X" or "No criminal cases"
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


def enrich_candidates_from_myneta() -> None:
    if not supabase:
        return
    print("\n[+] MyNeta: enriching candidates (profile-based extraction)...")

    # fetch baseline mapping
    cands_res = supabase.table("candidates").select("id, name, constituency_id").eq("removed", False).execute()
    db_candidates = cands_res.data or []
    const_res = supabase.table("constituencies").select("id, name, state").execute()
    db_constituencies = const_res.data or []

    for cfg in MYNETA_CONFIG:
        state_name = cfg["name"]
        prefix = cfg["prefix"]
        base = cfg["base"]
        pages = cfg["pages"]

        state_db_consts = {c["id"]: c["name"] for c in db_constituencies if (c.get("id") or "").startswith(prefix)}
        state_db_cands = [c for c in db_candidates if (c.get("constituency_id") or "").startswith(prefix)]

        print(f"\n======================================")
        print(f" MYNETA TARGET: {state_name.upper()} (pages {pages})")
        print(f"======================================")

        merged = 0
        unresolved = 0

        for page in range(1, pages + 1):
            print(f" -> Summary page {page}/{pages}")
            try:
                rows = fetch_myneta_summary_rows(base, page)
            except Exception as e:
                print(f"    [!] Failed summary page {page}: {e}")
                continue

            for row in rows:
                const_name_raw = row["constituency_name"]
                cand_name_raw = row["candidate_name"]
                mynet_url = row["myneta_url"]
                mynet_cid = row["myneta_candidate_id"]

                matched_const_name = intelligent_match(const_name_raw, list(state_db_consts.values()))
                if not matched_const_name:
                    unresolved += 1
                    continue

                constituency_id = next(k for k, v in state_db_consts.items() if v == matched_const_name)
                cands_in_const = [c for c in state_db_cands if c["constituency_id"] == constituency_id]
                if not cands_in_const:
                    unresolved += 1
                    continue

                matched_cand_name = intelligent_match(cand_name_raw, [c["name"] for c in cands_in_const])
                if not matched_cand_name:
                    unresolved += 1
                    continue

                target_cand_id = next(c["id"] for c in cands_in_const if c["name"] == matched_cand_name)

                # always parse profile page for assets/liabilities (fixes image/JS cases)
                try:
                    prof = fetch_myneta_profile(mynet_url)
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

        print(f"    [✓] Enriched: {merged} | Unresolved: {unresolved}")


def main():
    if not supabase:
        print("CRITICAL: Supabase offline.")
        return

    # load constituencies
    c_res = supabase.table("constituencies").select("id, name, state").execute()
    db_constituencies = c_res.data or []
    if not db_constituencies:
        print("CRITICAL: constituencies table is empty.")
        return

    seen_map = scrape_and_upsert_eci_candidates(db_constituencies, headless=False)
    for state in ECI_STATE_CONFIG:
        prefix = state["prefix"]
        seen = seen_map.get(prefix, set())
        mark_removed_candidates(prefix, seen)

    enrich_candidates_from_myneta()
    print("\n[✓] DOSSIER PIPELINE COMPLETE.")


if __name__ == "__main__":
    main()

