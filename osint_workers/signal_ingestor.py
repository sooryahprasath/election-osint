import time
import requests
import xml.etree.ElementTree as ET
import os
import google.generativeai as genai
from dotenv import load_dotenv
from supabase import create_client, Client

env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
load_dotenv(dotenv_path=env_path)

# Use real Supabase credentials from .env
SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

genai.configure(api_key=GEMINI_API_KEY)
model = genai.GenerativeModel('gemini-1.5-flash-latest')

try:
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
except Exception as e:
    print(f"Warning: Could not connect to Supabase: {e}")
    supabase = None

# FEEDS
FEEDS = {
    "PTI_News": "http://ptinews.com/rss/national.xml",
    "TheHindu_Kerala": "https://www.thehindu.com/news/national/kerala/feeder/default.rss"
}

def analyze_and_insert(source, title, summary):
    prompt = f"""
    You are a strictly accurate high-intelligence Election OSINT engine.
    Analyze this election news item:
    Source: {source}
    Title: {title}
    Body: {summary}
    
    Fields to extract silently (Return purely JSON without markdown syntax):
    1. "state" (e.g. "Kerala", leave blank if national)
    2. "constituency_id" (e.g. "KER-13" if Kannur mentioned. Blank if unknown)
    3. "severity" (1 to 5 index)
    4. "verified" (true/false)
    
    Format:
    {{"state":"...","constituency_id":"...","severity":2,"verified":true}}
    """
    
    try:
        response = model.generate_content(prompt)
        text = response.text.strip()
        if text.startswith("```json"):
            text = text[7:-3].strip()
            
        analysis = __import__('json').loads(text)
        
        # Ingest to DB
        if supabase:
            res = supabase.table("signals").insert({
                "source": source,
                "title": title,
                "body": summary,
                "state": analysis.get("state"),
                "constituency_id": analysis.get("constituency_id"),
                "severity": analysis.get("severity", 1),
                "verified": analysis.get("verified", False)
            }).execute()
            print(f"   -> ++ Saved to Live DB (Severity: {analysis.get('severity')})")
            
    except Exception as e:
        print(f"   -> [LLM Error]: {e}")

def fetch_and_ingest():
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Waking up Signal Ingestor...")
    for source_name, url in FEEDS.items():
        try:
            res = requests.get(url, timeout=10)
            if res.status_code != 200: continue
            
            root = ET.fromstring(res.content)
            for item in root.findall('.//item')[:2]:
                title = item.find('title').text or ""
                summary = item.find('description').text or ""
                
                text_t = (title + " " + summary).lower()
                keywords = ["election", "poll", "vote", "congress", "bjp", "cpi", "kerala", "assam", "violence"]
                
                if any(k in text_t for k in keywords):
                    print(f"-> [RELEVANT]: {title[:60]}...")
                    analyze_and_insert(source_name, title, summary)
                
        except Exception as e:
            print(f"[!] Error on {source_name}: {e}")

if __name__ == "__main__":
    print("=== DHARMA-OSINT Python AI Fact Checking Pipeline Started ===")
    while True:
        fetch_and_ingest()
        time.sleep(60)
