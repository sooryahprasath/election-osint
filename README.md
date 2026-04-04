# Project Dharma-OSINT 👁‍🗨

A real-time, high-density Situational Awareness Dashboard for the **2026 Indian State Elections** (Kerala, West Bengal, Assam, Tamil Nadu).

*Vibe Coding Aesthetic: Night-Vision Green, CRT Scanlines, High-Density Information Panels.*

## Tech Stack
*   **Frontend**: Next.js 16 (App Router), Tailwind CSS v4 (@theme inline)
*   **Visual Engine**: CesiumJS (WebGL 3D Tactical Globe) + Custom GLSL Post-Processing
*   **Database (Phase 2)**: Supabase (PostgreSQL + Real-time)
*   **State & Stream (Phase 2)**: Upstash Redis (News tickers)
*   **Intelligence (Phase 2)**: Pinecone (Vector Search)
*   **Auth (Phase 2)**: Clerk

## Features
*   **Signal Convergence Pane**: Scrolling news ticker, AI-generated daily briefings, and severity-filtered intelligence signals geo-pinned to the globe.
*   **3D Tactical Map**: CesiumJS powered globe styled with custom Night-Vision green and CRT scanline post-process shaders for a "war room" feel.
*   **Intelligence Deep-Dives**: Detailed constituency views comparing candidate wealth, criminal records, and incumbency status using procedural mock data representing all 824 seats.

## Getting Started

1.  Clone the repository and install dependencies:
    \`\`\`bash
    npm install
    \`\`\`
2.  Provide a Cesium Ion access token in `.env.local` for full map imagery:
    \`\`\`env
    NEXT_PUBLIC_CESIUM_ION_TOKEN=your_token_here
    \`\`\`
3.  Start the development server:
    \`\`\`bash
    npm run dev
    \`\`\`

*(Note: Initial build relies completely on high-quality procedural mock data. Supabase, Redis, and Pinecone are stubbed for Phase 2 implementation.)*
