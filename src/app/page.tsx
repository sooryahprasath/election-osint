"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Radio, Map as MapIcon, Database, ActivitySquare } from "lucide-react";
import TopBar from "@/components/TopBar";
import BottomBar from "@/components/BottomBar";
import SignalPane from "@/components/signals/SignalPane";
import IntelPane from "@/components/intel/IntelPane";
import SignalModal from "@/components/signals/SignalModal";
import VotingHud from "@/components/warroom/VotingHud";
import { useLiveData } from "@/lib/context/LiveDataContext";

// FIX: Added the missing '/' after '@' in the import path
const IndiaMap = dynamic(() => import("@/components/map/IndiaMap"), { ssr: false });
const TOPBAR_H = 36; const BOTTOMBAR_H = 28; const SIDEBAR_W = 280;

export default function Home() {
  const { operationMode } = useLiveData();
  const [flyToState, setFlyToState] = useState<string | null>(null);
  const [globalStateFilter, setGlobalStateFilter] = useState<string>("ALL");
  const [globalConstituencyId, setGlobalConstituencyId] = useState<string | null>(null);
  const [activeSignal, setActiveSignal] = useState<any | null>(null);
  const [mobilePane, setMobilePane] = useState<"signals" | "map" | "intel" | "warroom">("map");

  const handleStateFilter = (s: string) => {
    setGlobalStateFilter(s);
    setGlobalConstituencyId(null);
    setFlyToState(s === "ALL" ? "India" : s);
  };

  return (
    <>
      <IndiaMap flyToState={flyToState} activeState={globalStateFilter} activeConstituencyId={globalConstituencyId} onSelectConstituency={id => { setGlobalConstituencyId(id); if (window.innerWidth < 768) setMobilePane("intel"); }} onSelectState={handleStateFilter} onSelectSignal={setActiveSignal} />
      <TopBar />

      {/* THE NEW WAR ROOM HUD (Passes Mobile Toggle Prop) */}
      <VotingHud isMobileOpen={mobilePane === "warroom"} onCloseMobile={() => setMobilePane("map")} />

      <aside className={`fixed top-[36px] bottom-[76px] md:bottom-[28px] left-0 w-full md:w-[280px] z-40 bg-white/95 backdrop-blur-md border-r border-[#e4e4e7] transition-transform duration-300 ${mobilePane === "signals" ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}>
        <SignalPane globalStateFilter={globalStateFilter} setGlobalStateFilter={handleStateFilter} globalConstituencyId={globalConstituencyId} onSelectSignal={setActiveSignal} />
      </aside>

      <aside className={`fixed top-[36px] bottom-[76px] md:bottom-[28px] right-0 w-full md:w-[280px] z-40 bg-white/95 backdrop-blur-md border-l border-[#e4e4e7] transition-transform duration-300 ${mobilePane === "intel" ? "translate-x-0" : "translate-x-full md:translate-x-0"}`}>
        <IntelPane globalStateFilter={globalStateFilter} setGlobalStateFilter={handleStateFilter} globalConstituencyId={globalConstituencyId} setGlobalConstituencyId={setGlobalConstituencyId} />
      </aside>

      <div className="md:hidden fixed bottom-[28px] left-0 right-0 h-[48px] bg-white border-t border-[#e4e4e7] z-50 flex shadow-lg">
        <button onClick={() => setMobilePane('signals')} className={`flex-1 flex flex-col items-center justify-center gap-1 font-mono text-[10px] ${mobilePane === 'signals' ? 'text-[#16a34a] bg-[#16a34a]/10 border-t-2 border-[#16a34a]' : 'text-[#71717a]'}`}><Radio className="h-4 w-4" /> SIGNALS</button>
        <button onClick={() => setMobilePane('map')} className={`flex-1 flex flex-col items-center justify-center gap-1 font-mono text-[10px] ${mobilePane === 'map' ? 'text-[#0284c7] bg-[#0284c7]/10 border-t-2 border-[#0284c7]' : 'text-[#71717a]'}`}><MapIcon className="h-4 w-4" /> MAP</button>
        <button onClick={() => setMobilePane('intel')} className={`flex-1 flex flex-col items-center justify-center gap-1 font-mono text-[10px] ${mobilePane === 'intel' ? 'text-[#ea580c] bg-[#ea580c]/10 border-t-2 border-[#ea580c]' : 'text-[#71717a]'}`}><Database className="h-4 w-4" /> INTEL</button>

        {/* Mobile War Room Button */}
        {operationMode !== "PRE-POLL" && (
          <button
            onClick={() => setMobilePane(mobilePane === 'warroom' ? 'map' : 'warroom')}
            className={`flex-1 flex flex-col items-center justify-center gap-1 font-mono text-[10px] ${mobilePane === 'warroom' ? 'text-[#dc2626] bg-[#dc2626]/10 border-t-2 border-[#dc2626]' : 'text-[#71717a]'}`}
          >
            <ActivitySquare className="h-4 w-4" />
            {operationMode === "VOTING_DAY" ? "VOTING LIVE" : "COUNTING LIVE"}
          </button>
        )}
      </div>

      <BottomBar />
      {activeSignal && <SignalModal signal={activeSignal} onClose={() => setActiveSignal(null)} />}
    </>
  );
}