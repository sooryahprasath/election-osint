🇮🇳 Project Dharma-OSINT
Real-Time Situational Awareness for the 2026 Indian State Elections
Project Dharma is a lightweight, high-performance OSINT (Open-Source Intelligence) dashboard designed to fuse real-time election data, candidate dossiers, and live "signal" updates into a unified tactical interface. Inspired by military situational awareness tools and the work of Bilawal Sidhu, this platform provides a "Command Center" view of the 2026 assembly elections in Kerala, Assam, West Bengal, and Tamil Nadu.

🛰️ Intelligence Architecture
The system operates on a multi-layered Data Fusion model:

The Signal Layer: Autonomous Python workers (osint_workers/) monitor news feeds and social media. They use Gemini AI to categorize sentiment and extract geographic entities.

The Dossier Layer: Real-time scrapers pull verified candidate data from ECI and MyNeta, generating instant "Dossier Files" containing wealth, education, and criminal records.

The Tactical Layer: A responsive Leaflet map renders constituency boundaries (GeoJSON) and overlays live pulse-markers for incidents, rallies, and polling trends.

🛠️ Tech Stack
Frontend: Next.js 15+ (App Router), Tailwind CSS.

Map Engine: Leaflet.js with custom tactical dark-mode styling.

Backend: Supabase (PostgreSQL + Real-time WebSocket Listeners).

Authentication: Clerk (Social & Dossier-access control).

Intelligence Workers: Python 3.11 (BeautifulSoup, Playwright).

AI Core: Gemini 1.5 Pro (via Google AI Studio).

🚀 Rapid Implementation
1. Initialize the Intelligence Hub (Supabase)
Execute the SQL migrations found in src/lib/supabase/schema.sql to set up your tables:

constituencies: Geographic boundaries and status.

candidates: Deep-dive dossiers.

signals: Real-time news and incident alerts.

2. Configure Environment
Create a .env.local in the root directory:

Code snippet
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_key
GEMINI_API_KEY=your_google_ai_studio_key
3. Deploy the Tactical Frontend
Bash
npm install
npm run dev
4. Ignite the OSINT Workers
Bash
cd osint_workers
pip install -r requirements.txt
python signal_ingestor.py
📡 Roadmap
[x] Leaflet Integration: High-performance constituency boundary rendering.

[x] Dossier System: Interactive candidate modals with ECI/MyNeta source links.

[x] Live Ticker: Real-time signal feed with automatic map focus.

[ ] Swing Engine: Logic for calculating victory margins on Counting Day (May 4, 2026).

[ ] Protest Tracking: Correlating signal density with physical geography to predict volatility hotspots.

💡 Origin & Inspiration
This project was built during a 72-hour "Vibe Coding" sprint, utilizing Google Antigravity and Gemini Pro to orchestrate complex data flows between government affidavits and geospatial visualizations. It serves as a proof-of-concept for how bedroom-startup stacks can rival institutional intelligence tools like Palantir.