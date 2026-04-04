"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, User, IndianRupee, AlertTriangle, GraduationCap, MapPin, Search, ExternalLink, Activity } from "lucide-react";
import { formatIndianCurrency } from "@/lib/utils/formatting";
import { useLiveData } from "@/lib/context/LiveDataContext";

const getPartyColor = (party: string) => {
  const hash = party.split('').reduce((acc, char) => char.charCodeAt(0) + ((acc << 5) - acc), 0);
  return `hsl(${hash % 360}, 70%, 50%)`;
};

export default function CandidateModal({ candidate, onClose }: { candidate: any; onClose: () => void; }) {
  const [mounted, setMounted] = useState(false);
  const [imgError, setImgError] = useState(false); // Keeps the photo fallback tracking
  const { signals } = useLiveData();

  useEffect(() => {
    setMounted(true);
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = "auto"; };
  }, []);

  const partyColor = getPartyColor(candidate.party || "IND");
  const partyName = candidate.party || "IND";

  // Get REAL signals related to this candidate's constituency
  const candidateSignals = signals.filter((s: any) => s.constituency_id === candidate.constituency_id).slice(0, 3);

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
          <button onClick={onClose} className="p-1 hover:bg-[#e4e4e7] rounded transition-colors">
            <X className="h-4 w-4 text-[#71717a]" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col md:flex-row gap-6">

          {/* Left Column: Photo */}
          <div className="flex flex-col gap-4 w-full md:w-1/3 shrink-0">
            <div className="aspect-[3/4] w-full bg-[#f4f4f5] border border-[#e4e4e7] rounded overflow-hidden relative flex items-center justify-center shadow-inner">

              {/* Photo or Fallback */}
              {candidate.photo_url && !imgError ? (
                <img
                  src={candidate.photo_url}
                  alt={candidate.name}
                  className="w-full h-full object-cover z-10 relative"
                  onError={() => setImgError(true)}
                />
              ) : (
                <User className="h-20 w-20 text-[#d4d4d8] z-10 relative" />
              )}

              <div className="absolute inset-0 bg-[linear-gradient(rgba(0,0,0,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.03)_1px,transparent_1px)] bg-[size:10px_10px] pointer-events-none" />
            </div>

            {/* Verify Button directly under the photo */}
            <a
              href={candidate.source_url || `https://myneta.info/search_candidate.php?q=${candidate.name}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full bg-[#16a34a]/10 text-[#16a34a] border border-[#16a34a]/30 font-mono text-[10px] font-bold px-3 py-2 rounded flex items-center justify-center gap-2 hover:bg-[#16a34a] hover:text-white transition-colors"
            >
              <ExternalLink className="h-3 w-3" /> OFFICIAL ECI / MYNETA AFFIDAVIT
            </a>
          </div>

          {/* Right Column: Key Details */}
          <div className="flex-1 flex flex-col">
            <div className="mb-6">
              <h1 className="font-mono text-2xl font-bold text-[#18181b] tracking-tight truncate">{candidate.name.toUpperCase()}</h1>
              <div className="flex items-center gap-2 mt-1">
                <span className="h-3 w-3 rounded-full shadow-sm" style={{ backgroundColor: partyColor }} />
                <span className="font-mono text-sm font-semibold text-[#52525b]">{partyName.toUpperCase()}</span>
                {candidate.incumbent && <span className="ml-2 font-mono text-[10px] font-bold text-[#ea580c] bg-[#ea580c]/10 px-1.5 py-0.5 rounded border border-[#ea580c]/20">INCUMBENT</span>}
                {candidate.is_independent && <span className="ml-2 font-mono text-[10px] font-bold text-[#52525b] bg-[#e4e4e7] px-1.5 py-0.5 rounded border border-[#d4d4d8]">INDEPENDENT</span>}
              </div>
            </div>

            {/* Grid Stats */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-[#f4f4f5] p-3 rounded border border-[#e4e4e7]">
                <div className="flex items-center gap-1.5 mb-1.5 opacity-60 text-[#27272a]"><User className="h-3 w-3" /><span className="font-mono text-[9px] font-bold tracking-wider">DEMOGRAPHICS</span></div>
                <div className="font-mono text-lg font-medium text-[#27272a]">{candidate.age || "N/A"} YRS</div>
              </div>
              <div className="bg-[#f4f4f5] p-3 rounded border border-[#e4e4e7]">
                <div className="flex items-center gap-1.5 mb-1.5 opacity-60 text-[#27272a]"><GraduationCap className="h-3 w-3" /><span className="font-mono text-[9px] font-bold tracking-wider">EDUCATION</span></div>
                <div className="font-mono text-sm font-medium text-[#27272a]">{(candidate.education || "-").toUpperCase()}</div>
              </div>
              <div className="bg-[#f4f4f5] p-3 rounded border border-[#e4e4e7]">
                <div className="flex items-center gap-1.5 mb-1.5 text-[#ea580c] opacity-80"><IndianRupee className="h-3 w-3" /><span className="font-mono text-[9px] font-bold tracking-wider">DECLARED ASSETS</span></div>
                <div className="font-mono text-lg font-medium text-[#ea580c]">{formatIndianCurrency(candidate.assets_value || 0)}</div>
              </div>
              <div className={`p-3 rounded border ${(candidate.criminal_cases || 0) > 0 ? "bg-[#dc2626]/5 border-[#dc2626]/20" : "bg-[#16a34a]/5 border-[#16a34a]/20"}`}>
                <div className={`flex items-center gap-1.5 mb-1.5 ${(candidate.criminal_cases || 0) > 0 ? "text-[#dc2626]" : "text-[#16a34a]"} opacity-80`}><AlertTriangle className="h-3 w-3" /><span className="font-mono text-[9px] font-bold tracking-wider">CRIMINAL CASES</span></div>
                <div className={`font-mono text-lg font-medium ${(candidate.criminal_cases || 0) > 0 ? "text-[#dc2626]" : "text-[#16a34a]"}`}>{(candidate.criminal_cases || 0) > 0 ? `${candidate.criminal_cases} ACTIVE CASES` : "NONE FILED"}</div>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-4 border-t border-[#e4e4e7] pt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-[#f4f4f5] border border-[#e4e4e7] rounded p-3">
                  <h3 className="font-mono text-[10px] font-bold text-[#52525b] mb-2 tracking-wider flex items-center gap-1.5"><MapPin className="h-3 w-3" /> CONTESTING CONSTITUENCY</h3>
                  <div className="text-xs text-[#27272a] space-y-1">
                    <p><span className="text-[#71717a]">ID:</span> {(candidate.constituency_id || "").toUpperCase()}</p>
                    <p><span className="text-[#71717a]">Status:</span> {candidate.incumbent ? "Defending Seat" : "Challenger"}</p>
                  </div>
                </div>

                <div className="bg-[#f4f4f5] border border-[#e4e4e7] rounded p-3">
                  <h3 className="font-mono text-[10px] font-bold text-[#52525b] mb-2 tracking-wider flex items-center gap-1.5"><User className="h-3 w-3" /> POLITICAL BACKGROUND</h3>
                  <div className="text-xs text-[#71717a] space-y-1">
                    {candidate.background ? <p className="text-[#27272a]">{candidate.background}</p> : <p>Awaiting background dossier extraction from ECI sources.</p>}
                  </div>
                </div>
              </div>

              {/* REAL Latest News mapped from DB */}
              <div className="bg-[#f4f4f5] border border-[#e4e4e7] rounded p-3 mb-2">
                <h3 className="font-mono text-[10px] font-bold text-[#52525b] mb-2 tracking-wider flex items-center gap-1.5"><Search className="h-3 w-3" /> REAL-TIME CONSTITUENCY INTELLIGENCE</h3>
                <div className="text-xs text-[#27272a] space-y-2">
                  {candidateSignals.length > 0 ? candidateSignals.map((sig: any) => (
                    <div key={sig.id} className="flex gap-2">
                      <span className={`${sig.severity >= 4 ? "text-[#dc2626]" : "text-[#16a34a]"} font-mono shrink-0`}><Activity className="w-3 h-3 inline mr-1" /></span>
                      <p>{sig.title}</p>
                    </div>
                  )) : (
                    <p className="text-[#71717a]">No recent intelligence reports filed for this constituency.</p>
                  )}
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