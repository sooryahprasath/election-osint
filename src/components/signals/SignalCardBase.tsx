"use client";

import { ExternalLink, MapPin } from "lucide-react";
import { relativeTime, severityLabel } from "@/lib/utils/formatting";

const CATEGORY_COLORS: Record<string, string> = {
  breaking: "#dc2626",
  alert: "#ea580c",
  analysis: "#0284c7",
  official: "#16a34a",
  rumor: "#52525b",
  social: "#16a34a",
};

export default function SignalCardBase({
  signal,
  tone = "plain",
  onClick,
  showBody = true,
  showChips = true,
  showCoords = true,
}: {
  signal: any;
  tone?: "plain" | "soft" | "accentGreen" | "accentBlue";
  onClick?: () => void;
  showBody?: boolean;
  showChips?: boolean;
  showCoords?: boolean;
}) {
  const categoryColor = CATEGORY_COLORS[String(signal.category || "breaking").toLowerCase()] || "#52525b";
  const isNational = !signal.state;
  const isSev4 = (signal.severity || 1) >= 4;
  const isVerified = Boolean(signal.verified);
  const hasVideo = Boolean(signal.video_url);
  const thumbUrl = typeof signal.image_url === "string" ? signal.image_url.trim() : "";

  const shell =
    tone === "accentGreen"
      ? "rounded-lg border border-emerald-200 bg-emerald-50/30 shadow-[0_1px_0_rgba(0,0,0,0.04)]"
      : tone === "accentBlue"
        ? "rounded-lg border border-sky-200 bg-sky-50/30 shadow-[0_1px_0_rgba(0,0,0,0.04)]"
        : tone === "soft"
          ? "rounded-lg border border-[color:var(--border)] bg-[var(--surface-2)] shadow-[0_1px_0_rgba(0,0,0,0.04)]"
          : "border-b border-[color:var(--border)]";

  return (
    <article
      onClick={onClick}
      className={[
        shell,
        onClick ? "cursor-pointer hover:bg-[var(--surface-2)] transition-colors" : "",
        tone === "plain" ? "px-3 py-2.5" : "p-3",
      ].join(" ")}
    >
      <div className="flex gap-3">
        {thumbUrl ? (
          <div className="shrink-0">
            <img
              src={thumbUrl}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="h-[52px] w-[52px] rounded-lg border border-[color:var(--border)] object-cover bg-[var(--surface-1)]"
            />
          </div>
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between mb-1 gap-2">
            <div className="flex items-center gap-2 min-w-0">
          <span
            className="shrink-0 font-mono text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded"
            style={{ color: categoryColor, backgroundColor: `${categoryColor}15`, border: `1px solid ${categoryColor}30` }}
          >
            {(signal.category || "ALERT").toUpperCase()}
          </span>
          <span
            className="shrink-0 font-mono text-[9px] font-bold"
            style={{ color: signal.severity >= 4 ? "#dc2626" : signal.severity >= 3 ? "#ea580c" : "var(--text-secondary)" }}
          >
            SEV-{signal.severity} {severityLabel(signal.severity)}
          </span>
          <span className="truncate font-mono text-[9px] font-bold text-[var(--text-muted)]">
            {(signal.state ? String(signal.state).toUpperCase() : "INDIA")}
          </span>
            </div>
            <span className="shrink-0 font-mono text-[9px] text-[var(--text-muted)]" suppressHydrationWarning>
              {relativeTime(new Date(signal.created_at || signal.createdAt))}
            </span>
          </div>

          <h3 className="text-[14px] sm:text-[12px] font-semibold text-[var(--text-primary)] leading-tight mb-1 line-clamp-2">
            {signal.title}
          </h3>

          {showChips ? (
            <>
              {/* Mobile: keep it calm, show top 2 chips + overflow */}
              <div className="flex flex-wrap gap-1.5 mb-1.5 sm:hidden">
                <span
                  className={`font-mono text-[8px] font-bold px-1.5 py-0.5 rounded border ${
                    isVerified
                      ? "text-[#16a34a] bg-[#16a34a]/10 border-[#16a34a]/25"
                      : "text-[#ea580c] bg-[#ea580c]/10 border-[#ea580c]/25"
                  }`}
                >
                  {isVerified ? "VERIFIED" : "UNVERIFIED"}
                </span>
                <span className="font-mono text-[8px] font-bold text-[var(--text-muted)] bg-[var(--surface-2)] border border-[color:var(--border)] px-1.5 py-0.5 rounded">
                  {isNational ? "NATIONAL" : "LOCAL"}
                </span>
                {(() => {
                  const extra = (hasVideo ? 1 : 0) + (isSev4 ? 1 : 0);
                  return extra > 0 ? (
                    <span className="font-mono text-[8px] font-bold text-[var(--text-muted)] bg-[var(--surface-2)] border border-[color:var(--border)] px-1.5 py-0.5 rounded">
                      +{extra}
                    </span>
                  ) : null;
                })()}
              </div>

              {/* Desktop: show all chips */}
              <div className="hidden sm:flex flex-wrap gap-1.5 mb-1.5">
                {isVerified ? (
                  <span className="font-mono text-[8px] font-bold text-[#16a34a] bg-[#16a34a]/10 border border-[#16a34a]/25 px-1.5 py-0.5 rounded">
                    VERIFIED
                  </span>
                ) : (
                  <span className="font-mono text-[8px] font-bold text-[#ea580c] bg-[#ea580c]/10 border border-[#ea580c]/25 px-1.5 py-0.5 rounded">
                    UNVERIFIED
                  </span>
                )}
                {hasVideo ? (
                  <span className="font-mono text-[8px] font-bold text-[#0284c7] bg-[#0284c7]/10 border border-[#0284c7]/25 px-1.5 py-0.5 rounded">
                    VIDEO
                  </span>
                ) : null}
                <span className="font-mono text-[8px] font-bold text-[var(--text-muted)] bg-[var(--surface-2)] border border-[color:var(--border)] px-1.5 py-0.5 rounded">
                  {isNational ? "NATIONAL" : "LOCAL"}
                </span>
                {isSev4 ? (
                  <span className="font-mono text-[8px] font-bold text-[#dc2626] bg-[#dc2626]/10 border border-[#dc2626]/25 px-1.5 py-0.5 rounded">
                    SEV-4+
                  </span>
                ) : null}
              </div>
            </>
          ) : null}

          {showBody && signal.body ? (
            <p className="text-[14px] sm:text-[11px] text-[var(--text-secondary)] leading-relaxed line-clamp-2 mb-1.5">
              {signal.body}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-[9px] text-[var(--text-muted)]">SRC:</span>
              <a
                href={signal.source_url || `https://news.google.com/search?q=${encodeURIComponent(String(signal.source || "") + " " + String(signal.title || ""))}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="min-w-0 truncate font-mono text-[9px] text-[#0284c7] hover:underline inline-flex items-center gap-1 font-semibold"
                title={signal.source_url || signal.source}
              >
                {String(signal.source || "SOURCE")} <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>
            {showCoords && signal.latitude && signal.longitude ? (
              <div className="flex items-center gap-1 shrink-0">
                <MapPin className="h-2.5 w-2.5 text-[#16a34a]" />
                <span className="font-mono text-[9px] text-[var(--text-muted)]">
                  {Number(signal.latitude).toFixed(2)}°N {Number(signal.longitude).toFixed(2)}°E
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

