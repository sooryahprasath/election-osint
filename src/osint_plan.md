# OSINT Data Source Collection Plan

This document outlines the systematic roadmap for replacing static mock data with a real-time ingestion pipeline for election monitoring.

## 1. High-Priority Data Sources

| Source | Data Type | Access Method | Refresh Rate |
|---|---|---|---|
| **ECI Official Results** | Polling stats, winners | Scrapy (ECI Portal) | 15 mins |
| **Newspapers (The Hindu, Indian Express)** | Volatility signals, security alerts | RSS / GDELT API | 30 mins |
| **X (Twitter) Tracking** | Hashtag sentiment, local rumors | Twitter API (v2) / Snscrape | Real-time |
| **Telegram Channels** | Grassroots coordination, local "Signals" | Telethon / MTProto | Real-time |

## 2. Ingestion Architecture

### Ingestion Worker (Node.js)
A background service (deployable as a Vercel Function or a separate Docker container) that cycles through these sources.

### Data Model
Signals will be standardized into:
```json
{
  "source": "RSS_THE_HINDU",
  "location": { "state": "West Bengal", "constituency_id": "WB-01" },
  "severity": 4, 
  "body": "Clashes reported at polling booth 42...",
  "timestamp": "2026-04-04T05:30:00Z"
}
```

### Volatility Score Engine
A simple NLP script will process incoming signal bodies to adjust the `volatilityScore` of constituencies in real-time.

## 3. Storage & Delivery
- **Supabase (Postgres):** Main transactional DB for signals.
- **Edge Caching:** Next.js ISR (Incremental Static Regeneration) to ensure the map renders fast.

## 4. Immediate Next Steps
1. **ECI Scraper Prototype:** Build a script to fetch the latest "Schedule of Elections" from ECI.
2. **Signal DB Schema:** Initialize the `signals` table in Supabase.
3. **News Pipeline:** Set up an RSS listener for top-10 Indian news portals.
