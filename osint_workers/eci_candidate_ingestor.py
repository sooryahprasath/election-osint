import time
import os
import difflib
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

BASE_URL = "https://affidavit.eci.gov.in"
ELECTION_HASH = "32-AC-GENERAL-3-60" 

# Deeper State-Wise Filters
STATE_CONFIG = [
    {"name": "Kerala", "code": "S11", "max_pages": 89},
    {"name": "Assam", "code": "S03", "max_pages": 73},
    {"name": "Puducherry", "code": "U07", "max_pages": 30}
]

def find_best_constituency_match(eci_state, eci_constituency, db_constituencies):
    """Uses robust lowercase Fuzzy String Matching."""
    state_constituencies = [c for c in db_constituencies if c['state'].lower() == eci_state.lower()]
    if not state_constituencies:
        return None
        
    db_names = [c['name'].lower() for c in state_constituencies]
    eci_c_clean = eci_constituency.lower().strip()
    
    matches = difflib.get_close_matches(eci_c_clean, db_names, n=1, cutoff=0.5)
    
    if matches:
        best_match_name = matches[0]
        for c in state_constituencies:
            if c['name'].lower() == best_match_name:
                return c['id']
    return None

def fetch_eci_global_candidates(db_constituencies):
    print("\n[+] Initiating STATE-TARGETED ONE-PASS ECI Deep Scrape...")
    print("    [!] Deploying VISIBLE Playwright Browser. Do not close the window!\n")
    
    valid_candidates = []
    rejected_count = 0
    total_processed = 0
    unmapped_count = 0
    duplicate_count = 0
    
    # Ledger to track (constituency_id, candidate_name_lowercase)
    # This prevents processing duplicate applications for the same person
    processed_cands_ledger = set()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(viewport={"width": 1280, "height": 800})
        page = context.new_page()

        for state in STATE_CONFIG:
            state_name = state["name"]
            state_code = state["code"]
            max_pages = state["max_pages"]
            
            print(f"\n======================================")
            print(f" TARGETING: {state_name.upper()} (Max Pages: {max_pages})")
            print(f"======================================")

            for page_num in range(1, max_pages + 1):
                # Using the targeted state filter URL
                url = f"{BASE_URL}/CandidateCustomFilter?electionType={ELECTION_HASH}&election={ELECTION_HASH}&states={state_code}&submitName=100&page={page_num}"
                print(f"\n -> Accessing {state_name} Page {page_num}...")
                
                try:
                    page.goto(url, wait_until="domcontentloaded", timeout=15000)
                    
                    try:
                        page.wait_for_selector("h4.bg-blu", timeout=8000)
                    except Exception:
                        print(f"   [END] No candidates found on {state_name} page {page_num}. Pagination complete for this state.")
                        break
                    
                    html_content = page.content()
                    soup = BeautifulSoup(html_content, 'html.parser')
                    
                    table = soup.find('table', id='data-tab')
                    if not table: break
                    
                    tbody = table.find('tbody')
                    rows = tbody.find_all('tr')
                    page_candidates_found = 0

                    for row in rows:
                        tds = row.find_all('td')
                        if len(tds) < 2: continue
                        
                        # 1. Extract Basic Details & Photo
                        img_tag = tds[0].find('img')
                        photo_url = img_tag['src'] if img_tag and 'src' in img_tag.attrs else ""
                        
                        details_div = tds[1]
                        name_tag = details_div.find('h4')
                        cand_name = name_tag.text.strip() if name_tag else "Unknown"
                        
                        party, status, extracted_state_name, const_name = "", "", "", ""
                        for p_tag in details_div.find_all('p'):
                            text = p_tag.text.strip()
                            if "Party" in text: party = text.split(':')[-1].strip()
                            elif "Status" in text: status = text.split(':')[-1].strip().lower()
                            elif "State" in text: extracted_state_name = text.split(':')[-1].strip()
                            elif "Constituency" in text: const_name = text.split(':')[-1].strip()

                        # Only process accepted/contesting candidates (Filters out rejected applications immediately)
                        if status not in ['accepted', 'contesting']:
                            rejected_count += 1
                            continue

                        # 2. Map Constituency
                        # We use the state_name from our config, not the extracted one, to ensure perfect mapping
                        c_id = find_best_constituency_match(state_name, const_name, db_constituencies)
                        if not c_id:
                            print(f"      [?] UNMAPPED: {cand_name} | Const: '{const_name}'")
                            unmapped_count += 1
                            continue 
                            
                        # --- DUPLICATE CHECK ---
                        # Prevent processing multiple accepted applications for the same candidate in the same constituency
                        ledger_key = f"{c_id}_{cand_name.lower().strip()}"
                        if ledger_key in processed_cands_ledger:
                            print(f"      [Skip] DUPLICATE DETECTED: {cand_name} in {const_name}")
                            duplicate_count += 1
                            continue
                        
                        # Add to ledger so we don't process them again
                        processed_cands_ledger.add(ledger_key)
                            
                        cand_id = f"cand-{c_id}-{cand_name.replace(' ', '').lower()[:8]}"
                        
                        # 3. Extract Source URL
                        source_url = ""
                        hover_lay = details_div.find('div', class_='hover-lay')
                        if hover_lay:
                            a_tag = hover_lay.find('a')
                            if a_tag and 'href' in a_tag.attrs:
                                source_url = a_tag['href']

                        # 4. ONE-PASS DEEP LINK SCRAPING (Age & Gender)
                        age = None
                        gender = None
                        
                        if source_url:
                            full_source_url = source_url if source_url.startswith("http") else BASE_URL + "/" + source_url.lstrip("/")
                            
                            print(f"      [~] Deep diving dossier for {cand_name}...")
                            try:
                                profile_page = context.new_page()
                                profile_page.goto(full_source_url, wait_until="domcontentloaded", timeout=10000)
                                profile_soup = BeautifulSoup(profile_page.content(), 'html.parser')
                                
                                # Parse Age
                                age_tag = profile_soup.find(lambda tag: tag.name == "p" and "Age:" in tag.text)
                                if age_tag:
                                    age_val = age_tag.find_parent('label').find_next_sibling('div').text.strip()
                                    if age_val.isdigit(): age = int(age_val)
                                
                                # Parse Gender
                                gender_tag = profile_soup.find(lambda tag: tag.name == "p" and "Gender:" in tag.text)
                                if gender_tag:
                                    gender = gender_tag.find_parent('label').find_next_sibling('div').text.strip().lower()

                                profile_page.close()
                            except Exception as e:
                                print(f"      [!] Deep dive failed for {cand_name}: Timeout or Error")
                                if 'profile_page' in locals() and not profile_page.is_closed():
                                    profile_page.close()

                        print(f"      [+] EXTRACTED: {cand_name} | Age: {age or 'N/A'} | Gender: {gender or 'N/A'}")
                        
                        # Build the payload 
                        candidate_payload = {
                            "id": cand_id,
                            "constituency_id": c_id,
                            "name": cand_name.title(),
                            "party": party,
                            "photo_url": photo_url,
                            "source_url": full_source_url if source_url else "",
                            "nomination_status": "eci_verified",
                            "is_independent": party.upper() in ["IND", "INDEPENDENT"]
                        }
                        
                        if age is not None:
                            candidate_payload["age"] = age
                        if gender:
                            candidate_payload["gender"] = gender

                        valid_candidates.append(candidate_payload)
                        page_candidates_found += 1
                        total_processed += 1

                    if page_candidates_found == 0:
                        print("   [!] No trackable candidates mapped on this page.")

                    # Push in smaller batches
                    if len(valid_candidates) >= 10:
                        if supabase:
                            unique_payload = {item['id']: item for item in valid_candidates}
                            supabase.table("candidates").upsert(list(unique_payload.values())).execute()
                            print(f"    [>>>] Merged batch of {len(unique_payload)} dossiers to Supabase.")
                        valid_candidates = []

                    time.sleep(1) # Be polite to the ECI servers
                    
                except Exception as e:
                    print(f"[!] Failed on {state_name} page {page_num}: {e}")
                    break

        browser.close()

    # Final push for any remaining candidates globally
    if supabase and len(valid_candidates) > 0:
        unique_payload = {item['id']: item for item in valid_candidates}
        supabase.table("candidates").upsert(list(unique_payload.values())).execute()
        print(f"    [>>>] Merged final global batch of {len(unique_payload)} dossiers to Supabase.")
        
    print("\n======================================")
    print("=== ECI SCRAPE COMPLETE ===")
    print("======================================")
    print(f"Total Verified Contesting Candidates Injected: {total_processed}")
    print(f"Duplicates Skipped: {duplicate_count}")
    print(f"Total Rejected/Withdrawn Ignored: {rejected_count}")
    print(f"Total Candidates Ignored (Unmapped): {unmapped_count}")

if __name__ == "__main__":
    print("=== DHARMA-OSINT: State-Targeted ECI Ingestor ===")
    
    if not supabase:
        print("CRITICAL: Supabase offline.")
        exit()
        
    c_res = supabase.table("constituencies").select("id, name, state").execute()
    db_constituencies = c_res.data
    
    if not db_constituencies:
        print("CRITICAL ERROR: Your 'constituencies' table is empty.")
    else:
        fetch_eci_global_candidates(db_constituencies)