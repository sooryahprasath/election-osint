"use client";

import { AlertTriangle, CheckCircle, ChevronRight, User } from "lucide-react";
import { formatIndianCurrency, normalizeEducation } from "@/lib/utils/formatting";

// Fallback logic to get colors without the old static mock dictionary
const getPartyColor = (party: string) => {
  const hash = party.split('').reduce((acc, char) => char.charCodeAt(0) + ((acc << 5) - acc), 0);
  return `hsl(${hash % 360}, 70%, 50%)`;
};

interface CandidateRowProps {
  candidate: unknown;
  onClick?: () => void;
  isLeading?: boolean;
}

export default function CandidateRow({ candidate, onClick, isLeading }: CandidateRowProps) {
  const c = candidate as Record<string, unknown>;
  const partyColor = getPartyColor(String(c.party || "IND"));
  const partyLabel = String(c.party || "IND");
  const photoUrl = String(c.photo_url || "").trim();
  const name = String(c.name || "");
  const age = Number(c.age || 0);
  const assets = Number(c.assets_value || 0);
  const crim = Number(c.criminal_cases || 0);

  return (
    <div 
      onClick={onClick}
      className={`group px-3 py-2.5 border-b border-[color:var(--border)] transition-colors ${onClick ? 'cursor-pointer hover:bg-[var(--surface-2)]' : ''}`}
    >
      <div className="flex items-center gap-2.5">
        <div className="relative mt-0.5 h-8 w-8 shrink-0 overflow-hidden rounded-md border border-[color:var(--border)] bg-[var(--surface-2)]">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <User className="h-4 w-4 text-[var(--text-muted)] opacity-70" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-mono text-[11px] font-semibold text-[var(--text-primary)]">
                {name}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span
                  title={partyLabel}
                  className="max-w-full rounded border border-[color:var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[9px] font-bold leading-tight text-[var(--text-primary)]"
                  style={{ borderLeftWidth: 3, borderLeftColor: partyColor }}
                >
                  <span className="block max-w-[235px] truncate md:max-w-[220px]">{partyLabel}</span>
                </span>

                {crim > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded border border-[#dc2626]/25 bg-[#dc2626]/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#b91c1c]">
                    <AlertTriangle className="h-3 w-3" /> {crim} case{crim !== 1 ? "s" : ""}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#16a34a]">
                    <CheckCircle className="h-3 w-3" /> CLEAN
                  </span>
                )}

                <span className="inline-flex items-center gap-1 rounded border border-[#ea580c]/25 bg-[#ea580c]/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#c2410c]">
                  {formatIndianCurrency(assets)}
                </span>

                {Boolean(c.removed) && (
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

            {age ? (
              <div className="shrink-0 rounded border border-[color:var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[9px] font-bold text-[var(--text-secondary)]">
                {age}y
              </div>
            ) : null}
          </div>

          <div className="mt-1 font-mono text-[9px] text-[var(--text-muted)]">
            {normalizeEducation(c.education)}
          </div>
        </div>
      </div>
      {onClick && <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)] opacity-50 group-hover:opacity-100 ml-1" />}
    </div>
  );
}
