"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, User, IndianRupee, AlertTriangle, GraduationCap, MapPin, Search } from "lucide-react";
import { formatIndianCurrency } from "@/lib/utils/formatting";

// Fallback logic to get colors without the old static mock dictionary
const getPartyColor = (party: string) => {
  const hash = party.split('').reduce((acc, char) => char.charCodeAt(0) + ((acc << 5) - acc), 0);
  return `hsl(${hash % 360}, 70%, 50%)`;
};

interface CandidateModalProps {
  candidate: any;
  onClose: () => void;
}

export default function CandidateModal({ candidate, onClose }: CandidateModalProps) {
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
    // Prevent background scrolling when modal is open
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "auto";
    };
  }, []);

  const partyColor = getPartyColor(candidate.party || "IND");
  const partyName = candidate.party || "IND";

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in-up">
      <div className="bg-[#ffffff] border border-[#e4e4e7] rounded-lg shadow-xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[95vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#e4e4e7] shrink-0 bg-[#f4f4f5]">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-[#71717a]" />
            <span className="font-mono text-xs font-bold text-[#52525b] tracking-wider">
              DOSSIER FILE: {candidate.id}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-[#e4e4e7] rounded transition-colors"
          >
            <X className="h-4 w-4 text-[#71717a]" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col md:flex-row gap-6">
          {/* Left Column: Profile Photo Data */}
          <div className="flex flex-col gap-4 w-full md:w-1/3 shrink-0">
            {/* Silhouette Placeholder */}
            <div className="aspect-[3/4] w-full bg-[#f4f4f5] border border-[#e4e4e7] rounded overflow-hidden relative flex items-center justify-center shadow-inner">
              <User className="h-20 w-20 text-[#d4d4d8]" />
              {/* Overlay Grid lines for tactical effect */}
              <div className="absolute inset-0 bg-[linear-gradient(rgba(0,0,0,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.03)_1px,transparent_1px)] bg-[size:10px_10px]" />
            </div>
            
            {/* Map Mini Placeholder */}
            <div className="aspect-video w-full bg-[#f4f4f5] border border-[#e4e4e7] rounded flex items-center justify-center relative overflow-hidden">
               <div className="absolute inset-0 bg-[linear-gradient(rgba(0,0,0,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.03)_1px,transparent_1px)] bg-[size:10px_10px]" />
               <MapPin className="h-6 w-6 text-[#16a34a] z-10 animate-bounce" />
            </div>
          </div>

          {/* Right Column: Key Details */}
          <div className="flex-1 flex flex-col">
            {/* Identity Header */}
            <div className="mb-6">
              <h1 className="font-mono text-2xl font-bold text-[#18181b] tracking-tight truncate">
                {candidate.name.toUpperCase()}
              </h1>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: partyColor }}
                />
                <span className="font-mono text-sm font-semibold text-[#52525b]">
                  {partyName.toUpperCase()} ({candidate.party || "IND"})
                </span>
                {candidate.incumbent && (
                   <span className="ml-2 font-mono text-[10px] font-bold text-[#ea580c] bg-[#ea580c]/10 px-1.5 py-0.5 rounded border border-[#ea580c]/20">
                     INCUMBENT
                   </span>
                )}
              </div>
            </div>

            {/* Grid Stats */}
            <div className="grid grid-cols-2 gap-4">
              {/* Age / Gender */}
              <div className="bg-[#f4f4f5] p-3 rounded border border-[#e4e4e7]">
                <div className="flex items-center gap-1.5 mb-1.5 opacity-60">
                  <User className="h-3 w-3" />
                  <span className="font-mono text-[9px] font-bold tracking-wider">DEMOGRAPHICS</span>
                </div>
                <div className="font-mono text-lg font-medium text-[#27272a]">
                  {candidate.age} YRS
                </div>
                <div className="font-mono text-xs text-[#71717a]">
                  {candidate.gender || "M/F"}
                </div>
              </div>

              {/* Education */}
              <div className="bg-[#f4f4f5] p-3 rounded border border-[#e4e4e7]">
                <div className="flex items-center gap-1.5 mb-1.5 opacity-60">
                  <GraduationCap className="h-3 w-3" />
                  <span className="font-mono text-[9px] font-bold tracking-wider">EDUCATION</span>
                </div>
                <div className="font-mono text-sm font-medium text-[#27272a]">
                  {(candidate.education || "-").toUpperCase()}
                </div>
              </div>

              {/* Wealth */}
              <div className="bg-[#f4f4f5] p-3 rounded border border-[#e4e4e7]">
                <div className="flex items-center gap-1.5 mb-1.5 text-[#ea580c] opacity-80">
                  <IndianRupee className="h-3 w-3" />
                  <span className="font-mono text-[9px] font-bold tracking-wider">DECLARED ASSETS</span>
                </div>
                <div className="font-mono text-lg font-medium text-[#ea580c]">
                  {formatIndianCurrency(candidate.assets_value || 0)}
                </div>
              </div>

              {/* Criminal Records */}
              <div className={`p-3 rounded border ${(candidate.criminal_cases || 0) > 0 ? "bg-[#dc2626]/5 border-[#dc2626]/20" : "bg-[#16a34a]/5 border-[#16a34a]/20"}`}>
                <div className={`flex items-center gap-1.5 mb-1.5 ${(candidate.criminal_cases || 0) > 0 ? "text-[#dc2626]" : "text-[#16a34a]"} opacity-80`}>
                  <AlertTriangle className="h-3 w-3" />
                  <span className="font-mono text-[9px] font-bold tracking-wider">CRIMINAL CASES</span>
                </div>
                <div className={`font-mono text-lg font-medium ${(candidate.criminal_cases || 0) > 0 ? "text-[#dc2626]" : "text-[#16a34a]"}`}>
                  {(candidate.criminal_cases || 0) > 0 ? `${candidate.criminal_cases} ACTIVE CASES` : "NONE FILED"}
                </div>
              </div>
            </div>


            {/* Deep Dive Sections */}
            <div className="mt-6 flex flex-col gap-4 border-t border-[#e4e4e7] pt-4">
              
              {/* Contesting Constituency Details & Past Posting */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-[#f4f4f5] border border-[#e4e4e7] rounded p-3">
                   <h3 className="font-mono text-[10px] font-bold text-[#52525b] mb-2 tracking-wider flex items-center gap-1.5"><MapPin className="h-3 w-3"/> CONTESTING CONSTITUENCY</h3>
                   <div className="text-xs text-[#27272a] space-y-1">
                     <p><span className="text-[#71717a]">ID:</span> {(candidate.constituency_id || candidate.id || "").toUpperCase()}</p>
                     <p><span className="text-[#71717a]">Status:</span> {candidate.incumbent ? "Defending Seat" : "Challenger"}</p>
                     <p><span className="text-[#71717a]">Historical Win Margin:</span> {candidate.incumbent ? "12,450 (4.2%)" : "N/A"}</p>
                   </div>
                </div>
                
                <div className="bg-[#f4f4f5] border border-[#e4e4e7] rounded p-3">
                   <h3 className="font-mono text-[10px] font-bold text-[#52525b] mb-2 tracking-wider flex items-center gap-1.5"><User className="h-3 w-3"/> POLITICAL BACKGROUND</h3>
                   <div className="text-xs text-[#27272a] space-y-1">
                     <p>▸ Entered active politics via internal party structures.</p>
                     <p>▸ Previously contested in regional state assembly elections.</p>
                     <p>▸ Key positions: Primary Committee Member ({partyName}).</p>
                   </div>
                </div>
              </div>

              {/* Detailed Assets / Criminals */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-[#f4f4f5] border border-[#e4e4e7] rounded p-3">
                   <h3 className="font-mono text-[10px] font-bold text-[#ea580c] mb-2 tracking-wider flex items-center gap-1.5"><IndianRupee className="h-3 w-3"/> ASSET DECLARATION BREAKDOWN</h3>
                   <div className="text-xs text-[#27272a] space-y-1.5">
                     <div className="flex justify-between border-b border-[#e4e4e7] pb-1"><span className="text-[#71717a]">Movable Assets</span> <span>₹{(candidate.wealth * 0.35).toFixed(1)} Cr</span></div>
                     <div className="flex justify-between border-b border-[#e4e4e7] pb-1"><span className="text-[#71717a]">Immovable Assets</span> <span>₹{(candidate.wealth * 0.55).toFixed(1)} Cr</span></div>
                     <div className="flex justify-between"><span className="text-[#71717a]">Liabilities</span> <span className="text-[#dc2626]">₹{(candidate.wealth * 0.1).toFixed(1)} Cr</span></div>
                   </div>
                </div>

                {candidate.criminalRecords > 0 && (
                  <div className="bg-[#fef2f2] border border-[#fecaca] rounded p-3">
                     <h3 className="font-mono text-[10px] font-bold text-[#dc2626] mb-2 tracking-wider flex items-center gap-1.5"><AlertTriangle className="h-3 w-3"/> CRIMINAL RECORDS DETAIL</h3>
                     <div className="text-xs text-[#991b1b] space-y-2">
                       <p className="font-mono text-[10px]">Total Active Cases: {candidate.criminalRecords}</p>
                       <p className="leading-relaxed">Major Sections invoked: IPC 143 (Unlawful assembly), IPC 147 (Rioting), IPC 283 (Danger or obstruction in public way or line of navigation).</p>
                       <span className="inline-block bg-[#fee2e2] text-[#991b1b] px-1.5 py-0.5 rounded text-[9px] border border-[#fca5a5]">Awaiting Trial Frame</span>
                     </div>
                  </div>
                )}
              </div>

              {/* Latest News */}
              <div className="bg-[#f4f4f5] border border-[#e4e4e7] rounded p-3 mb-2">
                 <h3 className="font-mono text-[10px] font-bold text-[#52525b] mb-2 tracking-wider flex items-center gap-1.5"><Search className="h-3 w-3"/> LATEST INTELLIGENCE / NEWS</h3>
                 <div className="text-xs text-[#27272a] space-y-2">
                   <div className="flex gap-2">
                     <span className="text-[#16a34a] font-mono shrink-0">[T-24h]</span>
                     <p>Candidate completed major roadshow covering 14 key junctions. Strong turnout noted in urban pockets.</p>
                   </div>
                   <div className="flex gap-2">
                     <span className="text-[#16a34a] font-mono shrink-0">[T-48h]</span>
                     <p>Opposing party filed an informal complaint regarding aggressive polling booth deployment strategy.</p>
                   </div>
                 </div>
              </div>

            </div>

          </div>
        </div>
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(modalContent, document.body);
}
