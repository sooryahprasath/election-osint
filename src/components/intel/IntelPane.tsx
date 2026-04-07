"use client";

import { useState, useMemo } from "react";
import { Search, Filter, ChevronRight, AlertTriangle, Activity, X } from "lucide-react";
import { useLiveData } from "@/lib/context/LiveDataContext";
import ConstituencyCard from "./ConstituencyCard";
import StateOverview from "./StateOverview";
import IntelHelpTip from "./IntelHelpTip";
import { STATE_META } from "@/lib/utils/states";

type SortMode = "VOLATILITY" | "NAME" | "PHASE";

export default function IntelPane({
  globalStateFilter,
  setGlobalStateFilter,
  globalConstituencyId,
  setGlobalConstituencyId,
  onBackToMap,
}: any) {
  const [searchQuery, setSearchQuery] = useState("");
  const [partyFilter, setPartyFilter] = useState("ALL");
  const [sortMode, setSortMode] = useState<SortMode>("VOLATILITY");
  const [pendingCandidate, setPendingCandidate] = useState<any | null>(null);
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

  const search = searchQuery.trim().toLowerCase();
  const candidateMatches = useMemo(() => {
    if (!search || search.length < 2) return [];
    const allowedConstIds = new Set(stateConstituencies.map((c: any) => String(c.id)));
    const constById = new Map<string, any>();
    for (const c of constituencies) constById.set(String(c.id), c);

    const out: any[] = [];
    for (const cand of candidates as any[]) {
      const cid = String(cand.constituency_id || "");
      if (!cid || !allowedConstIds.has(cid)) continue;
      const name = String(cand.name || "").toLowerCase();
      if (!name.includes(search)) continue;
      const seat = constById.get(cid);
      out.push({
        id: String(cand.id || `${cid}:${cand.name}`),
        raw: cand,
        name: cand.name,
        party: cand.party || (cand.is_independent ? "IND" : ""),
        constituency_id: cid,
        constituency: seat?.name || cid,
        state: seat?.state || activeState,
        is_independent: !!cand.is_independent,
      });
      if (out.length >= 8) break;
    }
    return out;
  }, [search, candidates, constituencies, stateConstituencies, activeState]);

  const constituencyMatches = useMemo(() => {
    if (!search || search.length < 2) return [];
    const out = stateConstituencies
      .filter((c: any) => String(c.name || "").toLowerCase().includes(search) || String(c.id || "").toLowerCase().includes(search))
      .slice(0, 8)
      .map((c: any) => ({ id: String(c.id), name: c.name, state: c.state }));
    return out;
  }, [search, stateConstituencies]);

  const sorted = [...filtered].sort((a, b) => {
    if (sortMode === "VOLATILITY") return (b.volatility_score || 0) - (a.volatility_score || 0);
    if (sortMode === "NAME") return a.name.localeCompare(b.name);
    if (sortMode === "PHASE") return (a.phase || 0) - (b.phase || 0);
    return 0;
  });

  const selectedConstituency = globalConstituencyId ? constituencies.find((c: any) => c.id === globalConstituencyId) || null : null;

  const candCountBySeat = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of candidates as any[]) {
      const k = String(c.constituency_id || "");
      if (!k) continue;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }, [candidates]);

  const crimCountBySeat = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of candidates as any[]) {
      const k = String(c.constituency_id || "");
      if (!k) continue;
      if ((c.criminal_cases || 0) > 0) m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }, [candidates]);

  if (selectedConstituency) {
    return (
      <aside className="flex min-h-0 flex-1 flex-col w-full overflow-hidden bg-[var(--surface-1)] border-l border-[color:var(--border)]">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[color:var(--border)] shrink-0">
          <button onClick={() => setGlobalConstituencyId(null)} className="font-mono text-[10px] text-[#16a34a] hover:text-[#16a34a]/80 transition-colors">← BACK</button>
          <span className="font-mono text-[10px] text-[var(--text-muted)]">/</span>
          <span className="font-mono text-[10px] text-[var(--text-secondary)] truncate">{selectedConstituency.name.toUpperCase()}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y pb-20 max-md:pb-28">
          <ConstituencyCard
            constituency={selectedConstituency}
            initialCandidate={pendingCandidate}
            onConsumedInitialCandidate={() => setPendingCandidate(null)}
          />
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex min-h-0 flex-1 flex-col w-full overflow-hidden bg-[var(--surface-1)] border-l border-[color:var(--border)]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[color:var(--border)] shrink-0 bg-[var(--surface-1)]">
        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-[#0284c7]" />
          <span className="font-mono text-xs font-bold text-[#0284c7] tracking-wider">INTEL PANE</span>
        </div>
        <div className="flex items-center gap-2">
          {typeof onBackToMap === "function" && activeState !== "ALL" ? (
            <button
              type="button"
              onClick={onBackToMap}
              className="rounded-md border border-[color:var(--border)] bg-[var(--surface-1)] px-2 py-1 font-mono text-[10px] font-bold text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
            >
              ← MAP
            </button>
          ) : null}
          <span className="font-mono text-[10px] text-[var(--text-muted)]">{sorted.length} seats</span>
        </div>
      </div>

      <div className="flex border-b border-[color:var(--border)] overflow-x-auto shrink-0 bg-[var(--surface-2)]">
        <button
          onClick={() => { setGlobalStateFilter("ALL"); setSearchQuery(""); setGlobalConstituencyId(null); setPartyFilter("ALL"); }}
          style={{ color: activeState === "ALL" ? "#16a34a" : "#71717a", borderBottomColor: activeState === "ALL" ? "#16a34a" : "transparent", backgroundColor: activeState === "ALL" ? "#16a34a15" : "transparent" }}
          className="flex-1 min-w-[50px] px-2 py-1.5 font-mono text-[10px] font-bold transition-colors border-b-2 hover:bg-[var(--surface-1)]"
        >ALL</button>

        {Array.from(new Set(constituencies.map((c: any) => c.state))).filter(Boolean).map((state: any) => {
          const meta = STATE_META[state];
          const isActive = activeState === state;
          return (
            <button
              key={state}
              onClick={() => { setGlobalStateFilter(state); setSearchQuery(""); setGlobalConstituencyId(null); setPartyFilter("ALL"); }}
              style={{ color: isActive ? meta?.color : "#71717a", borderBottomColor: isActive ? meta?.color : "transparent", backgroundColor: isActive ? `${meta?.color}10` : "transparent" }}
              className="flex-1 min-w-[40px] px-2 py-1.5 font-mono text-[10px] font-bold transition-colors border-b-2 hover:bg-[var(--surface-1)]"
            >
              <div className="truncate">{meta?.abbr || state}</div>
            </button>
          );
        })}
      </div>

      <StateOverview state={activeState} />

      <div className="border-b border-[color:var(--border)] shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 bg-[var(--surface-2)] px-3 py-2">
          <span className="flex min-w-0 flex-1 items-center gap-1.5 font-mono text-[10px] font-bold tracking-wider text-[var(--text-secondary)]">
            <Activity className="h-3 w-3 shrink-0 text-[#dc2626]" />
            <span className="flex min-w-0 flex-wrap items-center gap-1">
              <span className="whitespace-nowrap">HOTSPOTS (LAST 6H)</span>
              <IntelHelpTip label="What are hotspots?">
                <span className="mb-2 block font-semibold text-white">Hotspots (last 6 hours)</span>
                <span className="mb-2 block text-zinc-200">
                  <strong className="text-zinc-50">In plain words:</strong> these are seats where this dashboard is seeing a <em>jump in recent election-related alerts</em> compared with the six hours just before. Think of it as “where attention moved lately,” not as a verdict on what is true on the ground.
                </span>
                <span className="mb-2 block text-zinc-300">
                  <strong className="text-zinc-100">How it is built:</strong> we compare two windows—<em>now vs six hours ago</em> (each window is six hours long). We only count items that could be tied to a <em>specific seat</em> on the map. Seats with no tied items will not appear.
                </span>
                <span className="mt-2 block border-t border-zinc-600 pt-2 text-[9px] text-zinc-400">
                  <strong className="text-zinc-300">Disclaimer:</strong> this is <em>not</em> a government safety alert, a crime forecast, or proof that something bad will happen. It only reflects what this app has collected from feeds and automated tagging. Stories can be missed, miscategorised, or duplicated. Use it as one situational cue among many—not as legal or safety advice.
                </span>
              </IntelHelpTip>
            </span>
          </span>
          <span className="shrink-0 font-mono text-[9px] text-[var(--text-muted)]">TAP TO FOCUS</span>
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
                className="w-full flex items-center gap-2 px-2 py-2 rounded hover:bg-[var(--surface-2)] transition-colors text-left"
              >
                <div className={`h-2 w-2 rounded-full shrink-0 ${h.delta >= 3 ? "bg-[#dc2626]" : h.delta >= 1 ? "bg-[#ea580c]" : "bg-[#16a34a]"}`} />
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[10px] text-[var(--text-primary)] truncate">{h.name}</div>
                  <div className="font-mono text-[8px] text-[var(--text-muted)]">
                    vs prior 6h: {h.delta >= 0 ? `+${h.delta}` : h.delta} · this 6h strength: {h.recent}
                  </div>
                </div>
                <ChevronRight className="h-3 w-3 text-[var(--text-muted)] shrink-0" />
              </button>
            ))}
          </div>
        ) : (
          <div className="px-3 py-2 text-[10px] text-[var(--text-muted)] leading-snug">
            No hotspots right now—news may be quiet, or alerts are not yet linked to a seat on the map.
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

      <div className="px-2 py-2 border-b border-[color:var(--border)] shrink-0 flex flex-col gap-2 bg-[var(--surface-2)]">
        <div className="flex items-center gap-1.5 px-2 py-1 bg-[var(--surface-1)] border border-[color:var(--border)] rounded-md text-[10px]">
          <Search className="h-3 w-3 text-[var(--text-muted)] shrink-0" />
          <input
            type="text"
            placeholder="Search candidate or constituency..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent text-[var(--text-primary)] placeholder-[color:var(--text-muted)] outline-none font-mono text-[10px]"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--surface-2)]"
              aria-label="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </div>

        {(candidateMatches.length > 0 || constituencyMatches.length > 0) && (
          <div className="rounded-md border border-[color:var(--border)] bg-[var(--surface-1)] overflow-hidden">
            <div className="px-2 py-1 border-b border-[color:var(--border)] flex items-center justify-between">
              <span className="font-mono text-[9px] font-bold text-[var(--text-secondary)] tracking-wider">SEARCH RESULTS</span>
              <span className="font-mono text-[8px] text-[var(--text-muted)]">tap to open</span>
            </div>
            <div className="max-h-[220px] overflow-y-auto pretty-scroll">
              {candidateMatches.length > 0 ? (
                <div className="px-2 py-1">
                  <div className="font-mono text-[8px] text-[var(--text-muted)] tracking-wider mb-1">CANDIDATES</div>
                  {candidateMatches.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setPendingCandidate(c.raw || null);
                        if (c.state && c.state !== activeState) setGlobalStateFilter(c.state);
                        setTimeout(() => setGlobalConstituencyId(c.constituency_id), 50);
                      }}
                      className="w-full rounded-md px-2 py-1.5 text-left hover:bg-[var(--surface-2)]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-mono text-[10px] font-bold text-[var(--text-primary)] truncate">{c.name}</div>
                          <div className="font-mono text-[8px] text-[var(--text-muted)] truncate">
                            {String(c.constituency).toUpperCase()} · {String(c.state).toUpperCase()}
                          </div>
                          <div className="mt-0.5 font-mono text-[8px] font-bold text-[var(--text-secondary)] truncate">
                            {c.is_independent ? "INDEPENDENT" : String(c.party || "").toUpperCase()}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}

              {constituencyMatches.length > 0 ? (
                <div className="px-2 py-1 border-t border-[color:var(--border)]">
                  <div className="font-mono text-[8px] text-[var(--text-muted)] tracking-wider mb-1">CONSTITUENCIES</div>
                  {constituencyMatches.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        if (c.state && c.state !== activeState) setGlobalStateFilter(c.state);
                        setTimeout(() => setGlobalConstituencyId(c.id), 50);
                      }}
                      className="w-full rounded-md px-2 py-1.5 text-left hover:bg-[var(--surface-2)]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-mono text-[10px] font-bold text-[var(--text-primary)] truncate">{c.name}</div>
                          <div className="font-mono text-[8px] text-[var(--text-muted)] truncate">{String(c.state).toUpperCase()}</div>
                        </div>
                        <ChevronRight className="h-3 w-3 text-[var(--text-muted)] shrink-0" />
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <Filter className="h-2.5 w-2.5 text-[var(--text-muted)] shrink-0 ml-1" />
          <select value={partyFilter} onChange={(e) => setPartyFilter(e.target.value)} className="flex-1 bg-[var(--surface-1)] border border-[color:var(--border)] rounded-md px-1.5 py-1 font-mono text-[9px] font-bold text-[var(--text-secondary)] outline-none">
            <option value="ALL">ALL PARTIES</option>
            {uniqueParties.map(party => (
              <option key={party} value={party}>{party}</option>
            ))}
            <option value="IND">INDEPENDENTS</option>
          </select>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y pb-20 max-md:pb-28">
        <div className="sticky top-0 z-10 px-2 py-2 flex justify-between items-center bg-[var(--surface-2)]/95 backdrop-blur border-b border-[color:var(--border)]">
          <span className="font-mono text-[8px] text-[var(--text-muted)] tracking-wider flex items-center gap-1">
            SORT METRIC
            <IntelHelpTip label="What is volatility?">
              <span className="mb-2 block font-semibold text-white">Volatility index (0 to 100)</span>
              <span className="mb-2 block text-zinc-200">
                <strong className="text-zinc-50">In plain words:</strong> a rough “how heated does this seat look on paper <em>inside this app</em>?” score. Higher usually means a busier contest (more candidates than a simple two-way fight), more declared criminal cases in the data we imported from affidavits, and/or more recent alerts linked to that seat. Lower means calmer by those same measures.
              </span>
              <span className="mb-2 block text-zinc-300">
                <strong className="text-zinc-100">How it is built:</strong> the number is calculated automatically from your project’s database, blending those ingredients with fixed rules and limits so scores stay between 0 and 100. It is recomputed when your team runs the scheduled intel update job (not live second-by-second).
              </span>
              <span className="mt-2 block border-t border-zinc-600 pt-2 text-[9px] text-zinc-400">
                <strong className="text-zinc-300">Disclaimer:</strong> this is <em>not</em> a prediction of who will win, not an official Election Commission rating, and not a substitute for polls or field reporting. If candidate or news data is incomplete, the score will be wrong or stale. Use it to sort and compare seats in this tool—not as financial, legal, or safety guidance.
              </span>
            </IntelHelpTip>
          </span>
          <select value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)} className="bg-transparent font-mono text-[9px] font-bold text-[var(--text-secondary)] outline-none cursor-pointer">
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
            className="flex items-center w-full px-3 py-2 hover:bg-[var(--surface-2)] transition-colors border-b border-[color:var(--border)] group text-left"
          >
            <div className="h-6 w-1 rounded-full mr-2.5 shrink-0" style={{ backgroundColor: (c.volatility_score || 0) >= 70 ? "#dc2626" : (c.volatility_score || 0) >= 40 ? "#ea580c" : "#16a34a" }} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] text-[var(--text-primary)] truncate group-hover:text-[#16a34a] transition-colors">{c.name}</span>
                <span className="font-mono text-[8px] text-[var(--text-muted)] shrink-0">#{c.id?.split('-')[1] || "0"}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono text-[8px] text-[var(--text-muted)]">VOL {(c.volatility_score || 0).toFixed(0)}%</span>
                <span className="font-mono text-[8px] text-[var(--text-muted)]">PH-{c.phase}</span>
                <span className="font-mono text-[8px] text-[var(--text-muted)]">{candCountBySeat.get(String(c.id)) || 0} cands</span>
                <span className={`font-mono text-[8px] ${(crimCountBySeat.get(String(c.id)) || 0) > 0 ? "text-[#dc2626]" : "text-[#16a34a]"}`}>
                  {(crimCountBySeat.get(String(c.id)) || 0) > 0 ? `${crimCountBySeat.get(String(c.id))} crim` : "clean"}
                </span>
              </div>
            </div>
            <ChevronRight className="h-3 w-3 text-[var(--text-muted)] group-hover:text-[var(--text-muted)] shrink-0 transition-colors" />
          </button>
        )) : (
          <div className="p-6 text-center font-mono text-[10px] text-[#a1a1aa]">No matches found.</div>
        )}
      </div>
    </aside>
  );
}