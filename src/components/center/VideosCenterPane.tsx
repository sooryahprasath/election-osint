"use client";

import { useMemo, useState } from "react";
import { Play, ExternalLink, Search, CheckCircle2 } from "lucide-react";
import { useLiveData } from "@/lib/context/LiveDataContext";
import { relativeTime } from "@/lib/utils/formatting";
import { excludeFromIntelligenceFeed } from "@/lib/utils/signalClassifier";
import { usePullToRefresh } from "@/lib/hooks/usePullToRefresh";

function getYouTubeThumbnail(videoUrl?: string) {
  if (!videoUrl) return "";
  const embedMatch = videoUrl.match(/embed\/([^?]+)/);
  if (embedMatch?.[1]) return `https://img.youtube.com/vi/${embedMatch[1]}/hqdefault.jpg`;
  const vMatch = videoUrl.match(/[?&]v=([^&]+)/);
  if (vMatch?.[1]) return `https://img.youtube.com/vi/${vMatch[1]}/hqdefault.jpg`;
  return "";
}

export default function VideosCenterPane({
  globalStateFilter,
  onSelectSignal,
}: {
  globalStateFilter: string;
  onSelectSignal: (s: unknown) => void;
}) {
  const { signals, refreshSignals } = useLiveData();
  const [q, setQ] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const { ref: scrollRef, pullPx, state: pullState } = usePullToRefresh({
    enabled: true,
    onRefresh: refreshSignals,
  });

  const videos = useMemo(() => {
    const filtered = signals.filter((s: unknown) => {
      const ss = s as Record<string, unknown>;
      if (excludeFromIntelligenceFeed(s)) return false;
      if (!ss.video_url) return false;
      if (globalStateFilter !== "ALL" && ss.state !== globalStateFilter) return false;
      if (verifiedOnly && !ss.verified) return false;
      if (q.trim()) {
        const t = `${String(ss.title || "")} ${String(ss.body || "")} ${String(ss.source || "")}`.toLowerCase();
        if (!t.includes(q.trim().toLowerCase())) return false;
      }
      return true;
    }).slice();
    filtered.sort((a: unknown, b: unknown) => {
      const aa = a as Record<string, unknown>;
      const bb = b as Record<string, unknown>;
      return (Date.parse(String(bb.created_at || "")) || 0) - (Date.parse(String(aa.created_at || "")) || 0);
    });
    return filtered.slice(0, 24);
  }, [signals, globalStateFilter, q, verifiedOnly]);

  return (
    <section className="flex h-full min-h-0 flex-col bg-[var(--surface-1)]">
      <div className="shrink-0 border-b border-[color:var(--border)] bg-[var(--surface-1)]/90 px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-1.5 rounded-md border border-[color:var(--border)] bg-[var(--surface-1)] px-2 py-1">
            <Search className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search videos…"
              className="w-full bg-transparent font-mono text-[10px] text-[var(--text-primary)] placeholder-[color:var(--text-muted)] outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => setVerifiedOnly((v) => !v)}
            className={[
              "shrink-0 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] font-bold",
              verifiedOnly
                ? "border-emerald-500/25 bg-emerald-500/10 text-[#16a34a]"
                : "border-[color:var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:bg-[var(--surface-2)]",
            ].join(" ")}
            aria-pressed={verifiedOnly}
            title="Toggle verified-only"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> VERIFIED
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto pb-24 max-md:pb-28 md:pb-3 pt-2 pretty-scroll overscroll-contain touch-pan-y"
      >
        {/* Pull-to-refresh chrome (mobile only) */}
        <div
          className="flex items-center justify-center"
          style={{
            height: pullPx ? pullPx : 0,
            transition: pullState === "refreshing" ? "none" : "height 120ms ease",
          }}
        >
          {pullPx ? (
            <div className="rounded-md border border-[color:var(--border)] bg-[var(--surface-2)] px-2 py-1 font-mono text-[9px] font-bold text-[var(--text-secondary)]">
              {pullState === "refreshing" ? "REFRESHING…" : pullState === "ready" ? "RELEASE TO REFRESH" : "PULL TO REFRESH"}
            </div>
          ) : null}
        </div>
        {videos.length === 0 ? (
          <div className="p-6 text-center font-mono text-[10px] text-[var(--text-muted)]">
            No videos found for this scope yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 p-3 md:grid-cols-2 xl:grid-cols-3">
            {videos.map((s: unknown) => {
              const ss = s as Record<string, unknown>;
              const thumb = getYouTubeThumbnail(String(ss.video_url || ""));
              return (
                <article
                  key={String(ss.id || "")}
                  onClick={() => onSelectSignal(s)}
                  className="overflow-hidden rounded-xl border border-[color:var(--border)] bg-[var(--surface-1)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
                >
                  <div className="flex flex-col md:flex-row">
                    <div className="relative w-full md:w-[240px] shrink-0 bg-[#0b1220]">
                      <div className="aspect-video md:aspect-auto md:h-full">
                        {thumb ? (
                          <button
                            type="button"
                            onClick={() => onSelectSignal(s)}
                            className="h-full w-full text-left"
                            aria-label="Open video"
                          >
                            <img src={thumb} alt="" className="h-full w-full object-cover opacity-90" />
                          </button>
                        ) : null}
                      </div>
                      <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/35 via-black/0 to-black/0" />
                      <button
                        type="button"
                        onClick={() => onSelectSignal(s)}
                        className="absolute bottom-2 left-2 flex items-center gap-1 rounded-md bg-black/55 px-2 py-1 font-mono text-[9px] font-bold text-white hover:bg-black/65"
                      >
                        <Play className="h-3 w-3" /> PLAY
                      </button>
                    </div>

                    <div className="flex-1 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-[9px] font-bold text-[var(--text-muted)] shrink-0">
                            {String(ss.state || "INDIA").toUpperCase()}
                          </span>
                          <span className="min-w-0 truncate font-mono text-[9px] text-[var(--text-muted)]">{String(ss.source || "VIDEO").toUpperCase()}</span>
                        </div>
                        <span className="font-mono text-[9px] text-[var(--text-muted)] shrink-0" suppressHydrationWarning>
                          {relativeTime(
                            new Date(
                              String(
                                ss.created_at ||
                                  (ss as Record<string, unknown>).createdAt ||
                                  (ss as Record<string, unknown>).created_at ||
                                  ""
                              )
                            )
                          )}
                        </span>
                      </div>

                      <div className="mt-1 text-[12px] font-semibold leading-tight text-[var(--text-primary)] line-clamp-2">
                        {String(ss.title || "")}
                      </div>

                      {ss.body ? (
                        <div className="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)] line-clamp-2">
                          {String(ss.body)}
                        </div>
                      ) : null}

                      <div className="mt-2 flex items-center justify-between">
                        <div className="flex flex-wrap gap-1.5">
                          <span className={`font-mono text-[8px] font-bold px-1.5 py-0.5 rounded border ${ss.verified ? "text-[#16a34a] bg-[#16a34a]/10 border-[#16a34a]/25" : "text-[#ea580c] bg-[#ea580c]/10 border-[#ea580c]/25"}`}>
                            {ss.verified ? "VERIFIED" : "UNVERIFIED"}
                          </span>
                          <span className="font-mono text-[8px] font-bold text-[var(--text-muted)] bg-[var(--surface-2)] border border-[color:var(--border)] px-1.5 py-0.5 rounded">
                            SEV-{Number(ss.severity || 1)}
                          </span>
                        </div>

                        <a
                          href={String(ss.video_url || "")}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 font-mono text-[9px] font-bold text-[#0284c7] hover:underline"
                        >
                          OPEN <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

