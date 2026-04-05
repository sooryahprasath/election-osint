import time
import os
import difflib
import re
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright
from dotenv import load_dotenv
from supabase import create_client, Client

# --- SETUP & CONFIG ---
env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
load_dotenv(dotenv_path=env_path)

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")

try:
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise ValueError("Supabase credentials missing.")
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
except Exception:
    supabase = None

# --- STATE TARGETS (Scalable for future phases) ---
MYNETA_CONFIG = [
    {"name": "Kerala", "prefix": "KER", "url": "https://myneta.info/Kerala2026/index.php?action=summary&subAction=candidates_analyzed&sort=candidate&page=", "pages": 9},
    {"name": "Assam", "prefix": "ASM", "url": "https://myneta.info/Assam2026/index.php?action=summary&subAction=candidates_analyzed&sort=candidate&page=", "pages": 8},
    {"name": "Puducherry", "prefix": "PY", "url": "https://myneta.info/Puducherry2026/index.php?action=summary&subAction=candidates_analyzed&sort=candidate&page=", "pages": 3},
    # Future States: Just uncomment and update pages when live
    # {"name": "Tamil Nadu", "prefix": "TN", "url": "https://myneta.info/TamilNadu2026/index.php?action=summary&subAction=candidates_analyzed&sort=candidate&page=", "pages": 25},
    # {"name": "West Bengal", "prefix": "WB", "url": "https://myneta.info/WestBengal2026/index.php?action=summary&subAction=candidates_analyzed&sort=candidate&page=", "pages": 30}
]

def clean_currency(currency_str):
    """Surgically extracts the integer value from dirty DOM strings."""
    if not currency_str or "nil" in currency_str.lower() or currency_str.strip() == "":
        return 0
    try:
        raw_part = currency_str.split('~')[0].upper()
        clean_num = re.sub(r'[^\d]', '', raw_part)
        if clean_num == '': return 0
        return int(clean_num)
    except Exception:
        return 0

def clean_full_name(name):
    """Removes titles and standardizes the string."""
    name = name.lower()
    name = re.sub(r'\b(adv|dr|prof|mrs|mr|shri|smt)\b\.?', ' ', name)
    name = re.sub(r'\b[swd]/o\b.*$', ' ', name)
    name = re.sub(r'[^\w\s@]', ' ', name) # keep @ for alias checking
    name = re.sub(r'\b[a-z]\b', ' ', name) # remove single letters
    return " ".join(name.split())

def get_core_word(name):
    words = clean_full_name(name).split()
    if not words: return ""
    return max(words, key=len)

def calculate_token_overlap(name1, name2):
    """Checks what percentage of words they share."""
    set1 = set(name1.split())
    set2 = set(name2.split())
    if not set1 or not set2: return 0
    overlap = set1.intersection(set2)
    return len(overlap) / min(len(set1), len(set2))

def intelligent_match(target, options):
    """The 4-Tier OSINT Name Matcher."""
    target_clean = clean_full_name(target)
    options_clean = [clean_full_name(o) for o in options]
    
    # Tier 1: Alias Splitting
    target_aliases = [target_clean]
    if "alias" in target_clean or "@" in target_clean:
        target_aliases = re.split(r'\balias\b|@', target_clean)
        target_aliases = [a.strip() for a in target_aliases if len(a.strip()) > 3]

    for alias in target_aliases:
        # Tier 2: Token Overlap (The most accurate for Indian names)
        for idx, opt_clean in enumerate(options_clean):
            overlap_score = calculate_token_overlap(alias, opt_clean)
            if overlap_score >= 0.6: # If they share 60% of words (e.g. Subasri Tamilselvan)
                return options[idx]
                
        # Tier 3: Exact Core Word Match
        alias_core = get_core_word(alias)
        for idx, opt in enumerate(options):
            opt_core = get_core_word(opt)
            if alias_core and len(alias_core) > 4 and alias_core == opt_core:
                return options[idx]

    # Tier 4: Difflib Fallback
    matches = difflib.get_close_matches(target_clean, options_clean, n=1, cutoff=0.65)
    if matches:
        return options[options_clean.index(matches[0])]
        
    return None

def extract_assets_from_html(html_content):
    """
    Bulletproof whole-row DOM extractor. 
    Finds 'Assets', grabs the entire table row, and extracts the number.
    """
    soup = BeautifulSoup(html_content, 'html.parser')
    
    # Look for any tag containing the word Assets
    asset_tag = soup.find(lambda tag: tag.name in ['td', 'th', 'b', 'strong'] and 'assets' in tag.text.lower())
    if asset_tag:
        # Climb up to the parent Table Row
        row = asset_tag.find_parent('tr')
        if row:
            row_text = row.get_text(separator=' ')
            # Find the string chunk that looks like currency (e.g., Rs 5,89,46,404 ~)
            match = re.search(r'(?:Rs|₹)?\s*[\d,]+\s*(?:~|Lacs|Crore)?', row_text, re.IGNORECASE)
            if match:
                return clean_currency(match.group(0))
            return clean_currency(row_text) # Fallback to whole row
    return 0

