# 🇮🇳 Project Dharma-OSINT
### "Situational Awareness for the 2026 Indian State Elections"

[![Next.js 15](https://img.shields.io/badge/Frontend-Next.js%2015-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![Leaflet.js](https://img.shields.io/badge/Maps-Leaflet.js-green?style=for-the-badge&logo=leaflet)](https://leafletjs.org/)
[![Supabase](https://img.shields.io/badge/Database-Supabase-3ECF8E?style=for-the-badge&logo=supabase)](https://supabase.com/)
[![Gemini 1.5 Pro](https://img.shields.io/badge/AI-Gemini%201.5%20Pro-blue?style=for-the-badge&logo=google-gemini)](https://ai.google.dev/)

**Project Dharma** is a real-time Open-Source Intelligence (OSINT) dashboard designed to combat information fragmentation during the 2026 Indian State Elections (Kerala, Assam, West Bengal, Tamil Nadu). 

Inspired by the high-density tactical displays of military "War Rooms" and the methodology of **Bilawal Sidhu's World Monitor**, this platform fuses live news, verified candidate dossiers, and geospatial data into a single, actionable 2D/3D interface.

---

## 🛰️ Intelligence Architecture: The "Data Fusion" Model

Unlike standard election trackers, Dharma operates as a **Situational Awareness Tool**:

1.  **The Signal Layer (Autonomous Workers):** Python-based agents (`osint_workers/`) monitor regional RSS feeds and social media. They utilize **Gemini 1.5 Pro** to perform real-time entity extraction, sentiment analysis, and geographic geocoding.
2.  **The Dossier Layer (Deep-Dive Intel):** A custom scraper engine pulls affidavits from the **Election Commission of India (ECI)** and financial/criminal data from **MyNeta (ADR India)**. Every candidate is assigned a unique "Dossier File" with direct source verification links.
3.  **The Tactical Layer (Visual Engine):** A dark-themed **Leaflet.js** map renders constituency boundaries via GeoJSON and overlays live "Pulse Markers." Green markers indicate standard updates; Red pulsing markers indicate high-severity signals (e.g., MCC violations or localized unrest).

---

## 🛠️ The Tech Stack

| Component | Technology |
| :--- | :--- |
| **Framework** | Next.js 15 (App Router) |
| **Styling** | Tailwind CSS (Tactical/Cyberpunk UI) |
| **Map Engine** | Leaflet.js (Lightweight & High-Performance) |
| **Backend** | Supabase (PostgreSQL + Real-time WebSockets) |
| **AI Orchestration** | Gemini 1.5 Pro via Google AI Studio |
| **Workers** | Python 3.11 (BeautifulSoup, Playwright) |

---

## 🚀 Speed-to-Ship: How it was Built

This project is a product of **"Vibe Coding"**—the process of using high-level architectural intent and AI agents to build complex systems at lightning speed.

* **Build Time:** 72 Hours (Weekend Sprint).
* **Methodology:** Utilizing **Google Antigravity** and **Gemini Pro** to orchestrate the multi-file refactoring required to transition from a mockup to a live intelligence tool.
* **The "Bilawal" Influence:** The UI focuses on **Information Density**. Every pixel is designed to provide utility, from the "Morning Briefing" news summaries to the "Constituency Intel" sidebar.

---

## 🏁 Implementation Guide

### 1. Database Initialization
Execute the SQL scripts in `src/lib/supabase/schema.sql` to initialize your Supabase instance with the required tables for `candidates`, `constituencies`, and `signals`.

### 2. Environment Setup
Create a `.env.local` file:
```env
NEXT_PUBLIC_SUPABASE_URL=your_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
GEMINI_API_KEY=your_ai_studio_key