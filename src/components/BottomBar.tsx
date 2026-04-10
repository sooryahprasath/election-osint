"use client";

import { useState } from "react";
import { Wifi, MapPin, Users, Signal, Settings2, X, Clock } from "lucide-react";

const GithubIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.24c3-.34 6-1.5 6-6.6a5.5 5.5 0 0 0-1.5-3.8 5.4 5.4 0 0 0-.15-3.8s-1.18-.38-3.9 1.4a13.4 13.4 0 0 0-7 0c-2.72-1.78-3.9-1.4-3.9-1.4a5.4 5.4 0 0 0-.15 3.8 5.5 5.5 0 0 0-1.5 3.8c0 5.1 3 6.26 6 6.6a4.8 4.8 0 0 0-1 3.24v4" />
    <path d="M9 18c-4.51 2-5-2-7-2" />
  </svg>
);
import { useLiveData } from "@/lib/context/LiveDataContext";
import { ELECTION_DATES } from "@/lib/utils/countdown";

/** IST wall times on a polling date for war-room UI tests */
const IST = (iso: string) => new Date(iso);

export default function BottomBar() {
  const { constituencies, signals, candidates, setSimulatedDate, setOperationMode, simulatedDate } = useLiveData();
  const [showDevMenu, setShowDevMenu] = useState(false);

  const ENABLE_DEV_MENU = process.env.NEXT_PUBLIC_ENABLE_DEV_MENU === "true";

  const handleReset = () => {
    setSimulatedDate(null);
    setOperationMode("PRE-POLL");
  };

  return (
    <>
      <footer className="fixed bottom-0 left-0 right-0 z-50 hidden h-7 items-center justify-between border-t border-[color:var(--border)] bg-[var(--surface-1)] px-3 font-mono text-[10px] select-none md:flex">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            <Wifi className="h-3 w-3 text-[#16a34a]" />
            <span className="text-[#16a34a]">SYS.ONLINE</span>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-5">
          <div className="flex items-center gap-1"><Signal className="h-3 w-3 text-[#ea580c]" /><span className="text-[var(--text-secondary)]">SIGNALS: <span className="text-[#ea580c]">{signals.length}</span></span></div>
          <div className="flex items-center gap-1"><MapPin className="h-3 w-3 text-[#0284c7]" /><span className="text-[var(--text-secondary)]">CONSTITUENCIES: <span className="text-[#0284c7]">{constituencies.length}</span></span></div>
          <div className="flex items-center gap-1"><Users className="h-3 w-3 text-[#16a34a]" /><span className="text-[var(--text-secondary)]">CANDIDATES: <span className="text-[#16a34a]">{candidates.length}</span></span></div>
        </div>

        <div className="flex items-center gap-3 text-[var(--text-muted)]">
          <span className="hidden md:inline">SRC: ECI / ADR / MyNeta</span>
          <span className="hidden md:inline text-[color:var(--border)]">|</span>

          <a
            href="https://github.com/sooryahprasath/election-osint"
            target="_blank"
            rel="noopener noreferrer"
            className="flex shrink-0 items-center text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
            title="View source on GitHub"
          >
            <GithubIcon className="h-3.5 w-3.5" />
          </a>

          {ENABLE_DEV_MENU ? (
            <button
              type="button"
              aria-label="Developer menu"
              onClick={() => setShowDevMenu(!showDevMenu)}
              className="flex items-center text-[#71717a] transition-colors hover:text-[#16a34a]"
            >
              <Settings2 className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      </footer>

      {showDevMenu && ENABLE_DEV_MENU && (
        <div className="fixed bottom-2 right-2 md:bottom-[32px] bg-white border border-[#e4e4e7] rounded-lg shadow-xl p-3 w-[min(22rem,calc(100vw-1rem))] z-[60] animate-fade-in-up max-h-[70vh] overflow-y-auto">
          <div className="flex justify-between items-center mb-2 border-b border-[#e4e4e7] pb-1">
            <span className="font-mono text-[10px] font-bold text-[#dc2626] flex items-center gap-1">
              <Clock className="h-3 w-3" /> DEV / WAR ROOM
            </span>
            <button type="button" aria-label="Close" onClick={() => setShowDevMenu(false)}>
              <X className="h-3 w-3 text-[#71717a]" />
            </button>
          </div>

          <p className="font-mono text-[8px] text-[#71717a] mb-2 leading-relaxed">
            Set <code className="bg-[#f4f4f5] px-0.5 rounded">NEXT_PUBLIC_ENABLE_DEV_MENU=true</code> to show this menu. Simulated IST is used by the timeline + voting HUD.
          </p>
          {simulatedDate && (
            <p className="font-mono text-[8px] text-[#0284c7] mb-2" suppressHydrationWarning>
              Simulated: {simulatedDate.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
            </p>
          )}

          <span className="font-mono text-[8px] font-bold text-[#52525b] mb-1 block">RESET</span>
          <button
            type="button"
            onClick={handleReset}
            className="w-full text-left py-1.5 px-2 mb-3 hover:bg-[#f4f4f5] rounded font-mono text-[9px] font-bold border border-[#e4e4e7]"
          >
            Real time · PRE-POLL
          </button>

          <span className="font-mono text-[8px] font-bold text-[#52525b] mb-1 block">VOTING DAY · PHASE 1 (09 Apr 2026)</span>
          <div className="flex flex-col gap-1 font-mono text-[9px] mb-3">
            <button type="button" onClick={() => { setSimulatedDate(IST("2026-04-09T10:30:00+05:30")); setOperationMode("VOTING_DAY"); }} className="text-left py-1.5 px-2 hover:bg-[#f0f9ff] rounded text-[#0284c7] border border-[#e0f2fe]">
              10:30 IST — live turnout window
            </button>
            <button type="button" onClick={() => { setSimulatedDate(IST("2026-04-09T18:45:00+05:30")); setOperationMode("VOTING_DAY"); }} className="text-left py-1.5 px-2 hover:bg-[#fffbeb] rounded text-[#b45309] border border-[#fef3c7]">
              18:45 IST — final turnout pass
            </button>
            <button
              type="button"
              onClick={() => {
                setSimulatedDate(IST("2026-04-29T19:30:00+05:30"));
                setOperationMode("VOTING_DAY");
              }}
              className="text-left py-1.5 px-2 hover:bg-[#fff7ed] rounded text-[#c2410c] border border-[#ffedd5]"
            >
              29 Apr 19:30 IST — exit poll tab (embargo lifted)
            </button>
          </div>

          <span className="font-mono text-[8px] font-bold text-[#52525b] mb-1 block">OTHER POLL DATES (07:00 IST)</span>
          <div className="flex flex-col gap-1 font-mono text-[9px] mb-3">
            <button type="button" onClick={() => { setSimulatedDate(ELECTION_DATES.phase2); setOperationMode("VOTING_DAY"); }} className="text-left py-1.5 px-2 hover:bg-[#f4f4f5] rounded border border-[#e4e4e7]">
              Phase 2 — Apr 23 (TN + WB)
            </button>
            <button type="button" onClick={() => { setSimulatedDate(ELECTION_DATES.phase2b); setOperationMode("VOTING_DAY"); }} className="text-left py-1.5 px-2 hover:bg-[#f4f4f5] rounded border border-[#e4e4e7]">
              Phase 2B — Apr 29 (WB)
            </button>
            <button type="button" onClick={() => { setSimulatedDate(ELECTION_DATES.counting); setOperationMode("COUNTING_DAY"); }} className="text-left py-1.5 px-2 hover:bg-[#f4f4f5] rounded text-[#ea580c] border border-[#e4e4e7]">
              Counting — May 4
            </button>
          </div>
        </div>
      )}
    </>
  );
}