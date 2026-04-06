import time
import requests
from bs4 import BeautifulSoup
import feedparser
import json
import os
import sys
import gc
import urllib.parse
from datetime import datetime, timedelta, timezone
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

# --- QUOTA & TIME MANAGEMENT ---
IST = timezone(timedelta(hours=5, minutes=30))
YOUTUBE_QUOTA_USED = 0
LAST_QUOTA_RESET_DATE = datetime.now(IST).date()

def manage_youtube_quota():
    """Resets quota daily at midnight IST."""
    global YOUTUBE_QUOTA_USED, LAST_QUOTA_RESET_DATE
    current_date = datetime.now(IST).date()
    if current_date != LAST_QUOTA_RESET_DATE:
        YOUTUBE_QUOTA_USED = 0
        LAST_QUOTA_RESET_DATE = current_date

def get_election_context():
    """Provides time-aware instructions to the AI."""
    now = datetime.now(IST)
    date_str = now.strftime("%Y-%m-%d")
    
    # Auto-Terminate Script after elections
    if now > datetime(2026, 5, 11, tzinfo=IST):
        print("=== ELECTION CYCLE CONCLUDED. TERMINATING OSINT ENGINE ===")
        sys.exit(0)

    if date_str in["2026-04-09", "2026-04-23", "2026-04-29"]:
        return "TODAY IS VOTING DAY. Focus heavily on polling booth violence, EVM issues, voter turnout, and immediate election commission actions."
    elif date_str == "2026-05-04":
        return "TODAY IS COUNTING DAY. Focus strictly on live vote margins, winning candidates, and final results."
    else:
        return "PRE-POLL CAMPAIGN PHASE. Focus on rallies, manifesto promises, MCC violations, and candidate alliances."

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


def valid_india_coords(lat, lng):
    """Return (lat, lng) floats if plausible for India, else None."""
    if lat is None or lng is None:
        return None
    try:
        lat_f = float(lat)
        lng_f = float(lng)
    except (TypeError, ValueError):
        return None
    if 6.0 <= lat_f <= 38.0 and 67.0 <= lng_f <= 98.0:
        return lat_f, lng_f
    return None


def fetch_youtube_video(query):
    """Hits YouTube API safely. Costs 100 Units. Hard cap at 4500/day."""
    global YOUTUBE_QUOTA_USED
    manage_youtube_quota()

    if not youtube: return ""
    if YOUTUBE_QUOTA_USED >= 4500:
        print("      [!] YouTube Quota Limit Reached for today. Skipping video fetch.")
        return ""

    try:
        # Removed videoCategoryId='25' so we don't accidentally filter out valid news Shorts
        safe_query = f"{query} news"
        req = youtube.search().list(
            q=safe_query, 
            part='snippet', 
            type='video', 
            maxResults=1, 
            order='relevance'
        )
        res = req.execute()
        YOUTUBE_QUOTA_USED += 100
        
        if 'items' in res and len(res['items']) > 0:
            video_id = res['items'][0]['id']['videoId']
            return f"https://www.youtube.com/embed/{video_id}?autoplay=1"
    except Exception as e:
        print(f"      [!] YouTube API Error: {e}")
    return ""

def analyze_and_insert(source_title, source_url, original_title, full_text, image_url, state_context, valid_c_ids):
    election_context = get_election_context()
    
    prompt = f"""
    You are a strictly accurate Election OSINT engine. {election_context}
    Analyze this news article: Title: {original_title} Body: {full_text}

    Return pure JSON (No markdown):
    {{
        "state": "{state_context.replace('_', ' ')}",
        "constituency_id": "Blank if unknown, else exact internal ID from context if inferable",
        "severity": 1 to 5 integer (4 or 5 for extreme physical violence or major fraud only),
        "verified": true or false,
        "bullets": ["Bullet 1", "Bullet 2", "Bullet 3"],
        "latitude": null or decimal degrees if the text implies a specific town/venue in India,
        "longitude": null or decimal degrees (must pair with latitude),
        "geo_confidence": 0.0 to 1.0 how sure you are about lat/long (0 if omitted),
        "video_relevant": true only if a TV news clip or official rally video likely exists that matches THIS exact story; false for generic opinion, pure text, or when unsure,
        "video_confidence": 0.0 to 1.0 confidence that a matching video exists,
        "video_query": "Short 3-6 word YouTube search ONLY if video_relevant is true; else empty string"
    }}
    Rules: Never guess lat/long from state alone. If video_relevant is false, video_query must be "".
    """
    try:
        response = gemini_client.models.generate_content(model='gemini-2.5-flash', contents=prompt)
        text = response.text.strip()
        if text.startswith("```json"): text = text[7:-3].strip()
        analysis = json.loads(text)
        
        short_body = analysis.get("bullets", ["No summary available"])[0]
        c_id = analysis.get("constituency_id")
        if c_id not in valid_c_ids:
            c_id = None
        severity = analysis.get("severity", 1)

        coords = valid_india_coords(analysis.get("latitude"), analysis.get("longitude"))
        geo_c = float(analysis.get("geo_confidence") or 0)
        if coords and geo_c < 0.45:
            coords = None

        video_url = ""
        vq = (analysis.get("video_query") or "").strip()
        vid_rel = analysis.get("video_relevant") is True
        vid_conf = float(analysis.get("video_confidence") or 0)
        if (
            vid_rel
            and vid_conf >= 0.62
            and len(vq) > 3
            and (severity >= 2 or state_context == "Govt_Official")
        ):
            print(f"      -> Searching YouTube for: '{vq}' (conf={vid_conf:.2f})")
            video_url = fetch_youtube_video(vq)

        row = {
            "source": source_title,
            "source_url": source_url,
            "image_url": image_url,
            "video_url": video_url,
            "title": original_title,
            "body": short_body,
            "state": analysis.get("state"),
            "constituency_id": c_id,
            "severity": severity,
            "verified": analysis.get("verified", False) or (state_context == "Govt_Official"),
            "full_summary": analysis.get("bullets", []),
            "category": "official" if state_context == "Govt_Official" else "alert",
        }
        if coords:
            row["latitude"], row["longitude"] = coords[0], coords[1]

        if supabase:
            supabase.table("signals").insert(row).execute()
            print(f"   ->[SUCCESS] Saved | SEV-{severity}")
    except Exception as e: print(f"   ->[LLM/DB Error]: {e}")

