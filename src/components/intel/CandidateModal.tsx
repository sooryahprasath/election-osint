"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  X,
  User,
  IndianRupee,
  AlertTriangle,
  GraduationCap,
  MapPin,
  Search,
  ExternalLink,
  Activity,
  Scale,
  Shield,
  Calendar,
  Link2,
  Building2,
  BadgeCheck,
} from "lucide-react";
import { formatIndianCurrency, normalizeEducation } from "@/lib/utils/formatting";
import { useLiveData } from "@/lib/context/LiveDataContext";

const getPartyColor = (party: string) => {
  const hash = party.split("").reduce((acc, char) => char.charCodeAt(0) + ((acc << 5) - acc), 0);
  return `hsl(${hash % 360}, 70%, 45%)`;
};

export type CandidateModalConstituency = {
  id?: string;
  name?: string;
  state?: string;
  district?: string;
  phase?: number;
  reservation?: string;
  electorate?: number;
};

function fmtIso(iso?: string | null) {
  if (!iso) return null;
  const d = Date.parse(iso);
  if (Number.isNaN(d)) return iso;
  return new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export default function CandidateModal({
  candidate,
  constituency,
  onClose,
}: {
  candidate: any;
  /** Seat context — shown prominently in the dossier header. */
  constituency?: CandidateModalConstituency | null;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [imgError, setImgError] = useState(false);
  const { signals, constituencies } = useLiveData();

  const seat =
    constituency ||
    constituencies.find((c: any) => c.id === candidate.constituency_id) ||
    null;

  useEffect(() => {
    setMounted(true);
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "auto";
    };
  }, []);

  const partyColor = candidate.party_color || getPartyColor(candidate.party || "IND");
  const partyName = candidate.party || "Independent";
  const eciUrl = candidate.eci_affidavit_url || candidate.source_url;
  const hasMyneta = Boolean(candidate.myneta_url && String(candidate.myneta_url).trim());

  const candidateSignals = signals
    .filter((s: any) => s.constituency_id === candidate.constituency_id)
    .slice(0, 5);

  const modalContent = (
    <div
      className="fixed inset-0 z-[9999] flex items-end justify-center sm:items-center p-0 sm:p-4 bg-black/55 backdrop-blur-md animate-fade-in-up"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dossier-title"
    >
      <div className="flex max-h-[100dvh] sm:max-h-[95vh] w-full sm:max-w-5xl flex-col overflow-hidden rounded-t-2xl border border-[color:var(--border)] bg-[var(--surface-1)] shadow-2xl sm:rounded-xl">
        {/* Header — mobile: taller tap target; desktop: compact strip */}
        <div
          className="shrink-0 border-b border-[color:var(--border)] bg-[var(--surface-2)] px-4 py-3 sm:py-3.5"
          style={{ borderLeftWidth: 4, borderLeftColor: partyColor }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)] sm:text-[10px]">
                Dossier file
              </p>
              <h1
                id="dossier-title"
                className="mt-0.5 break-words font-mono text-lg font-bold leading-tight text-[var(--text-primary)] sm:text-2xl"
              >
                {candidate.name}
              </h1>
              {seat?.name && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-[#0284c7]/25 bg-[#0284c7]/8 px-2 py-1 font-mono text-[10px] font-bold text-[#0369a1] sm:text-[11px]">
                    <MapPin className="h-3 w-3 shrink-0" />
                    <span className="break-words">
                      {seat.name}
                      {seat.state ? ` · ${seat.state}` : ""}
                    </span>
                  </span>
                  {seat.phase != null && (
                    <span className="rounded bg-[var(--surface-3)] px-2 py-0.5 font-mono text-[9px] text-[var(--text-secondary)]">
                      Phase {seat.phase}
                    </span>
                  )}
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className="inline-flex max-w-full items-center gap-2 rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold sm:text-xs"
                  style={{
                    borderColor: `${partyColor}55`,
                    backgroundColor: `${partyColor}12`,
                    color: "#27272a",
                  }}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full shadow-sm" style={{ backgroundColor: partyColor }} />
                  <span className="truncate">
                    {candidate.party_abbreviation ? `${candidate.party_abbreviation} · ` : ""}
                    {partyName}
                  </span>
                </span>
                {candidate.is_independent && (
                  <span className="rounded border border-[color:var(--border)] bg-[var(--surface-2)] px-2 py-0.5 font-mono text-[9px] font-bold text-[var(--text-secondary)]">
                    INDEPENDENT
                  </span>
                )}
                {candidate.incumbent && (
                  <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-[9px] font-bold text-emerald-800">
                    INCUMBENT
                  </span>
                )}
                {candidate.removed && (
                  <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 font-mono text-[9px] font-bold text-amber-900">
                    REMOVED FROM LATEST ECI LIST
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-lg p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text-primary)]"
              aria-label="Close dossier"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          {/* Mobile: single column stack. Desktop: photo + main grid */}
          <div className="flex flex-col gap-4 p-4 lg:flex-row lg:gap-6 lg:p-6">
            {/* Photo + sources */}
            <div className="flex w-full flex-col gap-3 lg:w-[220px] lg:shrink-0 xl:w-[240px]">
              <div className="mx-auto aspect-[3/4] w-full max-w-[200px] overflow-hidden rounded-xl border border-[color:var(--border)] bg-[var(--surface-2)] shadow-inner lg:mx-0 lg:max-w-none">
                {candidate.photo_url && !imgError ? (
                  <img
                    src={candidate.photo_url}
                    alt=""
                    className="h-full w-full object-cover"
                    onError={() => setImgError(true)}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <User className="h-16 w-16 text-[var(--text-muted)] opacity-60" />
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <a
                  href={eciUrl || "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 font-mono text-[10px] font-bold transition-colors sm:py-2 ${
                    eciUrl
                      ? "border-[#16a34a]/35 bg-[#16a34a]/10 text-[#15803d] hover:bg-[#16a34a] hover:text-white"
                      : "pointer-events-none border-[color:var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)]"
                  }`}
                >
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  ECI AFFIDAVIT
                </a>
                {hasMyneta ? (
                  <a
                    href={candidate.myneta_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 rounded-lg border border-[#0284c7]/35 bg-[#0284c7]/10 px-3 py-2.5 font-mono text-[10px] font-bold text-[#0369a1] transition-colors hover:bg-[#0284c7] hover:text-white sm:py-2"
                  >
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    ADR MYNETA PROFILE
                  </a>
                ) : (
                  <div className="rounded-lg border border-dashed border-[color:var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-center font-mono text-[9px] leading-snug text-[var(--text-muted)]">
                    <Link2 className="mx-auto mb-1 h-3.5 w-3.5 text-[var(--text-muted)] opacity-70" />
                    MyNeta link not linked yet. Re-run dossier ingest after a match is found.
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-[color:var(--border)] bg-[var(--surface-2)] p-3 font-mono text-[9px] text-[var(--text-secondary)]">
                <p className="mb-1 font-bold uppercase tracking-wider text-[var(--text-muted)]">Record IDs</p>
                <p className="break-all">
                  <span className="text-[var(--text-muted)]">Candidate:</span> {candidate.id}
                </p>
                {candidate.myneta_candidate_id && (
                  <p className="break-all">
                    <span className="text-[var(--text-muted)]">MyNeta ID:</span> {candidate.myneta_candidate_id}
                  </p>
                )}
                {candidate.constituency_id && (
                  <p className="break-all">
                    <span className="text-[var(--text-muted)]">Seat ID:</span> {candidate.constituency_id}
                  </p>
                )}
              </div>
            </div>

            {/* Main facts */}
            <div className="min-w-0 flex-1 space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
                <StatCard
                  icon={<User className="h-3.5 w-3.5" />}
                  label="Age / Gender"
                  value={
                    [candidate.age != null ? `${candidate.age} yrs` : null, candidate.gender].filter(Boolean).join(" · ") ||
                    "—"
                  }
                  tone="neutral"
                />
                <StatCard
                  icon={<GraduationCap className="h-3.5 w-3.5" />}
                  label="Education"
                  value={normalizeEducation(candidate.education) || "—"}
                  tone="neutral"
                />
                <StatCard
                  icon={<IndianRupee className="h-3.5 w-3.5" />}
                  label="Declared assets"
                  value={formatIndianCurrency(candidate.assets_value || 0)}
                  tone="wealth"
                />
                <StatCard
                  icon={<Scale className="h-3.5 w-3.5" />}
                  label="Liabilities"
                  value={formatIndianCurrency(candidate.liabilities_value || 0)}
                  tone="neutral"
                />
                <StatCard
                  icon={<AlertTriangle className="h-3.5 w-3.5" />}
                  label="Criminal cases"
                  value={
                    (candidate.criminal_cases || 0) > 0
                      ? `${candidate.criminal_cases} case(s) declared`
                      : "None declared"
                  }
                  tone={(candidate.criminal_cases || 0) > 0 ? "risk" : "ok"}
                />
                <StatCard
                  icon={<Shield className="h-3.5 w-3.5" />}
                  label="Nomination"
                  value={candidate.nomination_status || "—"}
                  tone="neutral"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-[color:var(--border)] bg-[var(--surface-2)] p-4">
                  <h3 className="mb-2 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                    <Building2 className="h-3.5 w-3.5 text-[#0284c7]" />
                    Constituency
                  </h3>
                  <ul className="space-y-1.5 font-mono text-[11px] text-[var(--text-primary)]">
                    <li>
                      <span className="text-[var(--text-muted)]">Name:</span> {seat?.name || "—"}
                    </li>
                    <li>
                      <span className="text-[var(--text-muted)]">State:</span> {seat?.state || "—"}
                    </li>
                    <li>
                      <span className="text-[var(--text-muted)]">District:</span> {seat?.district || "—"}
                    </li>
                    <li>
                      <span className="text-[var(--text-muted)]">Reservation:</span> {seat?.reservation || "GEN"}
                    </li>
                    {seat?.electorate != null && (
                      <li>
                        <span className="text-[var(--text-muted)]">Electorate (baseline):</span>{" "}
                        {Number(seat.electorate).toLocaleString("en-IN")}
                      </li>
                    )}
                  </ul>
                </div>

                <div className="rounded-xl border border-[color:var(--border)] bg-[var(--surface-2)] p-4">
                  <h3 className="mb-2 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                    <Calendar className="h-3.5 w-3.5 text-[#16a34a]" />
                    Source sync
                  </h3>
                  <ul className="space-y-1.5 font-mono text-[10px] text-[var(--text-primary)]">
                    <li className="flex items-start gap-2">
                      <BadgeCheck className="mt-0.5 h-3 w-3 shrink-0 text-[#16a34a]" />
                      <span>
                        <span className="text-[var(--text-muted)]">ECI last sync:</span>{" "}
                        {fmtIso(candidate.eci_last_synced_at) || "—"}
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <BadgeCheck className="mt-0.5 h-3 w-3 shrink-0 text-[#0284c7]" />
                      <span>
                        <span className="text-[var(--text-muted)]">MyNeta last sync:</span>{" "}
                        {fmtIso(candidate.myneta_last_synced_at) || "—"}
                      </span>
                    </li>
                  </ul>
                </div>
              </div>

              {candidate.background ? (
                <div className="rounded-xl border border-[color:var(--border)] bg-[var(--surface-1)] p-4">
                  <h3 className="mb-2 font-mono text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                    Background
                  </h3>
                  <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{candidate.background}</p>
                </div>
              ) : null}

              <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4">
                <h3 className="mb-2 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-200">
                  <Search className="h-3.5 w-3.5" />
                  Constituency signals
                </h3>
                {candidateSignals.length > 0 ? (
                  <ul className="space-y-2">
                    {candidateSignals.map((sig: any) => (
                      <li key={sig.id} className="flex gap-2 text-sm text-amber-100">
                        <Activity
                          className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${(sig.severity || 0) >= 4 ? "text-[#dc2626]" : "text-[#16a34a]"}`}
                        />
                        <span>{sig.title}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-amber-200/80">No recent signals tied to this seat.</p>
                )}
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

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: "neutral" | "wealth" | "risk" | "ok";
}) {
  const styles = {
    neutral: "border-[color:var(--border)] bg-[var(--surface-2)] text-[var(--text-primary)]",
    wealth: "border-[#ea580c]/25 bg-[#fff7ed] text-[#c2410c]",
    risk: "border-[#dc2626]/25 bg-[#fef2f2] text-[#b91c1c]",
    ok: "border-[#16a34a]/25 bg-[#f0fdf4] text-[#15803d]",
  }[tone];
  return (
    <div className={`rounded-xl border p-3 ${styles}`}>
      <div className="mb-1 flex items-center gap-1.5 font-mono text-[8px] font-bold uppercase tracking-wider opacity-80">
        {icon}
        {label}
      </div>
      <div className="break-words font-mono text-[11px] font-semibold leading-snug sm:text-xs">{value}</div>
    </div>
  );
}
