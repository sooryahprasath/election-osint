"use client";

import { useState, useMemo } from "react";
import { Search, Filter, ChevronRight, AlertTriangle, HelpCircle, Activity } from "lucide-react";
import { useLiveData } from "@/lib/context/LiveDataContext";
import ConstituencyCard from "./ConstituencyCard";
import StateOverview from "./StateOverview";
import PhaseTimeline from "../signals/PhaseTimeline";
import { STATE_META } from "@/lib/utils/states";

type SortMode = "VOLATILITY" | "NAME" | "PHASE";

export default function IntelPane({ globalStateFilter, setGlobalStateFilter, globalConstituencyId, setGlobalConstituencyId }: any) {
  const [searchQuery, setSearchQuery] = useState("");
  const [partyFilter, setPartyFilter] = useState("ALL");
  const [sortMode, setSortMode] = useState<SortMode>("VOLATILITY");
  const { constituencies, candidates, signals } = useLiveData();

  const activeState = globalStateFilter;
  const SHOW_PENDING_BANNER = process.env.NEXT_PUBLIC_SHOW_PENDING_BANNER !== "false";
  const isPendingState = SHOW_PENDING_BANNER && (activeState === "Tamil Nadu" || activeState === "West Bengal" || activeState === "ALL");

  const stateConstituencies = activeState === "ALL" ? constituencies : constituencies.filter((c: any) => c.state === activeState);

  const hotspots = useMemo(() => {
    // "Volatility delta" proxy: compare last 6h signal severity sum vs previous 6h
    const now = Date.now();
    const h6 = 6 * 60 * 60 * 1000;
    const recentFrom = now - h6;
    const prevFrom = now - 2 * h6;

    const constById = new Map<string, any>();
    for (const c of constituencies) constById.set(String(c.id), c);

    const allowedConstIds = new Set(stateConstituencies.map((c: any) => String(c.id)));

    const scoreRecent = new Map<string, number>();
    const scorePrev = new Map<string, number>();

    for (const s of signals as any[]) {
      const cid = s.constituency_id ? String(s.constituency_id) : "";
      if (!cid || !allowedConstIds.has(cid)) continue;
      const ts = Date.parse(s.created_at || "") || 0;
      if (!ts) continue;
      const sev = Number(s.severity || 1);
      if (ts >= recentFrom && ts <= now) {
        scoreRecent.set(cid, (scoreRecent.get(cid) || 0) + sev);
      } else if (ts >= prevFrom && ts < recentFrom) {
        scorePrev.set(cid, (scorePrev.get(cid) || 0) + sev);
      }
    }

    const rows: { id: string; name: string; delta: number; recent: number }[] = [];
    for (const cid of allowedConstIds) {
      const recent = scoreRecent.get(cid) || 0;
      const prev = scorePrev.get(cid) || 0;
      const delta = recent - prev;
      if (recent <= 0) continue;
      const c = constById.get(cid);
      rows.push({ id: cid, name: c?.name || cid, delta, recent });
    }
    rows.sort((a, b) => (b.delta - a.delta) || (b.recent - a.recent));
    return rows.slice(0, 5);
  }, [signals, constituencies, stateConstituencies]);

  // FIX: Dynamic Party Filter based ONLY on the currently viewed state's candidates
  const uniqueParties = useMemo(() => {
    const validConstIds = new Set(stateConstituencies.map((c: any) => c.id));
    const localCands = candidates.filter((c: any) => validConstIds.has(c.constituency_id));
    const rawParties = localCands.map((c: any) => c.party ? c.party.toUpperCase() : "");
    return Array.from(new Set(rawParties)).filter(p => p !== "" && p !== "IND" && p !== "INDEPENDENT").sort();
  }, [candidates, stateConstituencies]);

  const filtered = stateConstituencies.filter((c: any) => {
    const candsInConst = candidates.filter(cand => cand.constituency_id === c.id);
    const matchesConstName = c.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCandName = candsInConst.some(cand => cand.name.toLowerCase().includes(searchQuery.toLowerCase()));

    let matchesParty = true;
    if (partyFilter === "IND") {
      matchesParty = candsInConst.some(cand => cand.is_independent);
    } else if (partyFilter !== "ALL") {
      matchesParty = candsInConst.some(cand => cand.party?.toUpperCase() === partyFilter);
    }

    if (partyFilter !== "ALL" && !matchesParty) return false;
    if (searchQuery && !matchesConstName && !matchesCandName) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortMode === "VOLATILITY") return (b.volatility_score || 0) - (a.volatility_score || 0);
    if (sortMode === "NAME") return a.name.localeCompare(b.name);
    if (sortMode === "PHASE") return (a.phase || 0) - (b.phase || 0);
    return 0;
  });

  const selectedConstituency = globalConstituencyId ? constituencies.find((c: any) => c.id === globalConstituencyId) || null : null;

  if (selectedConstituency) {
    return (
      <aside className="flex flex-col h-full w-full overflow-hidden bg-[#ffffff] border-l border-[#e4e4e7]">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#e4e4e7] shrink-0">
          <button onClick={() => setGlobalConstituencyId(null)} className="font-mono text-[10px] text-[#16a34a] hover:text-[#16a34a]/80 transition-colors">← BACK</button>
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
          onClick={() => { setGlobalStateFilter("ALL"); setSearchQuery(""); setGlobalConstituencyId(null); setPartyFilter("ALL"); }}
          style={{ color: activeState === "ALL" ? "#16a34a" : "#71717a", borderBottomColor: activeState === "ALL" ? "#16a34a" : "transparent", backgroundColor: activeState === "ALL" ? "#16a34a15" : "transparent" }}
          className="flex-1 min-w-[50px] px-2 py-1.5 font-mono text-[10px] font-bold transition-colors border-b-2 hover:bg-[#f4f4f5]"
        >ALL</button>

        {Array.from(new Set(constituencies.map((c: any) => c.state))).filter(Boolean).map((state: any) => {
          const meta = STATE_META[state];
          const isActive = activeState === state;
          return (
            <button
              key={state}
              onClick={() => { setGlobalStateFilter(state); setSearchQuery(""); setGlobalConstituencyId(null); setPartyFilter("ALL"); }}
              style={{ color: isActive ? meta?.color : "#71717a", borderBottomColor: isActive ? meta?.color : "transparent", backgroundColor: isActive ? `${meta?.color}10` : "transparent" }}
              className="flex-1 min-w-[40px] px-2 py-1.5 font-mono text-[10px] font-bold transition-colors border-b-2 hover:bg-[#f4f4f5]"
            >
              <div className="truncate">{meta?.abbr || state}</div>
            </button>
          );
        })}
      </div>

      <StateOverview state={activeState} />

      <div className="border-b border-[#e4e4e7] shrink-0">
        <div className="px-3 py-2 bg-[#f8fafc] flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] font-bold text-[#52525b] tracking-wider flex items-center gap-1.5">
            <Activity className="h-3 w-3 text-[#dc2626] shrink-0" />
            <span className="flex items-center gap-1">
              HOTSPOTS (LAST 6H)
              <span className="group relative cursor-help">
                <HelpCircle className="h-2.5 w-2.5 text-[#a1a1aa]" />
                <span className="absolute left-0 top-full mt-1 hidden group-hover:block bg-zinc-800 text-white text-[8px] font-normal tracking-normal p-2 rounded w-[220px] z-50 shadow-lg leading-snug normal-case">
                  Constituencies where the sum of signal severities in the last 6 hours exceeds the prior 6-hour window (activity spike). Only rows with a resolved constituency_id are counted.
                </span>
              </span>
            </span>
          </span>
          <span className="font-mono text-[9px] text-[#a1a1aa] shrink-0">TAP TO FOCUS</span>
        </div>
        {hotspots.length > 0 ? (
          <div className="px-2 pb-2">
            {hotspots.map((h) => (
              <button
                key={h.id}
                onClick={() => {
                  if (activeState === "ALL") {
                    const c = constituencies.find((x: any) => x.id === h.id);
                    if (c?.state) setGlobalStateFilter(c.state);
                    setTimeout(() => setGlobalConstituencyId(h.id), 50);
                  } else {
                    setGlobalConstituencyId(h.id);
                  }
                }}
                className="w-full flex items-center gap-2 px-2 py-2 rounded hover:bg-[#f4f4f5] transition-colors text-left"
              >
                <div className={`h-2 w-2 rounded-full shrink-0 ${h.delta >= 3 ? "bg-[#dc2626]" : h.delta >= 1 ? "bg-[#ea580c]" : "bg-[#16a34a]"}`} />
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[10px] text-[#27272a] truncate">{h.name}</div>
                  <div className="font-mono text-[8px] text-[#71717a]">
                    Δ {h.delta >= 0 ? `+${h.delta}` : h.delta} • Severity sum: {h.recent}
                  </div>
                </div>
                <ChevronRight className="h-3 w-3 text-[#71717a] shrink-0" />
              </button>
            ))}
          </div>
        ) : (
          <div className="px-3 py-2 font-mono text-[10px] text-[#a1a1aa]">
            No hotspots detected for this sector yet.
          </div>
        )}
      </div>

      {isPendingState && (
        <div className="bg-[#fef08a] border-b border-[#facc15] px-3 py-2 flex items-start gap-2.5 shrink-0 shadow-sm">
          <AlertTriangle className="h-4 w-4 text-[#ca8a04] shrink-0 mt-0.5" />
          <p className="font-mono text-[9px] font-bold text-[#a16207] leading-tight">
            ECI NOMINATION DATA PENDING FOR TN & WB.<br />AWAITING FINAL AFFIDAVIT PUBLICATION.
          </p>
        </div>
      )}

      <div className="border-b border-[#e4e4e7] shrink-0">
        <PhaseTimeline />
      </div>

      <div className="px-2 py-1.5 border-b border-[#e4e4e7] shrink-0 flex flex-col gap-1.5 bg-[#f8fafc]">
        <div className="flex items-center gap-1.5 px-2 py-1 bg-white border border-[#e4e4e7] rounded text-[10px]">
          <Search className="h-3 w-3 text-[#71717a] shrink-0" />
          <input type="text" placeholder="Search candidate or constituency..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="flex-1 bg-transparent text-[#27272a] placeholder-[#a1a1aa] outline-none font-mono text-[10px]" />
        </div>
        <div className="flex items-center gap-1">
          <Filter className="h-2.5 w-2.5 text-[#71717a] shrink-0 ml-1" />
          <select value={partyFilter} onChange={(e) => setPartyFilter(e.target.value)} className="flex-1 bg-white border border-[#e4e4e7] rounded px-1 py-1 font-mono text-[9px] font-bold text-[#52525b] outline-none">
            <option value="ALL">ALL PARTIES</option>
            {uniqueParties.map(party => (
              <option key={party} value={party}>{party}</option>
            ))}
            <option value="IND">INDEPENDENTS</option>
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-2 py-1.5 flex justify-between items-center bg-[#f4f4f5] border-b border-[#e4e4e7]">
          <span className="font-mono text-[8px] text-[#71717a] tracking-wider flex items-center gap-1">
            SORT METRIC
            <span className="group relative cursor-help">
              <HelpCircle className="h-2 w-2" />
              <div className="absolute left-0 top-full mt-1 hidden group-hover:block bg-zinc-800 text-white text-[8px] p-2 rounded w-52 z-50 leading-snug normal-case font-normal tracking-normal">
                Stored 0–100 score per constituency from the data pipeline (contest pressure, candidate-risk hints, and severe OSINT signals where wired in). Not a poll; refine the worker formula as ECI/ADR fields land.
              </div>
            </span>
          </span>
          <select value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)} className="bg-transparent font-mono text-[9px] font-bold text-[#52525b] outline-none cursor-pointer">
            <option value="VOLATILITY">VOLATILITY (DESC)</option>
            <option value="NAME">CONSTITUENCY NAME (A-Z)</option>
            <option value="PHASE">ELECTION PHASE</option>
          </select>
        </div>

        {sorted.length > 0 ? sorted.map((c) => (
          <button
            key={c.id}
            onClick={() => {
              if (c.state && c.state !== activeState) {
                // 1. Change the map state first
                setGlobalStateFilter(c.state);

                // 2. Wait 50ms for the parent components to finish their reset logic, 
                // THEN apply the constituency ID so it sticks permanently.
                setTimeout(() => {
                  setGlobalConstituencyId(c.id);
                }, 50);
              } else {
                // If we are already in the correct state view, just set it instantly
                setGlobalConstituencyId(c.id);
              }
            }}
            className="flex items-center w-full px-3 py-2 hover:bg-[#f4f4f5] transition-colors border-b border-[#ffffff] group text-left"
          >
            <div className="h-6 w-1 rounded-full mr-2.5 shrink-0" style={{ backgroundColor: (c.volatility_score || 0) >= 70 ? "#dc2626" : (c.volatility_score || 0) >= 40 ? "#ea580c" : "#16a34a" }} />
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
        )) : (
          <div className="p-6 text-center font-mono text-[10px] text-[#a1a1aa]">No matches found.</div>
        )}
      </div>
    </aside>
  );
}