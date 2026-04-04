import time
import requests
from bs4 import BeautifulSoup
import json
import os
from google import genai
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables
env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
load_dotenv(dotenv_path=env_path)

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

gemini_client = genai.Client(api_key=GEMINI_API_KEY)

try:
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise ValueError("Supabase credentials missing.")
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
except Exception as e:
    print(f"CRITICAL: Supabase offline: {e}")
    supabase = None

# Target Constituencies
TARGET_CONSTITUENCIES =[
    {"id": "KER-016", "name": "Payyannur", "url": "https://myneta.info/Kerala2021/index.php?action=show_candidates&constituency_id=16"},
    {"id": "KER-098", "name": "Puthuppally", "url": "https://myneta.info/Kerala2021/index.php?action=show_candidates&constituency_id=98"},
]

def extract_candidates_via_llm(data_content, constituency_name, constituency_id):
    prompt = f"""
    You are an Election Data Extraction AI. I am providing you with the raw data/HTML of candidates for the {constituency_name} constituency.
    
    Extract the candidate data and return a pure JSON array of objects. 
    
    Rules:
    1. Include ALL candidates from recognized major parties (INC, BJP, CPIM, TMC, DMK, AIADMK, IUML, etc).
    2. ONLY include "IND" (Independent) candidates IF their total assets are greater than 1,000,000 (10 Lakhs) OR they have > 0 criminal cases. Ignore dummy independents.
    3. Calculate the total assets correctly (e.g., "Rs 3 Crore 50 Lakhs" = 35000000). Convert all wealth to a plain integer.
    
    JSON Format exactly like this (no markdown):[
      {{
        "name": "John Doe",
        "party": "INC",
        "education": "Graduate",
        "age": 45,
        "criminal_cases": 2,
        "assets_value": 37000000,
        "nomination_status": "eci_verified",
        "is_independent": false
      }}
    ]
    
    Raw Data:
    {data_content}
    """
    
    try:
        response = gemini_client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
        )
        text = response.text.strip()
        if text.startswith("```json"): text = text[7:-3].strip()
        elif text.startswith("```"): text = text[3:-3].strip()
        
        candidates = json.loads(text)
        return candidates
    except Exception as e:
        print(f"   ->[LLM Parsing Error]: {e}")
        return[]

def scrape_constituency(constituency):
    print(f"\n[+] Infiltrating Candidate Data for: {constituency['name']} ({constituency['id']})")
    
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        res = requests.get(constituency['url'], headers=headers, timeout=15)
        soup = BeautifulSoup(res.content, 'html.parser')
        
        # Smart Table Hunter: Find any table that contains the word "Party" and "Assets"
        tables = soup.find_all('table')
        candidate_table = None
        
        for table in tables:
            text = table.text.lower()
            if 'party' in text and ('assets' in text or 'criminal' in text):
                candidate_table = table
                break

        data_to_send = ""
        if candidate_table:
            data_to_send = str(candidate_table)
            print("   -> Candidate table isolated natively. Passing to Gemini...")
        else:
            # FALLBACK: If no table is found, strip all the junk code and send the raw text of the website!
            print("   -> [WARN] Exact table not found. Stripping HTML and feeding raw page text to Gemini...")
            for tag in soup(['script', 'style', 'nav', 'footer', 'svg', 'img']):
                tag.decompose()
            data_to_send = soup.get_text(separator=' | ', strip=True)[:40000] # Safe token limit
        
        candidates = extract_candidates_via_llm(data_to_send, constituency['name'], constituency['id'])
        
        if not candidates:
            print("   ->[ERROR] Gemini returned 0 candidates. Check page structure.")
            return
            
        print(f"   -> Gemini extracted {len(candidates)} viable candidates (filtered dummy Independents).")
        
        if not supabase: return

        for cand in candidates:
            # Generate a deterministic ID based on constituency and name
            clean_name = ''.join(e for e in cand['name'] if e.isalnum()).lower()[:10]
            cand_id = f"cand-{constituency['id'].lower()}-{clean_name}"
            
            payload = {
                "id": cand_id,
                "constituency_id": constituency['id'],
                "name": cand.get('name', 'Unknown'),
                "party": cand.get('party', 'IND'),
                "education": cand.get('education', 'Unknown'),
                "age": cand.get('age', 0),
                "criminal_cases": cand.get('criminal_cases', 0),
                "assets_value": cand.get('assets_value', 0),
                "nomination_status": cand.get('nomination_status', 'eci_verified'),
                "is_independent": cand.get('party', '').upper() in ['IND', 'INDEPENDENT']
            }

            # Check if exists
            existing = supabase.table("candidates").select("id").eq("id", cand_id).execute()

            if len(existing.data) > 0:
                supabase.table("candidates").update(payload).eq("id", cand_id).execute()
                print(f"      ~ Updated: {cand['name']} ({cand['party']})")
            else:
                supabase.table("candidates").insert(payload).execute()
                print(f"      + Inserted: {cand['name']} ({cand['party']})")

    except Exception as e:
        print(f"   -> [Scrape Error]: {e}")

if __name__ == "__main__":
    print("=== DHARMA-OSINT ECI/MyNeta Candidate Ingestor ===")
    if not supabase:
        print("CRITICAL: Supabase offline. Ensure .env is correct.")
        
    for c in TARGET_CONSTITUENCIES:
        scrape_constituency(c)
        time.sleep(2) # Be polite to servers
    
    print("\n[✓] Candidate Data Extraction Complete.")