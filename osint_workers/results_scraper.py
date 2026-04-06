import time
import json
import random
import os
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv(dotenv_path="../.env")

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")

try:
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
except Exception as e:
    print(f"Warning: Could not connect to Supabase: {e}")
    supabase = None

def scrape_eci_results():
    """
    On Counting Day (e.g., results.eci.gov.in), this worker would parse 
    the complex HTML tables using BeautifulSoup.
    
    For the prototype, it simulates scraping shifting margins and updates
    our Supabase database to trigger Realtime WebSockets in the UI.
    """
    print(f"[{time.strftime('%H:%M:%S')}] 🔃 [ECI SCRAPER] Hitting results.eci.gov.in...")
    
    if not supabase:
        print("  -> (Simulated) Supabase disconnected. Scraper running in void.")
        return

    # Simulate fetching a changing lead margin for a known constituency
    # In reality: 
    # soup = BeautifulSoup(requests.get('https://results.eci.gov.in...').text)
    # tr = soup.find(...)
    
    # Let's say we scraped Kannur (KER-001) and a candidate's margin shifted
    mock_scraped_data = {
        "candidate_id": "KER-001-1", # Example candidate ID
        "new_margin": random.randint(100, 50000),
        "status": "leading"
    }
    
    print(f"  -> Scraped Update: Candidate {mock_scraped_data['candidate_id']} margin shifted to {mock_scraped_data['new_margin']}.")
    
    try:
        # Push to DB. This fires the Postgres replication which triggers Supabase Realtime
        # and tells the Next.js frontend to update the IntelPane visually instantly.
        res = supabase.table("candidates").update({
            "margin": mock_scraped_data["new_margin"],
            "status": mock_scraped_data["status"],
            "updated_at": "now()"
        }).eq("id", mock_scraped_data["candidate_id"]).execute()
        
        print("  -> Successfully pushed to DB.")
    except Exception as e:
        print(f"  -> [DB ERROR]: {e}")

if __name__ == "__main__":
    print("=== DHARMA-OSINT ECI High-Frequency Scraper ===")
    print("WARNING: This proxy fleet is configured for Polling Day volume.")
    while True:
        scrape_eci_results()
        # High frequency: Every 15 seconds during active counting hours
        time.sleep(15)
