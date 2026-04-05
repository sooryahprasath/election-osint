import time
import requests
from bs4 import BeautifulSoup
import feedparser
import json
import os
from google import genai
from googleapiclient.discovery import build
from dotenv import load_dotenv
from supabase import create_client, Client

env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
load_dotenv(dotenv_path=env_path)

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY") # Add this to your .env

gemini_client = genai.Client(api_key=GEMINI_API_KEY)
youtube = build('youtube', 'v3', developerKey=YOUTUBE_API_KEY) if YOUTUBE_API_KEY else None

try:
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
except Exception as e:
    print(f"CRITICAL: Supabase offline: {e}")
    supabase = None

FEEDS = {
    "ANI_News": "https://aninews.in/rss-feed/",
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
    """Hits the YouTube API to find the top video/short for the query."""
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
        "video_query": "Generate a 3-word YouTube search query for this news event (e.g. 'Assam election rally'). MUST NOT BE BLANK."
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

        # Fetch REAL YouTube Video
        video_url = ""
        vq = analysis.get("video_query", "")
        if vq and len(vq) > 3:
            print(f"      -> Searching YouTube for: '{vq}'")
            video_url = fetch_youtube_video(vq)
        
        if supabase:
            existing = supabase.table("signals").select("id").eq("title", original_title).execute()
            if len(existing.data) > 0: return

            supabase.table("signals").insert({
                "source": source_title, "source_url": source_url, "image_url": image_url, "video_url": video_url,
                "title": original_title, "body": short_body, "state": analysis.get("state"),
                "constituency_id": c_id, "severity": analysis.get("severity", 1),
                "verified": analysis.get("verified", False) or (state_context == "Govt_Official"),
                "full_summary": analysis.get("bullets",[]),
                "category": "official" if state_context == "Govt_Official" else "alert"
            }).execute()
            print(f"   ->[SUCCESS] Saved | SEV-{analysis.get('severity')}")
    except Exception as e: print(f"   ->[LLM/DB Error]: {e}")



def generate_ai_briefing():
    print("\n[+] Compiling Dynamic AI Briefing...")
    if not supabase: return
    res = supabase.table("signals").select("title, body, state, severity, source").order("created_at", desc=True).limit(15).execute()
    recent_signals = res.data
    if not recent_signals or len(recent_signals) < 3: return

    hour = time.localtime().tm_hour
    time_of_day = "MORNING" if hour < 12 else "AFTERNOON" if hour < 18 else "EVENING"
    
    prompt = f"""
    You are a Chief Intelligence Officer. Write a 3-paragraph tactical briefing based ONLY on these signals.
    STRICT RULE: Maximum 15 words per body text. Military style.
    
    Return pure JSON:[
      {{"heading": "West Bengal:", "body": "CAPF deployed. High tension. Clashes expected.", "color_hex": "#dc2626"}},
      {{"heading": "Assam Watch:", "body": "Alliance finalized. Peaceful polling expected.", "color_hex": "#ea580c"}}
    ]
    Signals: {json.dumps(recent_signals)}
    """
    try:
        response = gemini_client.models.generate_content(model='gemini-2.5-flash', contents=prompt)
        text = response.text.strip()
        if text.startswith("```json"): text = text[7:-3].strip()
        paragraphs = json.loads(text)
        
        confidence = 5 if len(recent_signals) > 10 else 3
        supabase.table("briefings").insert({
            "time_of_day": time_of_day,
            "paragraphs": paragraphs,
            "confidence_score": confidence,
            "sources_count": len(recent_signals)
        }).execute()
        print(f"   ->[SUCCESS] AI Briefing saved!")
    except Exception as e: print(f"   ->[Briefing Error]: {e}")

def fetch_and_ingest():
    print(f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] Waking up Advanced Signal Ingestor...")
    valid_c_ids = [row["id"] for row in supabase.table("constituencies").select("id").execute().data] if supabase else[]

    for state_name, url in FEEDS.items():
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries[:4]:
                title = entry.title
                link = entry.link
                summary_html = getattr(entry, 'summary', '')
                source_name = getattr(entry.source, 'title', 'News') if hasattr(entry, 'source') else "News Network"
                
                # PRE-FILTER: Ensure it's actually about elections/politics before burning Gemini tokens
                search_text = (title + " " + summary_html).lower()
                keywords =["election", "poll", "vote", "congress", "bjp", "cpi", "tmc", "dmk", "rally", "clash", "eci", "candidate"]
                
                if not any(k in search_text for k in keywords):
                    print(f"   ->[IGNORED] Not election related: {title[:40]}...")
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
        time.sleep(1800)