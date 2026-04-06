"use client";

import { useState } from "react";
import { MapPin, Users, AlertTriangle, TrendingUp, Scale, Fingerprint, Shield } from "lucide-react";
import { formatIndianCurrency, volatilityColor } from "@/lib/utils/formatting";
import CandidateRow from "./CandidateRow";
import VolatilityGauge from "./VolatilityGauge";
import CandidateModal from "./CandidateModal";
import { useLiveData } from "@/lib/context/LiveDataContext";

interface ConstituencyCardProps {
  constituency: any;
}

export default function ConstituencyCard({ constituency }: ConstituencyCardProps) {
  const { candidates: allCandidates } = useLiveData();

  const candidates = allCandidates.filter(c => c.constituency_id === constituency.id);
  const totalWealth = candidates.reduce((sum, c) => sum + (c.assets_value || 0), 0);
  const totalCriminal = candidates.filter((c) => c.criminal_cases && c.criminal_cases > 0).length;
  const [activeCandidate, setActiveCandidate] = useState<any | null>(null);

  return (
    <div className="flex flex-col gap-0">
      {/* Header */}
      <div className="px-3 py-3 border-b border-[#e4e4e7]">
        <div className="flex justify-between items-start mb-1">
          <h2 className="font-mono text-sm font-bold text-[#16a34a]">
            {constituency.name}
          </h2>
          <span className={`font-mono text-[9px] font-bold px-1.5 py-0.5 rounded ${constituency.reservation !== 'GEN' ? 'bg-[#0284c7]/10 text-[#0284c7] border border-[#0284c7]/30' : 'bg-[#e4e4e7] text-[#71717a]'}`}>
            {constituency.reservation || 'GEN'}
          </span>
        </div>

        <div className="flex flex-col gap-1 mt-1 font-mono text-[10px] text-[#71717a]">
          <span className="flex items-center gap-1 text-[#52525b]">
            <MapPin className="h-3 w-3 text-[#ea580c]" />
            {constituency.district}, {constituency.state} • #{constituency.id?.split("-")[1] || "0"}
          </span>
          <span className="flex items-center gap-1">
            <Shield className="h-3 w-3" /> Phase {constituency.phase} ({constituency.pollingDate})
          </span>
          <span className="flex items-center gap-1">
            <Fingerprint className="h-3 w-3" /> Electorate (2021): {constituency.electorate ? constituency.electorate.toLocaleString('en-IN') : 'N/A'}
          </span>
        </div>
      </div>

      {/* Volatility Gauge */}
      <div className="px-3 py-3 border-b border-[#e4e4e7]">
        <div className="flex items-center justify-between mb-1">
          <span className="font-mono text-[10px] text-[#52525b] tracking-wider">
            VOLATILITY INDEX
          </span>
          <span
            className="font-mono text-xs font-bold"
            style={{ color: volatilityColor(constituency.volatility_score || 0) }}
          >
            {(constituency.volatility_score || 0).toFixed(1)}%
          </span>
        </div>
        <p className="font-mono text-[8px] text-[#a1a1aa] mb-2 leading-snug">
          Composite 0–100 from the pipeline (contest pressure + risk signals). Not an opinion poll.
        </p>
        <VolatilityGauge score={constituency.volatility_score || 0} />
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-0 border-b border-[#e4e4e7]">
        <div className="px-3 py-2 border-r border-[#e4e4e7] text-center">
          <Users className="h-3 w-3 text-[#0284c7] mx-auto mb-1" />
          <div className="font-mono text-xs text-[#27272a]">{candidates.length}</div>
          <div className="font-mono text-[8px] text-[#71717a]">CANDIDATES</div>
        </div>
        <div className="px-3 py-2 border-r border-[#e4e4e7] text-center">
          <AlertTriangle className="h-3 w-3 text-[#dc2626] mx-auto mb-1" />
          <div className="font-mono text-xs text-[#27272a]">{totalCriminal}</div>
          <div className="font-mono text-[8px] text-[#71717a]">CRIMINAL</div>
        </div>
        <div className="px-3 py-2 text-center">
          <Scale className="h-3 w-3 text-[#ea580c] mx-auto mb-1" />
          <div className="font-mono text-xs text-[#27272a]">
            {formatIndianCurrency(totalWealth)}
          </div>
          <div className="font-mono text-[8px] text-[#71717a]">TOTAL WEALTH</div>
        </div>
      </div>

      {/* GPS */}
      <div className="px-3 py-1.5 border-b border-[#e4e4e7] flex items-center gap-2">
        <TrendingUp className="h-3 w-3 text-[#71717a]" />
        <span className="font-mono text-[9px] text-[#71717a]">
          GPS: {constituency.latitude?.toFixed(4)}°N, {constituency.longitude?.toFixed(4)}°E
        </span>
      </div>

      {/* Candidates */}
      <div className="px-3 py-2 border-b border-[#e4e4e7]">
        <span className="font-mono text-[10px] text-[#52525b] tracking-wider">
          ◆ CANDIDATE MANIFEST ({candidates.length})
        </span>
      </div>
      <div className="flex flex-col">
        {candidates.length > 0 ? (
          candidates
            .sort((a, b) => (b.assets_value || 0) - (a.assets_value || 0))
            .map((candidate) => (
              <CandidateRow
                key={candidate.id}
                candidate={candidate}
                onClick={() => setActiveCandidate(candidate)}
              />
            ))
        ) : (
          <div className="p-6 text-center font-mono text-[10px] text-[#a1a1aa]">
            Awaiting Candidate Affidavits.
          </div>
        )}
      </div>

      {activeCandidate && (
        <CandidateModal
          candidate={activeCandidate}
          onClose={() => setActiveCandidate(null)}
        />
      )}
    </div>
  );
}