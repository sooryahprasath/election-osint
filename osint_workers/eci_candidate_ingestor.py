import time
import os
import difflib
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright
from dotenv import load_dotenv
from supabase import create_client, Client

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

def find_best_constituency_match(eci_state, eci_constituency, db_constituencies):
    """Uses robust lowercase Fuzzy String Matching."""
    state_constituencies =[c for c in db_constituencies if c['state'].lower() == eci_state.lower()]
    if not state_constituencies:
        return None
        
    db_names = [c['name'].lower() for c in state_constituencies]
    eci_c_clean = eci_constituency.lower().strip()
    
    # Cutoff lowered to 0.5 to catch wider spelling variations
    matches = difflib.get_close_matches(eci_c_clean, db_names, n=1, cutoff=0.5)
    
    if matches:
        best_match_name = matches[0]
        for c in state_constituencies:
            if c['name'].lower() == best_match_name:
                return c['id']
    return None

def fetch_eci_global_candidates(db_constituencies):
    print("\n[+] Initiating Global ECI Deep Scrape (190+ Pages)...")
    print("    [!] Deploying VISIBLE Playwright Browser. Do not close the window!\n")
    
    valid_candidates =[]
    rejected_count = 0
    total_processed = 0
    unmapped_count = 0

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(viewport={"width": 1280, "height": 800})
        page = context.new_page()

        page_num = 1
        max_pages = 200 

        while page_num <= max_pages:
            url = f"https://affidavit.eci.gov.in/CandidateCustomFilter?electionType={ELECTION_HASH}&election={ELECTION_HASH}&submitName=100&page={page_num}"
            print(f"\n -> Accessing Page {page_num}...")
            
            try:
                page.goto(url, wait_until="domcontentloaded")
                
                try:
                    page.wait_for_selector("h4.bg-blu", timeout=8000)
                except Exception:
                    print("   [END] No candidates found on this page. Pagination complete.")
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
                    
                    # 1. Extract Photo
                    img_tag = tds[0].find('img')
                    photo_url = img_tag['src'] if img_tag and 'src' in img_tag.attrs else ""
                    
                    # 2. Extract Details (ROBUST PARSING)
                    details_div = tds[1]
                    name_tag = details_div.find('h4')
                    cand_name = name_tag.text.strip() if name_tag else "Unknown"
                    
                    party, status, state_name, const_name = "", "", "", ""
                    for p_tag in details_div.find_all('p'):
                        # Using split(':')[-1] perfectly separates the key from the value regardless of spaces
                        text = p_tag.text.strip()
                        if "Party" in text: party = text.split(':')[-1].strip()
                        elif "Status" in text: status = text.split(':')[-1].strip().lower()
                        elif "State" in text: state_name = text.split(':')[-1].strip()
                        elif "Constituency" in text: const_name = text.split(':')[-1].strip()

                    # 3. Extract Source URL
                    source_url = ""
                    hover_lay = details_div.find('div', class_='hover-lay')
                    if hover_lay:
                        a_tag = hover_lay.find('a')
                        if a_tag and 'href' in a_tag.attrs:
                            source_url = a_tag['href']

                    if status not in['accepted', 'contesting']:
                        rejected_count += 1
                        continue
                    
                    # FUZZY TRANSLATION
                    c_id = find_best_constituency_match(state_name, const_name, db_constituencies)
                    
                    if not c_id:
                        print(f"      [?] UNMAPPED: {cand_name} | State: '{state_name}' | Const: '{const_name}'")
                        unmapped_count += 1
                        continue 
                        
                    cand_id = f"cand-{c_id}-{cand_name.replace(' ', '').lower()[:8]}"
                    
                    print(f"      [+] EXTRACTED: {cand_name} ({party}) -> {c_id}")
                    
                    valid_candidates.append({
                        "id": cand_id,
                        "constituency_id": c_id,
                        "name": cand_name.title(),
                        "party": party,
                        "photo_url": photo_url,
                        "source_url": source_url,
                        "nomination_status": "eci_verified",
                        "is_independent": party.upper() in["IND", "INDEPENDENT"]
                    })
                    
                    page_candidates_found += 1
                    total_processed += 1

                if page_candidates_found == 0:
                    print("   [!] No trackable candidates mapped on this page.")

                # Push in batches of 50
                if len(valid_candidates) >= 50:
                    if supabase:
                        unique_payload = {item['id']: item for item in valid_candidates}
                        supabase.table("candidates").upsert(list(unique_payload.values())).execute()
                        print(f"    [>>>] Pushed batch of {len(unique_payload)} candidates to Supabase.")
                    valid_candidates =[]

                page_num += 1
                time.sleep(0.5) 
                
            except Exception as e:
                print(f"[!] Failed on page {page_num}: {e}")
                break

        browser.close()

    # Final push
    if supabase and len(valid_candidates) > 0:
        unique_payload = {item['id']: item for item in valid_candidates}
        supabase.table("candidates").upsert(list(unique_payload.values())).execute()
        print(f"    [>>>] Pushed final batch of {len(unique_payload)} candidates to Supabase.")
        
    print("\n=== ECI SCRAPE COMPLETE ===")
    print(f"Total Verified Contesting Candidates Injected: {total_processed}")
    print(f"Total Candidates Ignored (Not in DB states): {unmapped_count}")
    print(f"Total Rejected/Withdrawn Ignored: {rejected_count}")

if __name__ == "__main__":
    print("=== DHARMA-OSINT: ECI Visible Browser Ingestor ===")
    
    if not supabase:
        print("CRITICAL: Supabase offline.")
        exit()
        
    c_res = supabase.table("constituencies").select("id, name, state").execute()
    db_constituencies = c_res.data
    
    if not db_constituencies:
        print("CRITICAL ERROR: Your 'constituencies' table is empty. The scraper cannot map candidates without it.")
        print("Run 'python osint_workers/bulk_seed_constituencies.py' first.")
    else:
        fetch_eci_global_candidates(db_constituencies)