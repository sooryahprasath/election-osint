"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Radio, Map as MapIcon, Database } from "lucide-react";
import TopBar from "@/components/TopBar";
import BottomBar from "@/components/BottomBar";
import SignalPane from "@/components/signals/SignalPane";
import IntelPane from "@/components/intel/IntelPane";
import SignalModal from "@/components/signals/SignalModal";

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
  const [activeSignal, setActiveSignal] = useState<any | null>(null);
  const [mobilePane, setMobilePane] = useState<"signals" | "map" | "intel">("map");

  const handleStateFilter = (s: string) => {
    setGlobalStateFilter(s);
    setGlobalConstituencyId(null);
    setFlyToState(s === "ALL" ? "India" : s);
  };

  const handleSelectConstituency = (id: string) => {
    setGlobalConstituencyId(id);
    if (window.innerWidth < 768) {
      setMobilePane("intel");
    }
  };

  return (
    <>
      <IndiaMap
        flyToState={flyToState}
        activeState={globalStateFilter}
        activeConstituencyId={globalConstituencyId}
        onSelectConstituency={handleSelectConstituency}
        onSelectState={handleStateFilter}
        onSelectSignal={setActiveSignal}
      />

      <TopBar />

      <aside className={`fixed top-[36px] bottom-[76px] md:bottom-[28px] left-0 w-full md:w-[280px] z-40 bg-white/95 backdrop-blur-md border-r border-[#e4e4e7] transition-transform duration-300 ease-in-out ${mobilePane === "signals" ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}>
        <SignalPane
          globalStateFilter={globalStateFilter}
          setGlobalStateFilter={handleStateFilter}
          globalConstituencyId={globalConstituencyId}
          onSelectSignal={setActiveSignal}
        />
      </aside>

      <aside className={`fixed top-[36px] bottom-[76px] md:bottom-[28px] right-0 w-full md:w-[280px] z-40 bg-white/95 backdrop-blur-md border-l border-[#e4e4e7] transition-transform duration-300 ease-in-out ${mobilePane === "intel" ? "translate-x-0" : "translate-x-full md:translate-x-0"}`}>
        <IntelPane
          globalStateFilter={globalStateFilter}
          setGlobalStateFilter={handleStateFilter}
          globalConstituencyId={globalConstituencyId}
          setGlobalConstituencyId={setGlobalConstituencyId}
        />
      </aside>

      {/* MOBILE BOTTOM NAVIGATION */}
      <div className="md:hidden fixed bottom-[28px] left-0 right-0 h-[48px] bg-white border-t border-[#e4e4e7] z-50 flex shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
        <button onClick={() => setMobilePane('signals')} className={`flex-1 flex flex-col items-center justify-center gap-1 font-mono text-[10px] tracking-wider transition-colors ${mobilePane === 'signals' ? 'text-[#16a34a] bg-[#16a34a]/10 border-t-2 border-[#16a34a]' : 'text-[#71717a] border-t-2 border-transparent'}`}>
          <Radio className="h-4 w-4" /> SIGNALS
        </button>
        <button onClick={() => setMobilePane('map')} className={`flex-1 flex flex-col items-center justify-center gap-1 font-mono text-[10px] tracking-wider transition-colors ${mobilePane === 'map' ? 'text-[#0284c7] bg-[#0284c7]/10 border-t-2 border-[#0284c7]' : 'text-[#71717a] border-t-2 border-transparent'}`}>
          <MapIcon className="h-4 w-4" /> TACTICAL MAP
        </button>
        <button onClick={() => setMobilePane('intel')} className={`flex-1 flex flex-col items-center justify-center gap-1 font-mono text-[10px] tracking-wider transition-colors ${mobilePane === 'intel' ? 'text-[#ea580c] bg-[#ea580c]/10 border-t-2 border-[#ea580c]' : 'text-[#71717a] border-t-2 border-transparent'}`}>
          <Database className="h-4 w-4" /> INTEL PANE
        </button>
      </div>

      <BottomBar />
      {activeSignal && <SignalModal signal={activeSignal} onClose={() => setActiveSignal(null)} />}
    </>
  );
}