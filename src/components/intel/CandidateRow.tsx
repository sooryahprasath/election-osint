"use client";

import { AlertTriangle, GraduationCap, IndianRupee, User } from "lucide-react";
import { formatIndianCurrency } from "@/lib/utils/formatting";

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

  return (
    <div 
      onClick={onClick}
      className={`px-3 py-2.5 border-b border-[#e4e4e7] transition-colors ${onClick ? 'cursor-pointer hover:bg-[#e4e4e7]/50' : 'hover:bg-[#f4f4f5]'}`}
    >
      {/* Name + Party */}
      <div className="flex items-center gap-2 mb-1.5">
        {/* Party color dot */}
        <div
          className="h-2.5 w-2.5 rounded-full shrink-0"
          style={{ backgroundColor: partyColor }}
        />
        <span className="font-mono text-[11px] text-[#18181b] font-medium truncate">
          {candidate.name}
        </span>
        <span
          className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0"
          style={{
            color: partyColor,
            backgroundColor: `${partyColor}15`,
            border: `1px solid ${partyColor}30`,
          }}
        >
          {candidate.party}
        </span>
        {candidate.removed && (
          <span className="font-mono text-[8px] font-bold text-[#a1a1aa] bg-[#f4f4f5] border border-[#e4e4e7] px-1 py-0.5 rounded shrink-0">
            REMOVED
          </span>
        )}
        {isLeading && (
          <span className="font-mono text-[8px] text-[#22c55e] bg-[#22c55e]/10 px-1 py-0.5 rounded shrink-0">
            LEADING
          </span>
        )}
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-3 font-mono text-[9px]">
        {/* Age + Gender */}
        <span className="flex items-center gap-1 text-[#52525b]">
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
        <span className="flex items-center gap-1 text-[#71717a]">
          <GraduationCap className="h-2.5 w-2.5" />
          {candidate.education || "-"}
        </span>
      </div>
    </div>
  );
}
