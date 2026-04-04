"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import TopBar from "@/components/TopBar";
import BottomBar from "@/components/BottomBar";
import SignalPane from "@/components/signals/SignalPane";
import IntelPane from "@/components/intel/IntelPane";
import MapControls from "@/components/map/MapControls";

// ── Dynamic import so Leaflet only runs on the client (no SSR) ───────────────
const IndiaMap = dynamic(() => import("@/components/map/IndiaMap"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#e8ecee",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 0,
      }}
    >
      <div style={{ textAlign: "center", fontFamily: "monospace" }}>
        <div
          style={{
            width: 24,
            height: 24,
            border: "2px solid #16a34a",
            borderTopColor: "transparent",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
            margin: "0 auto 8px",
          }}
        />
        <div style={{ color: "#16a34a", fontSize: 11, letterSpacing: 2 }}>
          INITIALIZING TACTICAL MAP...
        </div>
      </div>
    </div>
  ),
});

// ── Layout constants (must match TopBar/BottomBar heights) ───────────────────
const TOPBAR_H   = 36;  // h-9 = 36px
const BOTTOMBAR_H = 28; // h-7 = 28px
const SIDEBAR_W  = 280; // width of each side panel

export default function Home() {
  const [nightVisionEnabled, setNightVisionEnabled] = useState(false);
  const [debugModeEnabled,   setDebugModeEnabled]   = useState(false);
  const [flyToState,         setFlyToState]         = useState<string | null>(null);
  const [globalStateFilter,  setGlobalStateFilter]  = useState<string>("ALL");
  const [globalConstituencyId, setGlobalConstituencyId] = useState<string | null>(null);

  const handleStateFilter = (s: string) => {
    setGlobalStateFilter(s);
    setFlyToState(s === "ALL" ? "India" : s);
  };

  return (
    <>
      {/* ── Layer 0: The full-viewport map (z-index: 0) ─────────────────── */}
      <IndiaMap
        flyToState={flyToState}
        debugModeEnabled={debugModeEnabled}
        onSelectConstituency={id => setGlobalConstituencyId(id)}
      />

      {/* ── Layer 1: UI chrome — everything is fixed/absolute on top ─────── */}

      {/* Top bar */}
      <TopBar />

      {/* Left sidebar — Signal Pane */}
      <aside
        style={{
          position:   "fixed",
          top:        TOPBAR_H,
          left:       0,
          width:      SIDEBAR_W,
          bottom:     BOTTOMBAR_H,
          zIndex:     20,
          background: "rgba(255,255,255,0.92)",
          backdropFilter: "blur(8px)",
          borderRight: "1px solid #e4e4e7",
          overflowY:  "auto",
        }}
      >
        <SignalPane
          globalStateFilter={globalStateFilter}
          setGlobalStateFilter={handleStateFilter}
        />
      </aside>

      {/* Right sidebar — Intel Pane */}
      <aside
        style={{
          position:   "fixed",
          top:        TOPBAR_H,
          right:      0,
          width:      SIDEBAR_W,
          bottom:     BOTTOMBAR_H,
          zIndex:     20,
          background: "rgba(255,255,255,0.92)",
          backdropFilter: "blur(8px)",
          borderLeft:  "1px solid #e4e4e7",
          overflowY:  "auto",
        }}
      >
        <IntelPane
          globalStateFilter={globalStateFilter}
          setGlobalStateFilter={handleStateFilter}
          globalConstituencyId={globalConstituencyId}
          setGlobalConstituencyId={setGlobalConstituencyId}
        />
      </aside>

      {/* Map controls (fly-to, debug toggle, NV) */}
      

      {/* Bottom bar */}
      <BottomBar />
    </>
  );
}
