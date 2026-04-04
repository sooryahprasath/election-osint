"use client";

import { useState } from "react";
import { Search, Filter, ChevronRight } from "lucide-react";
import { useLiveData } from "@/lib/context/LiveDataContext";
import ConstituencyCard from "./ConstituencyCard";
import StateOverview from "./StateOverview";
import PhaseTimeline from "../signals/PhaseTimeline";
import { STATE_META } from "@/lib/utils/states";

type SortMode = "VOLATILITY" | "NAME" | "PHASE";

export default function IntelPane({
  globalStateFilter,
  setGlobalStateFilter,
  globalConstituencyId,
  setGlobalConstituencyId
}: {
  globalStateFilter: string;
  setGlobalStateFilter: (s: string) => void;
  globalConstituencyId: string | null;
  setGlobalConstituencyId: (id: string | null) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("VOLATILITY");
  const { constituencies } = useLiveData();

  // FIX: Do not force "Kerala" if ALL is selected
  const activeState = globalStateFilter;

  // FIX: If ALL is selected, show all constituencies, else filter by state
  const stateConstituencies = activeState === "ALL"
    ? constituencies
    : constituencies.filter((c: any) => c.state === activeState);

  const selectedConstituency = globalConstituencyId
    ? constituencies.find((c: any) => c.id === globalConstituencyId) || null
    : null;

  const filtered = searchQuery
    ? stateConstituencies.filter((c) => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : stateConstituencies;

  const sorted = [...filtered].sort((a, b) => {
    if (sortMode === "VOLATILITY") return (b.volatility_score || 0) - (a.volatility_score || 0);
    if (sortMode === "NAME") return a.name.localeCompare(b.name);
    if (sortMode === "PHASE") return (a.phase || 0) - (b.phase || 0);
    return 0;
  });

  if (selectedConstituency) {
    return (
      <aside className="flex flex-col h-full w-full overflow-hidden bg-[#ffffff] border-l border-[#e4e4e7]">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#e4e4e7] shrink-0">
          <button onClick={() => setGlobalConstituencyId(null)} className="font-mono text-[10px] text-[#16a34a] hover:text-[#16a34a]/80 transition-colors">
            ← BACK
          </button>
          <span className="font-mono text-[10px] text-[#71717a]">/</span>
          <span className="font-mono text-[10px] text-[#52525b] truncate">{selectedConstituency.name.toUpperCase()}</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          <ConstituencyCard constituency={selectedConstituency} />
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex flex-col h-full w-full overflow-hidden bg-[#ffffff] border-l border-[#e4e4e7]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#e4e4e7] shrink-0">
        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-[#0284c7]" />
          <span className="font-mono text-xs font-bold text-[#0284c7] tracking-wider">INTEL PANE</span>
        </div>
        <span className="font-mono text-[10px] text-[#71717a]">{sorted.length} RESULTS</span>
      </div>

      <div className="flex border-b border-[#e4e4e7] overflow-x-auto shrink-0 bg-[#f8fafc]">
        <button
          onClick={() => {
            setGlobalStateFilter("ALL");
            setSearchQuery("");
            setGlobalConstituencyId(null);
          }}
          style={{
            color: activeState === "ALL" ? "#16a34a" : "#71717a",
            borderBottomColor: activeState === "ALL" ? "#16a34a" : "transparent",
            backgroundColor: activeState === "ALL" ? "#16a34a15" : "transparent"
          }}
          className="flex-1 min-w-[50px] px-2 py-1.5 font-mono text-[10px] font-bold transition-colors border-b-2 hover:bg-[#f4f4f5]"
        >
          ALL
        </button>

        {Array.from(new Set(constituencies.map((c: any) => c.state))).map((state: any) => {
          const meta = STATE_META[state];
          const isActive = activeState === state;
          return (
            <button
              key={state}
              onClick={() => {
                setGlobalStateFilter(state);
                setSearchQuery("");
                setGlobalConstituencyId(null);
              }}
              style={{
                color: isActive ? meta.color : "#71717a",
                borderBottomColor: isActive ? meta.color : "transparent",
                backgroundColor: isActive ? `${meta.color}10` : "transparent"
              }}
              className="flex-1 min-w-[40px] px-2 py-1.5 font-mono text-[10px] font-bold transition-colors border-b-2 hover:bg-[#f4f4f5]"
            >
              <div className="truncate">{meta?.abbr || state}</div>
            </button>
          );
        })}
      </div>

      <StateOverview state={activeState} />

      <div className="border-b border-[#e4e4e7] shrink-0">
        <PhaseTimeline />
      </div>

      <div className="px-2 py-1.5 border-b border-[#e4e4e7] shrink-0">
        <div className="flex items-center gap-1.5 px-2 py-1 bg-[#f4f4f5] border border-[#e4e4e7] rounded text-[10px]">
          <Search className="h-3 w-3 text-[#71717a] shrink-0" />
          <input
            type="text"
            placeholder="Search constituency..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent text-[#27272a] placeholder-[#333] outline-none font-mono text-[10px]"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-2 py-1.5 flex justify-between items-center bg-[#f4f4f5] border-b border-[#e4e4e7]">
          <span className="font-mono text-[8px] text-[#71717a] tracking-wider">SORT METRIC:</span>
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="bg-transparent font-mono text-[9px] text-[#52525b] outline-none cursor-pointer"
          >
            <option value="VOLATILITY">VOLATILITY (DESC)</option>
            <option value="NAME">CONSTITUENCY NAME (A-Z)</option>
            <option value="PHASE">ELECTION PHASE</option>
          </select>
        </div>

        {sorted.map((c) => (
          <button
            key={c.id}
            onClick={() => setGlobalConstituencyId(c.id)}
            className="flex items-center w-full px-3 py-2 hover:bg-[#f4f4f5] transition-colors border-b border-[#ffffff] group text-left"
          >
            <div
              className="h-6 w-1 rounded-full mr-2.5 shrink-0"
              style={{ backgroundColor: (c.volatility_score || 0) >= 70 ? "#dc2626" : (c.volatility_score || 0) >= 40 ? "#ea580c" : "#16a34a" }}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-[#27272a] truncate group-hover:text-[#16a34a] transition-colors">{c.name}</span>
                <span className="font-mono text-[8px] text-[#71717a] shrink-0">#{c.id?.split('-')[1] || "0"}</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="font-mono text-[8px] text-[#71717a]">VOL: {(c.volatility_score || 0).toFixed(0)}%</span>
                <span className="font-mono text-[8px] text-[#71717a]">PH-{c.phase}</span>
              </div>
            </div>
            <ChevronRight className="h-3 w-3 text-[#333] group-hover:text-[#71717a] shrink-0 transition-colors" />
          </button>
        ))}
      </div>
    </aside>
  );
}