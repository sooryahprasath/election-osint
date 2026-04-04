"use client";

import { useLiveData } from "@/lib/context/LiveDataContext";

interface StateOverviewProps {
  state: string;
}

export default function StateOverview({ state }: StateOverviewProps) {
  const { constituencies: allConstituencies, candidates: allCandidates } = useLiveData();

  // FIX: Handle the "ALL" national state seamlessly
  const constituencies = state === "ALL"
    ? allConstituencies
    : allConstituencies.filter((c: any) => c.state === state);

  const stateCandidates = state === "ALL"
    ? allCandidates
    : allCandidates.filter((c: any) => constituencies.some((con: any) => con.id === c.constituency_id));

  const seats = constituencies.length;
  const criminalCount = stateCandidates.filter((c: any) => c.criminal_cases && c.criminal_cases > 0).length;

  const avgVolatility = constituencies.length > 0
    ? constituencies.reduce((s: any, c: any) => s + (c.volatility_score || 0), 0) / constituencies.length
    : 0;

  if (seats === 0) return null;

  return (
    <div className="grid grid-cols-4 gap-0 border-b border-[#e4e4e7] shrink-0 bg-white">
      <div className="px-2 py-1.5 border-r border-[#e4e4e7] text-center">
        <div className="font-mono text-[10px] text-[#16a34a] font-bold">{seats}</div>
        <div className="font-mono text-[7px] text-[#71717a]">{state === "ALL" ? "NAT. SEATS" : "SEATS"}</div>
      </div>
      <div className="px-2 py-1.5 border-r border-[#e4e4e7] text-center">
        <div className="font-mono text-[10px] text-[#0284c7] font-bold">{stateCandidates.length}</div>
        <div className="font-mono text-[7px] text-[#71717a]">CANDS</div>
      </div>
      <div className="px-2 py-1.5 border-r border-[#e4e4e7] text-center">
        <div className="font-mono text-[10px] text-[#dc2626] font-bold">{criminalCount}</div>
        <div className="font-mono text-[7px] text-[#71717a]">CRIM</div>
      </div>
      <div className="px-2 py-1.5 text-center">
        <div className="font-mono text-[10px] text-[#ea580c] font-bold">
          {avgVolatility.toFixed(0)}%
        </div>
        <div className="font-mono text-[7px] text-[#71717a]">VOL</div>
      </div>
    </div>
  );
}