def generate_ai_briefing():
    print("\n[+] Compiling Dynamic 24-Hour AI Briefing...")
    if not supabase: return
    
    twenty_four_hrs_ago = (datetime.now(IST) - timedelta(hours=24)).isoformat()
    
    res = supabase.table("signals").select("title, body, state, severity, source, verified") \
          .gte("created_at", twenty_four_hrs_ago) \
          .order("created_at", desc=True).limit(20).execute()
          
    recent_signals = res.data
    if not recent_signals or len(recent_signals) < 3: 
        print("   -> Not enough data in the last 24h for a briefing.")
        return

    hour = datetime.now(IST).hour
    time_of_day = "MORNING" if hour < 12 else "AFTERNOON" if hour < 18 else "EVENING"
    election_context = get_election_context()
    
    prompt = f"""
    You are a Chief Intelligence Officer. {election_context}
    Write a 4-paragraph tactical briefing based ONLY on these signals from the last 24 hours.
    STRICT RULES:
    1. Maximum 15 words per body text. Be crisp and military style.
    2. Try to cover key developments in TN, WB, AS, KL, PY if data exists.
    
    Return pure JSON:[
      {{"heading": "West Bengal:", "body": "CAPF deployed. High tension. Clashes expected.", "color_hex": "#dc2626"}}
    ]
    Signals: {json.dumps(recent_signals)}
    """
    try:
        response = gemini_client.models.generate_content(model='gemini-2.5-flash', contents=prompt)
        text = response.text.strip()
        if text.startswith("```json"): text = text[7:-3].strip()
        paragraphs = json.loads(text)
        
        verified_count = sum(1 for s in recent_signals if s.get('verified'))
        unique_sources = len(set(s.get('source') for s in recent_signals))
        confidence = min(5, max(1, int((verified_count / len(recent_signals)) * 3) + (2 if unique_sources > 3 else 1)))
        
        supabase.table("briefings").insert({
            "time_of_day": time_of_day,
            "paragraphs": paragraphs,
            "confidence_score": confidence,
            "sources_count": len(recent_signals)
        }).execute()
        print(f"   ->[SUCCESS] {time_of_day} Briefing saved (Conf: {confidence})!")
    except Exception as e: print(f"   ->[Briefing Error]: {e}")

def cleanup_old_signals():
    """NEW: Deletes signals older than 24 hours to keep the Map and DB extremely clean."""
    if not supabase: return
    try:
        twenty_four_hrs_ago = (datetime.now(IST) - timedelta(hours=24)).isoformat()
        res = supabase.table("signals").delete().lt("created_at", twenty_four_hrs_ago).execute()
        deleted_count = len(res.data) if res.data else 0
        print(f"[+] Garbage Collection: Cleared {deleted_count} expired signals from the map.")
    except Exception as e:
        print(f"   ->[Cleanup Error]: {e}")

def fetch_and_ingest():
    now_ist = datetime.now(IST).strftime('%Y-%m-%d %I:%M:%S %p')
    print(f"\n[{now_ist}] Waking up Advanced Signal Ingestor (IST)...")
    
    # Run garbage collection first
    cleanup_old_signals()
    
    valid_c_ids = [row["id"] for row in supabase.table("constituencies").select("id").execute().data] if supabase else[]

    for state_name, url in FEEDS.items():
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries[:4]:
                title = entry.title
                
                if supabase:
                    existing = supabase.table("signals").select("id").eq("title", title).execute()
                    if len(existing.data) > 0:
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
        gc.collect() 

    generate_ai_briefing()

if __name__ == "__main__":
    print("=== DHARMA-OSINT Verified AI News Pipeline ===")
    if not supabase: print("CRITICAL: Supabase offline.")
    
    while True:
        fetch_and_ingest()
        time.sleep(1800)