def fetch_myneta_intel():
    print("\n[+] Initiating MyNeta OSINT Scrape (4-Tier Matcher & DOM Penetration)...")
    print("    [~] Fetching active candidates from Supabase...")
    
    res_cand = supabase.table("candidates").select("id, name, constituency_id").execute()
    db_candidates = res_cand.data
    
    res_const = supabase.table("constituencies").select("id, name, state").execute()
    db_constituencies = res_const.data

    if not db_candidates or not db_constituencies:
        print("CRITICAL ERROR: DB is empty.")
        return

    total_merged = 0
    unresolved_candidates = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        main_page = context.new_page()

        for config in MYNETA_CONFIG:
            state_name = config["name"]
            state_prefix = config["prefix"]
            base_state_url = config["url"].split('index.php')[0]
            
            print(f"\n======================================")
            print(f" TARGET: {state_name.upper()} ({config['pages']} Pages)")
            print(f"======================================")
            
            state_db_consts = {c['id']: c['name'] for c in db_constituencies if c['id'].startswith(state_prefix)}
            state_db_cands = [c for c in db_candidates if c['constituency_id'].startswith(state_prefix)]

            for page_num in range(1, config["pages"] + 1):
                target_url = f"{config['url']}{page_num}"
                print(f"\n -> Scanning {state_name} Main Page {page_num}...")
                
                try:
                    main_page.goto(target_url, wait_until="domcontentloaded", timeout=20000)
                    soup = BeautifulSoup(main_page.content(), 'html.parser')
                    
                    target_table = None
                    for t in soup.find_all('table', class_='w3-table'):
                        headers = [th.text.strip().lower() for th in t.find_all('th')]
                        if any('candidate' in h for h in headers) and any('constituency' in h for h in headers):
                            target_table = t
                            break
                            
                    if not target_table: continue
                        
                    rows = target_table.find_all('tr')[1:] 
                    
                    for row in rows:
                        tds = row.find_all('td')
                        if len(tds) < 7: continue
                        
                        cand_name_raw = tds[1].text.strip()
                        const_name_raw = tds[2].text.strip()
                        
                        link_tag = tds[1].find('a')
                        if not link_tag: continue
                        profile_href = link_tag['href']
                        profile_url = f"{base_state_url}{profile_href}"
                        
                        # --- 4-TIER MATCHING ---
                        matched_const_name = intelligent_match(const_name_raw, list(state_db_consts.values()))
                        if not matched_const_name:
                            continue
                            
                        c_id = next(k for k, v in state_db_consts.items() if v == matched_const_name)
                        cands_in_const = [c for c in state_db_cands if c['constituency_id'] == c_id]
                        
                        matched_cand_name = intelligent_match(cand_name_raw, [c['name'] for c in cands_in_const])
                        
                        if not matched_cand_name:
                            print(f"      [?] Mismatch in {matched_const_name}: MyNeta says '{cand_name_raw}'")
                            unresolved_candidates.append(f"Const: {matched_const_name} | MyNeta Cand: '{cand_name_raw}'")
                            continue
                            
                        target_cand_id = next(c['id'] for c in cands_in_const if c['name'] == matched_cand_name)
                        
                        # --- HYBRID EXTRACTION LOGIC ---
                        criminal_cases_raw = tds[4].text.strip()
                        education_raw = tds[5].text.strip()
                        assets_raw = str(tds[6]) 
                        
                        try:
                            criminal_cases = int(criminal_cases_raw)
                        except ValueError:
                            criminal_cases = 0

                        assets_value = 0
                        
                        if "img" not in assets_raw.lower():
                            assets_value = clean_currency(tds[6].text)
                            print(f"      [+] FAST-GRAB: {matched_cand_name} | Assets: {assets_value} | Cases: {criminal_cases}")
                            
                        else:
                            print(f"      [~] ENCRYPTED ASSETS: {matched_cand_name}. Initiating Deep Dive...")
                            
                            try:
                                profile_page = context.new_page()
                                profile_page.goto(profile_url, wait_until="domcontentloaded", timeout=15000)
                                profile_page.wait_for_timeout(1800) # Slightly longer wait for heavy pages
                                
                                # Use the bulletproof whole-row extractor
                                assets_value = extract_assets_from_html(profile_page.content())
                                
                                profile_page.close()
                                print(f"      [+] DECRYPTED: {matched_cand_name} | Assets: {assets_value} | Cases: {criminal_cases}")
                                
                            except Exception as e:
                                print(f"      [!] Deep dive failed for {matched_cand_name}: {str(e)[:50]}")
                                if 'profile_page' in locals() and not profile_page.is_closed():
                                    profile_page.close()
                        
                        # Execute Targeted Update (Now includes myneta_url)
                        payload = {
                            "criminal_cases": criminal_cases,
                            "education": education_raw,
                            "assets_value": assets_value,
                            "myneta_url": profile_url,
                            "background": f"Data verified via ADR MyNeta. Candidate holds {assets_value} INR in declared assets."
                        }
                        
                        supabase.table("candidates").update(payload).eq("id", target_cand_id).execute()
                        total_merged += 1
                            
                except Exception as e:
                    print(f"   [!] Error on main page {page_num}: {str(e)[:100]}")
                    
                time.sleep(0.5)

        browser.close()

    print("\n======================================")
    print("=== MYNETA INGESTION COMPLETE ===")
    print("======================================")
    print(f"Total Candidate Dossiers Safely Enriched: {total_merged}")
    
    if unresolved_candidates:
        print(f"\n[!] There are {len(unresolved_candidates)} candidates that require manual review.")
    else:
        print("\n[+] Perfect run. No unresolved candidates.")

if __name__ == "__main__":
    if not supabase:
        print("CRITICAL: Supabase offline or credentials missing.")
        exit()
    fetch_myneta_intel()