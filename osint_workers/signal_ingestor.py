import time
import requests
from bs4 import BeautifulSoup
import feedparser
import json
import os
import urllib.parse
from google import genai
from googleapiclient.discovery import build
from dotenv import load_dotenv
from supabase import create_client, Client

env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
load_dotenv(dotenv_path=env_path)

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY") 

gemini_client = genai.Client(api_key=GEMINI_API_KEY)
youtube = build('youtube', 'v3', developerKey=YOUTUBE_API_KEY) if YOUTUBE_API_KEY else None

try:
    if not SUPABASE_URL or not SUPABASE_KEY or not SUPABASE_KEY.startswith("ey"):
        raise ValueError("Supabase credentials invalid.")
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
except Exception as e:
    print(f"CRITICAL: Supabase offline: {e}")
    supabase = None

FEEDS = {
    "ANI_News": "https://aninews.in/rss/national",
    "Kerala": "https://news.google.com/rss/search?q=Kerala+Election+2026+when:1d&hl=en-IN&gl=IN&ceid=IN:en",
    "Assam": "https://news.google.com/rss/search?q=Assam+Election+2026+when:1d&hl=en-IN&gl=IN&ceid=IN:en",
    "Tamil_Nadu": "https://news.google.com/rss/search?q=Tamil+Nadu+Election+2026+when:1d&hl=en-IN&gl=IN&ceid=IN:en",
    "West_Bengal": "https://news.google.com/rss/search?q=West+Bengal+Election+2026+when:1d&hl=en-IN&gl=IN&ceid=IN:en",
    "Govt_Official": "https://news.google.com/rss/search?q=Election+Commission+OR+PIB+India+official+release+when:1d&hl=en-IN&gl=IN&ceid=IN:en"
}

def extract_article_data(url, fallback_html):
    full_text, image_url = "", ""
    try:
        headers = {'User-Agent': 'Mozilla/5.0'}
        res = requests.get(url, headers=headers, timeout=10, allow_redirects=True)
        soup = BeautifulSoup(res.content, 'html.parser')
        full_text = " ".join([p.text for p in soup.find_all('p')])
        og_image = soup.find('meta', property='og:image')
        if og_image: image_url = og_image.get('content', '')
    except Exception: pass
    if len(full_text) < 100 and fallback_html:
        full_text = BeautifulSoup(fallback_html, 'html.parser').get_text(separator=' ')
    return full_text[:3000], image_url

def fetch_youtube_video(query):
    """Hits the YouTube API (Costs 100 Quota units per call)."""
    if not youtube: return ""
    try:
        req = youtube.search().list(q=query, part='snippet', type='video', maxResults=1, order='relevance')
        res = req.execute()
        if 'items' in res and len(res['items']) > 0:
            video_id = res['items'][0]['id']['videoId']
            return f"https://www.youtube.com/embed/{video_id}?autoplay=1"
    except Exception as e:
        print(f"      [!] YouTube API Error: {e}")
    return ""

def analyze_and_insert(source_title, source_url, original_title, full_text, image_url, state_context, valid_c_ids):
    prompt = f"""
    Analyze this election news article: Title: {original_title} Body: {full_text}
    Return pure JSON (No markdown):
    {{
        "state": "{state_context.replace('_', ' ')}",
        "constituency_id": "Leave blank if unknown, else standard ID",
        "severity": 1 to 5 integer,
        "verified": true or false,
        "bullets":["Bullet 1", "Bullet 2", "Bullet 3"],
        "video_query": "If this is a severe physical event (rally/clash/violence), provide a 3-word YouTube search query. Else leave blank."
    }}
    """
    try:
        response = gemini_client.models.generate_content(model='gemini-2.5-flash', contents=prompt)
        text = response.text.strip()
        if text.startswith("```json"): text = text[7:-3].strip()
        analysis = json.loads(text)
        
        short_body = analysis.get("bullets", ["No summary available"])[0]
        c_id = analysis.get("constituency_id")
        if c_id not in valid_c_ids: c_id = None
        severity = analysis.get("severity", 1)

        # THROTTLE: Only hit YouTube if severity is high to save API Quota!
        video_url = ""
        vq = analysis.get("video_query", "")
        if vq and len(vq) > 3 and severity >= 3:
            print(f"      -> Searching YouTube for: '{vq}'")
            video_url = fetch_youtube_video(vq)
        
        if supabase:
            supabase.table("signals").insert({
                "source": source_title, "source_url": source_url, "image_url": image_url, "video_url": video_url,
                "title": original_title, "body": short_body, "state": analysis.get("state"),
                "constituency_id": c_id, "severity": severity,
                "verified": analysis.get("verified", False) or (state_context == "Govt_Official"),
                "full_summary": analysis.get("bullets",[]),
                "category": "official" if state_context == "Govt_Official" else "alert"
            }).execute()
            print(f"   ->[SUCCESS] Saved | SEV-{severity}")
    except Exception as e: print(f"   ->[LLM/DB Error]: {e}")

