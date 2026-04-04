"use client";

import { useState } from "react";
import { Radio, ChevronDown, ChevronUp } from "lucide-react";
import SignalCard from "./SignalCard";
import MorningBriefing from "./MorningBriefing";
import { useLiveData } from "@/lib/context/LiveDataContext";
import { STATE_META } from "@/lib/utils/states";

export default function SignalPane({ globalStateFilter, setGlobalStateFilter, globalConstituencyId, onSelectSignal }: any) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ briefing: false, signals: false });
  const { signals, constituencies } = useLiveData();

  const liveStates = Array.from(new Set(constituencies.map((c: any) => c.state))).filter(Boolean) as string[];

  const filteredSignals = signals.filter((s: any) => {
    if (globalConstituencyId) return s.constituency_id === globalConstituencyId;
    if (globalStateFilter !== "ALL") return s.state === globalStateFilter;
    return true;
  }).sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <aside className="flex flex-col h-full w-full overflow-hidden bg-[#ffffff] border-r border-[#e4e4e7]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#e4e4e7] shrink-0">
        <div className="flex items-center gap-2">
          <Radio className="h-3.5 w-3.5 text-[#16a34a] animate-pulse" />
          <span className="font-mono text-xs font-bold text-[#16a34a] tracking-wider">
            {globalConstituencyId ? "LOCAL INTEL" : "SIGNAL FEED"}
          </span>
        </div>
        <span className="font-mono text-[10px] text-[#71717a]">{filteredSignals.length} ITEMS</span>
      </div>

      {!globalConstituencyId && (
        <div className="flex gap-1 px-2 py-1.5 border-b border-[#e4e4e7] overflow-x-auto shrink-0">
          <button onClick={() => setGlobalStateFilter("ALL")} className={`px-2 py-0.5 font-mono text-[10px] rounded transition-colors shrink-0 ${globalStateFilter === "ALL" ? "bg-[#16a34a]/10 text-[#16a34a]" : "text-[#71717a]"}`}>ALL</button>
          {liveStates.map((state) => {
            const meta = STATE_META[state];
            const isActive = globalStateFilter === state;
            return (
              <button
                key={state}
                onClick={() => setGlobalStateFilter(state)}
                style={{ backgroundColor: isActive ? `${meta?.color}20` : 'transparent', color: isActive ? meta?.color : '#71717a' }}
                className="px-2 py-0.5 font-mono text-[10px] font-bold rounded transition-colors shrink-0"
              >
                {meta?.abbr || state}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <div className="border-b border-[#e4e4e7]">
          <button onClick={() => setCollapsed({ ...collapsed, briefing: !collapsed.briefing })} className="flex items-center justify-between w-full px-3 py-1.5 hover:bg-[#f4f4f5]">
            <span className="font-mono text-[10px] text-[#52525b] tracking-wider">◆ AI BRIEFING</span>
            {collapsed.briefing ? <ChevronDown className="h-3 w-3 text-[#71717a]" /> : <ChevronUp className="h-3 w-3 text-[#71717a]" />}
          </button>
          {!collapsed.briefing && <MorningBriefing />}
        </div>

        <div>
          <button onClick={() => setCollapsed({ ...collapsed, signals: !collapsed.signals })} className="flex items-center justify-between w-full px-3 py-1.5 hover:bg-[#f4f4f5] border-b border-[#e4e4e7]">
            <span className="font-mono text-[10px] text-[#52525b] tracking-wider">◆ INTELLIGENCE FEED</span>
            {collapsed.signals ? <ChevronDown className="h-3 w-3 text-[#71717a]" /> : <ChevronUp className="h-3 w-3 text-[#71717a]" />}
          </button>
          {!collapsed.signals && (
            <div className="flex flex-col">
              {filteredSignals.map((signal: any) => (
                <SignalCard key={signal.id} signal={signal} onClick={() => onSelectSignal(signal)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}