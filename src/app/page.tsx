"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import TopBar from "@/components/TopBar";
import BottomBar from "@/components/BottomBar";
import SignalPane from "@/components/signals/SignalPane";
import IntelPane from "@/components/intel/IntelPane";
import MapControls from "@/components/map/MapControls";
import SignalModal from "@/components/signals/SignalModal"; // NEW: Import the modal here

const IndiaMap = dynamic(() => import("@/components/map/IndiaMap"), {
  ssr: false,
  loading: () => (
    <div style={{ position: "fixed", inset: 0, background: "#e8ecee", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 0 }}>
      <div style={{ textAlign: "center", fontFamily: "monospace" }}>
        <div style={{ width: 24, height: 24, border: "2px solid #16a34a", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 8px" }} />
        <div style={{ color: "#16a34a", fontSize: 11, letterSpacing: 2 }}>INITIALIZING TACTICAL MAP...</div>
      </div>
    </div>
  ),
});

const TOPBAR_H = 36;
const BOTTOMBAR_H = 28;
const SIDEBAR_W = 280;

export default function Home() {
  const [flyToState, setFlyToState] = useState<string | null>(null);
  const [globalStateFilter, setGlobalStateFilter] = useState<string>("ALL");
  const [globalConstituencyId, setGlobalConstituencyId] = useState<string | null>(null);

  // NEW: Global state for the popup so the Map can open it!
  const [activeSignal, setActiveSignal] = useState<any | null>(null);

  const handleStateFilter = (s: string) => {
    setGlobalStateFilter(s);
    setGlobalConstituencyId(null);
    setFlyToState(s === "ALL" ? "India" : s);
  };

  return (
    <>
      <IndiaMap
        flyToState={flyToState}
        activeState={globalStateFilter}
        activeConstituencyId={globalConstituencyId}
        onSelectConstituency={id => setGlobalConstituencyId(id)}
        onSelectState={state => handleStateFilter(state)}
        onSelectSignal={signal => setActiveSignal(signal)} // NEW: Pass click handler to map
      />

      <TopBar />

      <aside style={{ position: "fixed", top: TOPBAR_H, left: 0, width: SIDEBAR_W, bottom: BOTTOMBAR_H, zIndex: 20, background: "rgba(255,255,255,0.92)", backdropFilter: "blur(8px)", borderRight: "1px solid #e4e4e7", overflowY: "auto" }}>
        <SignalPane
          globalStateFilter={globalStateFilter}
          setGlobalStateFilter={handleStateFilter}
          globalConstituencyId={globalConstituencyId}
          onSelectSignal={setActiveSignal} // NEW: Pass to Left Pane
        />
      </aside>

      <aside style={{ position: "fixed", top: TOPBAR_H, right: 0, width: SIDEBAR_W, bottom: BOTTOMBAR_H, zIndex: 20, background: "rgba(255,255,255,0.92)", backdropFilter: "blur(8px)", borderLeft: "1px solid #e4e4e7", overflowY: "auto" }}>
        <IntelPane
          globalStateFilter={globalStateFilter}
          setGlobalStateFilter={handleStateFilter}
          globalConstituencyId={globalConstituencyId}
          setGlobalConstituencyId={setGlobalConstituencyId}
        />
      </aside>

      <MapControls onFlyToState={(s) => handleStateFilter(s === "India" ? "ALL" : s)} />
      <BottomBar />

      {/* NEW: Render the Popup here so it floats above everything */}
      {activeSignal && <SignalModal signal={activeSignal} onClose={() => setActiveSignal(null)} />}
    </>
  );
}