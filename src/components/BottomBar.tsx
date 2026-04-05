"use client";

import { useState } from "react";
import { Database, Wifi, MapPin, Users, Signal, Settings2, X, Clock, ShieldAlert } from "lucide-react";
import { useLiveData } from "@/lib/context/LiveDataContext";
import { ELECTION_DATES } from "@/lib/utils/countdown";

export default function BottomBar() {
  const { constituencies, signals, candidates, isConnected, setSimulatedDate, operationMode, setOperationMode } = useLiveData();
  const [showDevMenu, setShowDevMenu] = useState(false);

  // Check ENV to see if we should show the secret menu (Defaults to false if not set)
  const ENABLE_DEV_MENU = process.env.NEXT_PUBLIC_ENABLE_DEV_MENU !== "false";

  const handleReset = () => {
    setSimulatedDate(null);
    setOperationMode("PRE-POLL");
  };

  return (
    <>
      <footer className="fixed bottom-0 left-0 right-0 z-50 flex h-7 items-center justify-between border-t border-[#e4e4e7] bg-[#ffffff] px-3 font-mono text-[10px] select-none">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            <Wifi className="h-3 w-3 text-[#16a34a]" />
            <span className="text-[#16a34a]">SYS.ONLINE</span>
          </div>
          {operationMode !== "PRE-POLL" && (
            <div className="flex items-center gap-1 px-1.5 py-0.5 bg-[#dc2626] text-white rounded">
              <ShieldAlert className="h-3 w-3" /> MODE: {operationMode}
            </div>
          )}
        </div>

        <div className="hidden md:flex items-center gap-5">
          <div className="flex items-center gap-1"><Signal className="h-3 w-3 text-[#ea580c]" /><span className="text-[#52525b]">SIGNALS: <span className="text-[#ea580c]">{signals.length}</span></span></div>
          <div className="flex items-center gap-1"><MapPin className="h-3 w-3 text-[#0284c7]" /><span className="text-[#52525b]">CONSTITUENCIES: <span className="text-[#0284c7]">{constituencies.length}</span></span></div>
          <div className="flex items-center gap-1"><Users className="h-3 w-3 text-[#16a34a]" /><span className="text-[#52525b]">CANDIDATES: <span className="text-[#16a34a]">{candidates.length}</span></span></div>
        </div>

        <div className="flex items-center gap-2 text-[#71717a]">
          <span className="hidden md:inline">SRC: ECI / ADR / MyNeta</span>
          <span className="hidden md:inline text-[#e4e4e7]">|</span>

          {ENABLE_DEV_MENU ? (
            <button onClick={() => setShowDevMenu(!showDevMenu)} className="hover:text-[#16a34a] transition-colors flex items-center gap-1">
              v0.1.0-alpha <Settings2 className="h-3 w-3" />
            </button>
          ) : (
            <span>v0.1.0-alpha</span>
          )}
        </div>
      </footer>

      {showDevMenu && ENABLE_DEV_MENU && (
        <div className="fixed bottom-[32px] right-2 bg-white border border-[#e4e4e7] rounded shadow-xl p-3 w-72 z-[60] animate-fade-in-up">
          <div className="flex justify-between items-center mb-2 border-b border-[#e4e4e7] pb-1">
            <span className="font-mono text-[10px] font-bold text-[#dc2626] flex items-center gap-1"><Clock className="h-3 w-3" /> WAR ROOM OVERRIDES</span>
            <button onClick={() => setShowDevMenu(false)}><X className="h-3 w-3 text-[#71717a]" /></button>
          </div>

          <span className="font-mono text-[8px] text-[#71717a] mb-1 block">TIME MACHINE:</span>
          <div className="flex flex-col gap-1 font-mono text-[9px] mb-3">
            <button onClick={handleReset} className="text-left py-1.5 px-2 hover:bg-[#f4f4f5] rounded text-[#52525b] font-bold border border-[#e4e4e7]">1. RESET TO REAL TIME</button>
            <button onClick={() => { setSimulatedDate(ELECTION_DATES.phase1); setOperationMode("VOTING_DAY"); }} className="text-left py-1.5 px-2 hover:bg-[#f4f4f5] rounded text-[#0284c7]">2. VOTING DAY 1 (APR 9)</button>
            <button onClick={() => { setSimulatedDate(ELECTION_DATES.phase2); setOperationMode("VOTING_DAY"); }} className="text-left py-1.5 px-2 hover:bg-[#f4f4f5] rounded text-[#0284c7]">3. VOTING DAY 2 (APR 23)</button>
            <button onClick={() => { setSimulatedDate(ELECTION_DATES.phase2b); setOperationMode("VOTING_DAY"); }} className="text-left py-1.5 px-2 hover:bg-[#f4f4f5] rounded text-[#0284c7]">4. VOTING DAY 2B (APR 29)</button>
            <button onClick={() => { setSimulatedDate(ELECTION_DATES.counting); setOperationMode("COUNTING_DAY"); }} className="text-left py-1.5 px-2 hover:bg-[#f4f4f5] rounded text-[#ea580c]">5. COUNTING DAY (MAY 4)</button>
          </div>
        </div>
      )}
    </>
  );
}