"use client";

import { useState } from "react";
import {
  Radio,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import SignalCard from "./SignalCard";
import MorningBriefing from "./MorningBriefing";
import { useLiveData } from "@/lib/context/LiveDataContext";

export default function SignalPane({ 
  globalStateFilter, 
  setGlobalStateFilter 
}: { 
  globalStateFilter: string; 
  setGlobalStateFilter: (s: string) => void; 
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    briefing: false,
    timeline: false,
    signals: false,
  });

  const { signals, constituencies } = useLiveData();
  
  const liveStates = Array.from(new Set(constituencies.map((c: any) => c.state))).filter(Boolean) as string[];

  const filteredSignals =
    globalStateFilter === "ALL"
      ? signals
      : signals.filter((s: Record<string, any>) => s.state === globalStateFilter);

  const sortedSignals = [...filteredSignals].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const toggleSection = (key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <aside className="flex flex-col h-full w-full overflow-hidden bg-[#ffffff] border-r border-[#e4e4e7]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#e4e4e7] shrink-0">
        <div className="flex items-center gap-2">
          <Radio className="h-3.5 w-3.5 text-[#16a34a] animate-pulse" />
          <span className="font-mono text-xs font-bold text-[#16a34a] tracking-wider">
            SIGNAL FEED
          </span>
        </div>
        <span className="font-mono text-[10px] text-[#71717a]">
          {sortedSignals.length} ITEMS
        </span>
      </div>

      {/* State Filter */}
      <div className="flex gap-1 px-2 py-1.5 border-b border-[#e4e4e7] overflow-x-auto shrink-0">
        <button
          onClick={() => setGlobalStateFilter("ALL")}
          className={`px-2 py-0.5 font-mono text-[10px] rounded transition-colors shrink-0 ${
            globalStateFilter === "ALL"
              ? "bg-[#16a34a]/10 text-[#16a34a] border border-[#16a34a]/30"
              : "text-[#71717a] hover:text-[#52525b] border border-transparent"
          }`}
        >
          ALL
        </button>
        {liveStates.map((state) => (
          <button
            key={state}
            onClick={() => setGlobalStateFilter(state)}
            className={`px-2 py-0.5 font-mono text-[10px] rounded transition-colors shrink-0 ${
              globalStateFilter === state
                ? "bg-[#16a34a]/10 text-[#16a34a] border border-[#16a34a]/30"
                : "text-[#71717a] hover:text-[#52525b] border border-transparent"
            }`}
          >
            {state.toUpperCase().slice(0, 3)}
          </button>
        ))}
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Morning Briefing Section */}
        <div className="border-b border-[#e4e4e7]">
          <button
            onClick={() => toggleSection("briefing")}
            className="flex items-center justify-between w-full px-3 py-1.5 text-left hover:bg-[#f4f4f5] transition-colors"
          >
            <span className="font-mono text-[10px] text-[#52525b] tracking-wider">
              ◆ MORNING BRIEFING
            </span>
            {collapsed.briefing ? (
              <ChevronDown className="h-3 w-3 text-[#71717a]" />
            ) : (
              <ChevronUp className="h-3 w-3 text-[#71717a]" />
            )}
          </button>
          {!collapsed.briefing && <MorningBriefing />}
        </div>



        {/* Signals List */}
        <div>
          <button
            onClick={() => toggleSection("signals")}
            className="flex items-center justify-between w-full px-3 py-1.5 text-left hover:bg-[#f4f4f5] transition-colors border-b border-[#e4e4e7]"
          >
            <span className="font-mono text-[10px] text-[#52525b] tracking-wider">
              ◆ INTELLIGENCE FEED
            </span>
            {collapsed.signals ? (
              <ChevronDown className="h-3 w-3 text-[#71717a]" />
            ) : (
              <ChevronUp className="h-3 w-3 text-[#71717a]" />
            )}
          </button>
          {!collapsed.signals && (
            <div className="flex flex-col">
              {sortedSignals.map((signal) => (
                <SignalCard key={signal.id} signal={signal} />
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
