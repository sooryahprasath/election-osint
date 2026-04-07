"use client";

import { useEffect, useState } from "react";
import { MapPin, Users, AlertTriangle, TrendingUp, Scale, Fingerprint, Shield } from "lucide-react";
import { formatIndianCurrency, volatilityColor } from "@/lib/utils/formatting";
import CandidateRow from "./CandidateRow";
import VolatilityGauge from "./VolatilityGauge";
import CandidateModal from "./CandidateModal";
import { useLiveData } from "@/lib/context/LiveDataContext";

interface ConstituencyCardProps {
  constituency: any;
  initialCandidate?: any | null;
  onConsumedInitialCandidate?: () => void;
}

export default function ConstituencyCard({ constituency, initialCandidate, onConsumedInitialCandidate }: ConstituencyCardProps) {
  const { candidates: allCandidates } = useLiveData();

  const candidates = allCandidates.filter(c => c.constituency_id === constituency.id);
  const totalWealth = candidates.reduce((sum, c) => sum + (c.assets_value || 0), 0);
  const totalCriminal = candidates.filter((c) => c.criminal_cases && c.criminal_cases > 0).length;
  const [activeCandidate, setActiveCandidate] = useState<any | null>(null);
  const sortedCandidates = [...candidates].sort((a, b) => (b.assets_value || 0) - (a.assets_value || 0));

  useEffect(() => {
    if (!initialCandidate) return;
    setActiveCandidate(initialCandidate);
    onConsumedInitialCandidate?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCandidate]);

  return (
    <div className="flex flex-col gap-0">
      {/* Header */}
      <div className="px-3 py-3 border-b border-[color:var(--border)]">
        <div className="flex justify-between items-start mb-1">
          <h2 className="font-mono text-sm font-bold text-[#16a34a]">
            {constituency.name}
          </h2>
          <span className={`font-mono text-[9px] font-bold px-1.5 py-0.5 rounded ${constituency.reservation !== 'GEN' ? 'bg-[#0284c7]/10 text-[#0284c7] border border-[#0284c7]/30' : 'bg-[var(--surface-3)] text-[var(--text-muted)] border border-[color:var(--border)]'}`}>
            {constituency.reservation || 'GEN'}
          </span>
        </div>

        <div className="flex flex-col gap-1 mt-1 font-mono text-[10px] text-[var(--text-muted)]">
          <span className="flex items-center gap-1 text-[var(--text-secondary)]">
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
      <div className="px-3 py-3 border-b border-[color:var(--border)]">
        <div className="flex items-center justify-between mb-1">
          <span className="font-mono text-[10px] text-[var(--text-secondary)] tracking-wider">
            VOLATILITY INDEX
          </span>
          <span
            className="font-mono text-xs font-bold"
            style={{ color: volatilityColor(constituency.volatility_score || 0) }}
          >
            {(constituency.volatility_score || 0).toFixed(1)}%
          </span>
        </div>
        <p className="text-[9px] text-[var(--text-muted)] mb-2 leading-relaxed">
          <strong className="text-[var(--text-secondary)]">Plain summary:</strong> a 0–100 “how busy this seat looks here” score from this app’s data—crowded race, declared criminal cases we have on file, and recent alerts tied to this seat.{" "}
          <span className="block mt-1 text-[var(--text-muted)]">
            <strong>Not</strong> a win prediction or official risk label. Updates when your background intel job runs. Data gaps make scores misleading—use as context only.
          </span>
        </p>
        <VolatilityGauge score={constituency.volatility_score || 0} />
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-0 border-b border-[color:var(--border)]">
        <div className="px-3 py-2 border-r border-[color:var(--border)] text-center">
          <Users className="h-3 w-3 text-[#0284c7] mx-auto mb-1" />
          <div className="font-mono text-xs text-[var(--text-primary)]">{candidates.length}</div>
          <div className="font-mono text-[8px] text-[var(--text-muted)]">CANDIDATES</div>
        </div>
        <div className="px-3 py-2 border-r border-[color:var(--border)] text-center">
          <AlertTriangle className="h-3 w-3 text-[#dc2626] mx-auto mb-1" />
          <div className="font-mono text-xs text-[var(--text-primary)]">{totalCriminal}</div>
          <div className="font-mono text-[8px] text-[var(--text-muted)]">CRIMINAL</div>
        </div>
        <div className="px-3 py-2 text-center">
          <Scale className="h-3 w-3 text-[#ea580c] mx-auto mb-1" />
          <div className="font-mono text-xs text-[var(--text-primary)]">
            {formatIndianCurrency(totalWealth)}
          </div>
          <div className="font-mono text-[8px] text-[var(--text-muted)]">TOTAL WEALTH</div>
        </div>
      </div>

      {/* GPS */}
      <div className="px-3 py-1.5 border-b border-[color:var(--border)] flex items-center gap-2">
        <TrendingUp className="h-3 w-3 text-[var(--text-muted)]" />
        <span className="font-mono text-[9px] text-[var(--text-muted)]">
          GPS: {constituency.latitude?.toFixed(4)}°N, {constituency.longitude?.toFixed(4)}°E
        </span>
      </div>

      {/* Candidates */}
      <div className="px-3 py-2 border-b border-[color:var(--border)] flex items-center justify-between gap-2 bg-[var(--surface-2)]">
        <span className="font-mono text-[10px] font-bold text-[var(--text-secondary)] tracking-wider">
          ◆ CANDIDATE MANIFEST
        </span>
        <span className="font-mono text-[9px] text-[var(--text-muted)]">{candidates.length} total</span>
      </div>
      <div className="flex flex-col">
        {candidates.length > 0 ? (
          sortedCandidates.map((candidate) => (
              <CandidateRow
                key={candidate.id}
                candidate={candidate}
                onClick={() => setActiveCandidate(candidate)}
              />
            ))
        ) : (
          <div className="p-6 text-center font-mono text-[10px] text-[var(--text-muted)]">
            Awaiting Candidate Affidavits.
          </div>
        )}
      </div>

      {activeCandidate && (
        <CandidateModal
          candidate={activeCandidate}
          constituency={constituency}
          onClose={() => setActiveCandidate(null)}
        />
      )}
    </div>
  );
}