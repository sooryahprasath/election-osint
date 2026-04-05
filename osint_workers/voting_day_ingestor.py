import time
import requests
from bs4 import BeautifulSoup
import feedparser
import json
import os
import datetime
import urllib.parse
from google import genai
from dotenv import load_dotenv
from supabase import create_client, Client

env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
load_dotenv(dotenv_path=env_path)

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

gemini_client = genai.Client(api_key=GEMINI_API_KEY)

try:
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
except Exception:
    supabase = None

# Custom Google News RSS specifically restricted to highly credible Indian media houses
TRUSTED_SOURCES = 'source:"News18" OR source:"ANI" OR source:"Times Now" OR source:"Moneycontrol" OR source:"ET Now" OR source:"CNBC" OR source:"Polimer News" OR source:"The Hindu"'

def extract_article_text(url):
    try:
        res = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=10, allow_redirects=True)
        soup = BeautifulSoup(res.content, 'html.parser')
        return " ".join([p.text for p in soup.find_all('p')])[:1500]
    except: return ""

def ingest_live_turnout_and_news(states):
    print("\n[+] KINETIC PHASE: Scraping Live Turnout & Booth News...")
    
    current_time = datetime.datetime.now().strftime("%I:00 %p")
    
    for state in states:
        # THE FIX: Properly URL Encode the query to prevent control character crashes
        raw_query = f'{state} Election (turnout OR voting OR clash OR EVM) when:1d {TRUSTED_SOURCES}'
        safe_query = urllib.parse.quote(raw_query)
        url = f'https://news.google.com/rss/search?q={safe_query}&hl=en-IN&gl=IN&ceid=IN:en'
        
        try:
            feed = feedparser.parse(url)
            corpus =[]
            
            for entry in feed.entries[:8]: # Grab top 8 articles for consensus
                text = extract_article_text(entry.link)
                if text: corpus.append(f"Source: {entry.source.title} | Link: {entry.link} | Text: {text}")
                
            if not corpus: continue
            
            combined_text = "\n---\n".join(corpus)
            
            prompt = f"""
            You are a strictly neutral, factual Election AI. Analyze these live news reports for {state}.
            1. Find the consensus Voter Turnout percentage. If sources differ, provide a min and max range. If no data, use 0.
            2. Extract up to 2 critical, verified incidents happening at polling booths (e.g. EVM breakdown, violence). Keep text under 12 words. Provide the source link.
            
            Return pure JSON (no markdown):
            {{
               "turnout_min": 65.5,
               "turnout_max": 66.2,
               "booth_news":[
                 {{"text": "EVM malfunction reported in 3 booths, voting delayed.", "source": "https://..."}}
               ]
            }}
            
            Text: {combined_text}
            """
            
            response = gemini_client.models.generate_content(model='gemini-2.5-flash', contents=prompt)
            text = response.text.strip()
            if text.startswith("```json"): text = text[7:-3].strip()
            
            data = json.loads(text)
            
            if supabase:
                supabase.table("voter_turnout").upsert({
                    "state": state,
                    "time_slot": current_time,
                    "turnout_min": data.get("turnout_min", 0),
                    "turnout_max": data.get("turnout_max", 0),
                    "booth_news": data.get("booth_news", [])
                }).execute()
                print(f"   -> [SUCCESS] {state} Turnout: {data.get('turnout_min')}% - {data.get('turnout_max')}% mapped.")
                
        except Exception as e:
            print(f"   -> [ERROR] Failed processing {state}: {e}")

def ingest_exit_polls(states):
    print("\n[+] EXIT POLL PHASE: Embargo Lifted. Aggregating Predictions...")
    
    for state in states:
        # THE FIX: Properly URL Encode the query to prevent control character crashes
        raw_query = f'{state} Election Exit Poll Prediction (Axis My India OR CVoter OR Lokniti OR CNX) when:1d'
        safe_query = urllib.parse.quote(raw_query)
        url = f'https://news.google.com/rss/search?q={safe_query}&hl=en-IN&gl=IN&ceid=IN:en'
        
        try:
            feed = feedparser.parse(url)
            corpus =[]
            for entry in feed.entries[:5]:
                text = extract_article_text(entry.link)
                if text: corpus.append(f"Source: {entry.source.title} | Text: {text}")
                
            if not corpus: continue
            
            prompt = f"""
            You are a neutral Election AI. Analyze these Exit Poll reports for {state}.
            Extract the seat predictions from the most prominent agency mentioned (e.g. Axis My India, CVoter).
            
            Return pure JSON (no markdown):
            {{
               "agency": "Axis My India",
               "party_a_name": "AITC", "party_a_min": 140, "party_a_max": 160,
               "party_b_name": "BJP", "party_b_min": 110, "party_b_max": 130
            }}
            
            Text: {" ".join(corpus)}
            """
            
            response = gemini_client.models.generate_content(model='gemini-2.5-flash', contents=prompt)
            text = response.text.strip()
            if text.startswith("```json"): text = text[7:-3].strip()
            data = json.loads(text)
            
            if supabase and data.get("agency"):
                supabase.table("exit_polls").upsert({
                    "state": state, "agency": data["agency"],
                    "party_a_name": data.get("party_a_name"), "party_a_min": data.get("party_a_min", 0), "party_a_max": data.get("party_a_max", 0),
                    "party_b_name": data.get("party_b_name"), "party_b_min": data.get("party_b_min", 0), "party_b_max": data.get("party_b_max", 0)
                }).execute()
                print(f"   ->[SUCCESS] Exit Poll for {state} by {data['agency']} saved.")
                
        except Exception as e:
            print(f"   -> [ERROR] Failed processing {state}: {e}")

if __name__ == "__main__":
    print("=== DHARMA-OSINT: Voting Day AI Consensus Engine ===")
    
    if not supabase:
        print("CRITICAL: Supabase offline.")
        exit()
        
    while True:
        now = datetime.datetime.now()
        
        # Test Phase 2B (West Bengal) as an example
        active_states = ["West Bengal"]
        
        # 19:15 is 7:15 PM in 24-hour time
        if now.hour >= 19 and now.minute >= 15:
            ingest_exit_polls(active_states)
        else:
            ingest_live_turnout_and_news(active_states)
            
        time.sleep(1800) # Run every 30 minutes