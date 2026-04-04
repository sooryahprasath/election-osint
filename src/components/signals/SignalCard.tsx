"use client";

import { MapPin, ExternalLink } from "lucide-react";
import type { Signal } from "@/lib/supabase";
import { relativeTime, severityLabel } from "@/lib/utils/formatting";

interface SignalCardProps {
  signal: any;
}

const CATEGORY_COLORS: Record<string, string> = {
  breaking: "#dc2626",
  alert: "#ea580c",
  analysis: "#0284c7",
  official: "#16a34a",
  rumor: "#52525b",
};

export default function SignalCard({ signal }: SignalCardProps) {
  const categoryColor = CATEGORY_COLORS[signal.category || "breaking"] || "#52525b";

  return (
    <article
      className={`px-3 py-2.5 border-b border-[#e4e4e7] hover:bg-[#f4f4f5] transition-colors animate-fade-in-up severity-${signal.severity}`}
    >
      {/* Top row: category + time */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span
            className="font-mono text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded"
            style={{
              color: categoryColor,
              backgroundColor: `${categoryColor}15`,
              border: `1px solid ${categoryColor}30`,
            }}
          >
            {(signal.category || "ALERT").toUpperCase()}
          </span>
          <span
            className="font-mono text-[9px] font-bold"
            style={{
              color:
                signal.severity >= 4
                  ? "#dc2626"
                  : signal.severity >= 3
                  ? "#ea580c"
                  : "#555555",
            }}
          >
            SEV-{signal.severity} {severityLabel(signal.severity)}
          </span>
        </div>
        <span className="font-mono text-[9px] text-[#71717a]" suppressHydrationWarning>{relativeTime(new Date(signal.created_at || signal.createdAt))}
        </span>
      </div>

      {/* Title */}
      <h3 className="text-[11px] font-semibold text-[#18181b] leading-tight mb-1">
        {signal.title}
      </h3>

      {/* Body */}
      <p className="text-[10px] text-[#52525b] leading-relaxed line-clamp-2 mb-1.5">
        {signal.body}
      </p>

      {/* Bottom row: source + location */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] text-[#71717a]">
            SRC: {signal.source}
          </span>
          {signal.sourceUrl && (
            <ExternalLink className="h-2.5 w-2.5 text-[#71717a]" />
          )}
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

      {/* Sentiment bar */}
      <div className="mt-1.5 flex items-center gap-2">
        <span className="font-mono text-[8px] text-[#71717a]">SENT</span>
        <div className="flex-1 h-1 bg-[#e4e4e7] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.abs(signal.sentimentScore || 0) * 100}%`,
              backgroundColor:
                (signal.sentimentScore || 0) > 0
                  ? "#16a34a"
                  : (signal.sentimentScore || 0) < -0.5
                  ? "#dc2626"
                  : "#ea580c",
              marginLeft:
                (signal.sentimentScore || 0) < 0
                  ? `${(1 - Math.abs(signal.sentimentScore || 0)) * 50}%`
                  : "50%",
            }}
          />
        </div>
        <span className="font-mono text-[8px] text-[#71717a] tabular-nums w-6 text-right">
          {(signal.sentimentScore || 0) > 0 ? "+" : ""}
          {(signal.sentimentScore || 0).toFixed(1)}
        </span>
      </div>
    </article>
  );
}