def generate_ai_briefing():
    print("\n[+] Compiling Dynamic AI Briefing...")
    if not supabase: return
    res = supabase.table("signals").select("title, body, state, severity, source, verified").order("created_at", desc=True).limit(20).execute()
    recent_signals = res.data
    if not recent_signals or len(recent_signals) < 3: return

    hour = time.localtime().tm_hour
    time_of_day = "MORNING" if hour < 12 else "AFTERNOON" if hour < 18 else "EVENING"
    
    prompt = f"""
    You are a Chief Intelligence Officer. Write a 4-paragraph tactical briefing based ONLY on these signals.
    STRICT RULES:
    1. Maximum 15 words per body text. Be crisp and military style.
    2. Try to cover key developments in TN, WB, AS, KL, PY if data exists in the signals.
    
    Return pure JSON:[
      {{"heading": "West Bengal:", "body": "CAPF deployed. High tension. Clashes expected.", "color_hex": "#dc2626"}},
      {{"heading": "Tamil Nadu:", "body": "Rallies peaceful. Heavy turnout anticipated.", "color_hex": "#16a34a"}}
    ]
    Signals: {json.dumps(recent_signals)}
    """
    try:
        response = gemini_client.models.generate_content(model='gemini-2.5-flash', contents=prompt)
        text = response.text.strip()
        if text.startswith("```json"): text = text[7:-3].strip()
        paragraphs = json.loads(text)
        
        # Calculate mathematical reliability
        verified_count = sum(1 for s in recent_signals if s.get('verified'))
        unique_sources = len(set(s.get('source') for s in recent_signals))
        confidence = min(5, max(1, int((verified_count / len(recent_signals)) * 3) + (2 if unique_sources > 3 else 1)))
        
        supabase.table("briefings").insert({
            "time_of_day": time_of_day,
            "paragraphs": paragraphs,
            "confidence_score": confidence,
            "sources_count": len(recent_signals)
        }).execute()
        print(f"   ->[SUCCESS] AI Briefing saved with Confidence Level {confidence}!")
    except Exception as e: print(f"   ->[Briefing Error]: {e}")

def fetch_and_ingest():
    print(f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] Waking up Advanced Signal Ingestor...")
    valid_c_ids = [row["id"] for row in supabase.table("constituencies").select("id").execute().data] if supabase else[]

    for state_name, url in FEEDS.items():
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries[:4]:
                title = entry.title
                
                # API FIREWALL: Check DB FIRST before downloading or calling AI
                if supabase:
                    existing = supabase.table("signals").select("id").eq("title", title).execute()
                    if len(existing.data) > 0:
                        print(f"   ->[SKIPPED] Already in DB: {title[:30]}...")
                        continue

                link = entry.link
                summary_html = getattr(entry, 'summary', '')
                source_name = getattr(entry.source, 'title', 'News') if hasattr(entry, 'source') else "News Network"
                
                search_text = (title + " " + summary_html).lower()
                keywords =["election", "poll", "vote", "congress", "bjp", "cpi", "tmc", "dmk", "rally", "clash", "eci", "candidate", "voter"]
                
                if not any(k in search_text for k in keywords):
                    continue

                print(f"-> Found: {title[:60]}...")
                full_text, image_url = extract_article_data(link, summary_html)
                if len(full_text) > 50: 
                    analyze_and_insert(source_name, link, title, full_text, image_url, state_name, valid_c_ids)
        except Exception: pass
    generate_ai_briefing()

if __name__ == "__main__":
    if not supabase: print("CRITICAL: Supabase offline.")
    while True:
        fetch_and_ingest()
        time.sleep(1800) # Runs every 30 mins