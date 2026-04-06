"use client";

import { MapPin, ExternalLink } from "lucide-react";
import { relativeTime, severityLabel } from "@/lib/utils/formatting";

interface SignalCardProps {
  signal: any;
  tick?: number; // 🔥 FIX: Accept the tick to force re-evaluation of relativeTime
  onClick: () => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  breaking: "#dc2626",
  alert: "#ea580c",
  analysis: "#0284c7",
  official: "#16a34a",
  rumor: "#52525b",
};

export default function SignalCard({ signal, tick, onClick }: SignalCardProps) {
  const categoryColor = CATEGORY_COLORS[signal.category || "breaking"] || "#52525b";
  const isNational = !signal.state;
  const isSev4 = (signal.severity || 1) >= 4;

  return (
    <article
      onClick={onClick}
      className={`px-3 py-2.5 border-b border-[#e4e4e7] hover:bg-[#f4f4f5] transition-colors animate-fade-in-up severity-${signal.severity} cursor-pointer`}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span
            className="font-mono text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded"
            style={{ color: categoryColor, backgroundColor: `${categoryColor}15`, border: `1px solid ${categoryColor}30` }}
          >
            {(signal.category || "ALERT").toUpperCase()}
          </span>
          <span
            className="font-mono text-[9px] font-bold"
            style={{ color: signal.severity >= 4 ? "#dc2626" : signal.severity >= 3 ? "#ea580c" : "#555555" }}
          >
            SEV-{signal.severity} {severityLabel(signal.severity)}
          </span>
        </div>
        {/* 🔥 FIX: This will now auto-update every 60 seconds because the parent ticks */}
        <span className="font-mono text-[9px] text-[#71717a]" suppressHydrationWarning>
          {relativeTime(new Date(signal.created_at || signal.createdAt))}
        </span>
      </div>

      <h3 className="text-[11px] font-semibold text-[#18181b] leading-tight mb-1 group-hover:text-[#0284c7] transition-colors">
        {signal.title}
      </h3>

      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {signal.verified ? (
          <span className="font-mono text-[8px] font-bold text-[#16a34a] bg-[#16a34a]/10 border border-[#16a34a]/25 px-1.5 py-0.5 rounded">
            VERIFIED
          </span>
        ) : (
          <span className="font-mono text-[8px] font-bold text-[#ea580c] bg-[#ea580c]/10 border border-[#ea580c]/25 px-1.5 py-0.5 rounded">
            UNVERIFIED
          </span>
        )}
        {signal.video_url && (
          <span className="font-mono text-[8px] font-bold text-[#0284c7] bg-[#0284c7]/10 border border-[#0284c7]/25 px-1.5 py-0.5 rounded">
            VIDEO
          </span>
        )}
        <span className="font-mono text-[8px] font-bold text-[#52525b] bg-[#f4f4f5] border border-[#e4e4e7] px-1.5 py-0.5 rounded">
          {isNational ? "NATIONAL" : "LOCAL"}
        </span>
        {isSev4 && (
          <span className="font-mono text-[8px] font-bold text-[#dc2626] bg-[#dc2626]/10 border border-[#dc2626]/25 px-1.5 py-0.5 rounded">
            SEV-4+
          </span>
        )}
      </div>

      <p className="text-[10px] text-[#52525b] leading-relaxed line-clamp-2 mb-1.5">
        {signal.body}
      </p>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] text-[#71717a]">SRC:</span>
          <a
            href={signal.source_url || `https://news.google.com/search?q=${encodeURIComponent(signal.source + ' ' + signal.title)}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="font-mono text-[9px] text-[#0284c7] hover:underline flex items-center gap-1 font-semibold"
          >
            {signal.source} <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </div>
        {signal.latitude && signal.longitude && (
          <div className="flex items-center gap-1">
            <MapPin className="h-2.5 w-2.5 text-[#16a34a]" />
            <span className="font-mono text-[9px] text-[#71717a]">
              {signal.latitude.toFixed(2)}°N {signal.longitude.toFixed(2)}°E
            </span>
          </div>
        )}
      </div>
    </article>
  );
}