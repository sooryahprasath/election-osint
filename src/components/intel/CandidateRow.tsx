"use client";

import { AlertTriangle, GraduationCap, IndianRupee, User } from "lucide-react";
import { formatIndianCurrency, normalizeEducation } from "@/lib/utils/formatting";

// Fallback logic to get colors without the old static mock dictionary
const getPartyColor = (party: string) => {
  const hash = party.split('').reduce((acc, char) => char.charCodeAt(0) + ((acc << 5) - acc), 0);
  return `hsl(${hash % 360}, 70%, 50%)`;
};

interface CandidateRowProps {
  candidate: any;
  onClick?: () => void;
  isLeading?: boolean;
}

export default function CandidateRow({ candidate, onClick, isLeading }: CandidateRowProps) {
  const partyColor = getPartyColor(candidate.party || "IND");
  const partyLabel = String(candidate.party || "IND");

  return (
    <div 
      onClick={onClick}
      className={`px-3 py-2.5 border-b border-[color:var(--border)] transition-colors ${onClick ? 'cursor-pointer hover:bg-[var(--surface-2)]' : 'hover:bg-[var(--surface-2)]'}`}
    >
      {/* Consistent row layout (mobile + desktop) */}
      <div className="mb-1.5 flex flex-col gap-1">
        <div className="flex min-w-0 flex-1 items-center gap-2 md:w-full md:flex-none">
          <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: partyColor }} />
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-medium text-[var(--text-primary)]">
            {candidate.name}
          </span>
          <span className="shrink-0 rounded border border-[color:var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[8px] font-bold text-[var(--text-secondary)] md:hidden">
            VOL
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 pl-[14px]">
          <span
            title={partyLabel}
            className="max-w-full rounded border border-[color:var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[9px] font-bold leading-tight text-[var(--text-primary)]"
            style={{ borderLeftWidth: 3, borderLeftColor: partyColor }}
          >
            <span className="block max-w-[235px] truncate md:max-w-[220px]">{partyLabel}</span>
          </span>
          {candidate.removed && (
            <span className="shrink-0 rounded border border-[color:var(--border)] bg-[var(--surface-2)] px-1 py-0.5 font-mono text-[8px] font-bold text-[var(--text-muted)]">
              REMOVED
            </span>
          )}
          {isLeading && (
            <span className="shrink-0 rounded bg-[#22c55e]/10 px-1 py-0.5 font-mono text-[8px] text-[#22c55e]">
              LEADING
            </span>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[9px]">
        {/* Age + Gender */}
        <span className="flex items-center gap-1 text-[var(--text-secondary)]">
          <User className="h-2.5 w-2.5" />
          {candidate.age || 45}y
        </span>

        {/* Wealth */}
        <span className="flex items-center gap-1 text-[#ea580c]">
          <IndianRupee className="h-2.5 w-2.5" />
          {formatIndianCurrency(candidate.assets_value || 0)}
        </span>

        {/* Criminal Records */}
        {(candidate.criminal_cases || 0) > 0 ? (
          <span className="flex items-center gap-1 text-[#dc2626]">
            <AlertTriangle className="h-2.5 w-2.5" />
            {candidate.criminal_cases} case{(candidate.criminal_cases || 0) > 1 ? "s" : ""}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[#16a34a]">
            <AlertTriangle className="h-2.5 w-2.5" />
            Clean
          </span>
        )}

        {/* Education */}
        <span className="flex items-center gap-1 text-[var(--text-muted)]">
          <GraduationCap className="h-2.5 w-2.5" />
          {normalizeEducation(candidate.education)}
        </span>
      </div>
    </div>
  );
}
