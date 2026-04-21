"use client";

import { useLiveData } from "@/lib/context/LiveDataContext";

interface StateOverviewProps {
  state: string;
}

export default function StateOverview({ state }: StateOverviewProps) {
  const { constituencies: allConstituencies, candidates: allCandidates, candidateCounts, criminalCounts } = useLiveData();

  // FIX: Handle the "ALL" national state seamlessly
  const constituencies = state === "ALL"
    ? allConstituencies
    : allConstituencies.filter((c: any) => c.state === state);

  const stateCandidates = state === "ALL"
    ? allCandidates
    : allCandidates.filter((c: any) => constituencies.some((con: any) => con.id === c.constituency_id));

  const candidateCount = typeof candidateCounts?.[state] === "number"
    ? candidateCounts[state]
    : stateCandidates.length;

  const seats = constituencies.length;
  const criminalCount =
    typeof criminalCounts?.[state] === "number"
      ? criminalCounts[state]
      : stateCandidates.filter((c: any) => Number(c.criminal_cases || 0) > 0).length;

  const avgVolatility = constituencies.length > 0
    ? constituencies.reduce((s: any, c: any) => s + (c.volatility_score || 0), 0) / constituencies.length
    : 0;

  if (seats === 0) return null;

  return (
    <div className="grid grid-cols-4 gap-0 border-b border-[color:var(--border)] shrink-0 bg-[var(--surface-1)]">
      <div className="px-2 py-1.5 border-r border-[color:var(--border)] text-center">
        <div className="font-mono text-[10px] text-[#16a34a] font-bold">{seats}</div>
        <div className="font-mono text-[7px] text-[var(--text-muted)]">{state === "ALL" ? "NAT. SEATS" : "SEATS"}</div>
      </div>
      <div className="px-2 py-1.5 border-r border-[color:var(--border)] text-center">
        <div className="font-mono text-[10px] text-[#0284c7] font-bold">{candidateCount}</div>
        <div className="font-mono text-[7px] text-[var(--text-muted)]">CANDS</div>
      </div>
      <div className="px-2 py-1.5 border-r border-[color:var(--border)] text-center">
        <div className="font-mono text-[10px] text-[#dc2626] font-bold">{criminalCount}</div>
        <div className="font-mono text-[7px] text-[var(--text-muted)]">CRIM</div>
      </div>
      <div className="px-2 py-1.5 text-center">
        <div className="font-mono text-[10px] text-[#ea580c] font-bold">
          {avgVolatility.toFixed(0)}%
        </div>
        <div className="font-mono text-[7px] text-[var(--text-muted)]">VOL</div>
      </div>
    </div>
  );
}