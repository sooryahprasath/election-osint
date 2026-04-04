import os
import time
import requests
from bs4 import BeautifulSoup
import json
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

WIKI_SOURCES = {
    "Kerala": "https://en.wikipedia.org/wiki/List_of_constituencies_of_the_Kerala_Legislative_Assembly",
    "Assam": "https://en.wikipedia.org/wiki/List_of_constituencies_of_the_Assam_Legislative_Assembly",
    "Puducherry": "https://en.wikipedia.org/wiki/List_of_constituencies_of_the_Puducherry_Legislative_Assembly",
    "Tamil Nadu": "https://en.wikipedia.org/wiki/List_of_constituencies_of_the_Tamil_Nadu_Legislative_Assembly",
    "West Bengal": "https://en.wikipedia.org/wiki/List_of_constituencies_of_the_West_Bengal_Legislative_Assembly"
}

def extract_and_geocode_via_ai(state, html_content):
    prompt = f"""
    You are an expert Election OSINT data extractor and GIS mapping engine.
    I am providing you with the HTML tables scraped from the Wikipedia page for the {state} Legislative Assembly.

    Task 1: Extract ONLY the CURRENT, ACTIVE assembly constituencies. 
    **CRITICAL FOR ASSAM:** Ignore any historical or pre-2023 defunct tables. Only extract the post-delimitation table. EVERY `ac_no` MUST BE UNIQUE.
    Task 2: Handle rowspans/merged cells carefully so every constituency gets the correct District.
    Task 3: Use your internal geographic knowledge to estimate the exact GPS Latitude and Longitude for the central town of each constituency.
    
    Return ONLY a pure JSON array of objects. Do not wrap it in markdown. Do not include any explanations.
    
    Format EXACTLY like this:[
      {{
        "ac_no": 1,
        "name": "Constituency Name",
        "district": "District Name",
        "reservation": "GEN",
        "electorate": 200000,
        "latitude": 12.3456,
        "longitude": 78.9101
      }}
    ]

    Data:
    {html_content}
    """

    try:
        response = gemini_client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
        )
        
        text = response.text.strip()
        if text.startswith("```json"): text = text[7:-3].strip()
        elif text.startswith("```"): text = text[3:-3].strip()
        
        return json.loads(text)
    except Exception as e:
        print(f"   -> [LLM/JSON Error]: {e}")
        return[]

def build_database():
    print("=== DHARMA-OSINT: AI-Native Wikipedia & Geocoding Pipeline ===")
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }

    for state, url in WIKI_SOURCES.items():
        print(f"\n[+] Extracting {state}...")
        
        res = requests.get(url, headers=headers)
        if res.status_code != 200:
            print(f"   -> [ERROR] Wikipedia blocked the request (Status: {res.status_code})")
            continue

        soup = BeautifulSoup(res.text, 'html.parser')
        
        tables = soup.find_all('table', class_='wikitable')
        valid_tables = ""
        
        for table in tables:
            text_check = table.text.lower()
            if 'constituency' in text_check or 'district' in text_check or 'elector' in text_check:
                for tag in table.find_all(['a', 'sup', 'span', 'style']):
                    tag.unwrap()
                valid_tables += str(table)

        if not valid_tables:
            print(f"   -> [ERROR] No relevant constituency wikitables found for {state}")
            continue
            
        print("    -> Transmitting table matrix to Gemini for geospatial parsing...")
        
        ac_list = extract_and_geocode_via_ai(state, valid_tables)
        
        if not ac_list:
            print("    -> [FAILED] Could not extract data. Skipping state.")
            continue
            
        print(f"    -> Gemini extracted and mapped {len(ac_list)} seats. Sanitizing data...")

        batch_payload =[]
        prefix = "KER" if state == "Kerala" else "ASM" if state == "Assam" else "TN" if state == "Tamil Nadu" else "WB" if state == "West Bengal" else "PY"
        phase = 1 if state in["Kerala", "Assam", "Puducherry"] else 2
        poll_date = "2026-04-09" if phase == 1 else "2026-04-23"

        for ac in ac_list:
            try:
                electorate_val = int(str(ac.get('electorate', 0)).replace(',', ''))
            except:
                electorate_val = 0
                
            ac_id = f"{prefix}-{str(ac.get('ac_no', 0)).zfill(3)}"
            
            batch_payload.append({
                "id": ac_id,
                "name": str(ac.get('name', 'Unknown')).strip(),
                "state": state,
                "constituency_number": int(ac.get('ac_no', 0)),
                "phase": phase,
                "polling_date": poll_date,
                "latitude": float(ac.get('latitude', 0.0)),
                "longitude": float(ac.get('longitude', 0.0)),
                "district": str(ac.get('district', 'Unknown')).strip(),
                "reservation": str(ac.get('reservation', 'GEN')).strip().upper(),
                "electorate": electorate_val,
                "volatility_score": 0.0,
                "status": "pending"
            })

        # THE FIX: Deduplicate the list to ensure Postgres doesn't crash on identical IDs
        unique_payload = {}
        for item in batch_payload:
            unique_payload[item["id"]] = item
        final_batch = list(unique_payload.values())

        if supabase and final_batch:
            print(f"    -> Pushing {len(final_batch)} unique records to database...")
            for i in range(0, len(final_batch), 100):
                supabase.table("constituencies").upsert(final_batch[i:i+100]).execute()
                time.sleep(0.2)
            print(f"    [✓] {state} Complete.")

    print("\n[✓] ALL CONSTITUENCIES FULLY SCRAPED, MAPPED, AND SEEDED!")

if __name__ == "__main__":
    build_database()