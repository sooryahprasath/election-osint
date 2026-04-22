"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Video } from "lucide-react";
import AIBriefing, { type AIBriefingMeta } from "./AIBriefing";
import { useLiveData } from "@/lib/context/LiveDataContext";
import { excludeFromIntelligenceFeed } from "@/lib/utils/signalClassifier";
import { STATE_META } from "@/lib/utils/states";

export default function SignalPane({
  globalStateFilter,
  globalConstituencyId,
  centerMode,
  onChangeGlobalStateFilter,
  onSelectSignal,
  onOpenSignals,
}: any) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ videos: false, briefing: false });
  const [briefMeta, setBriefMeta] = useState<AIBriefingMeta | null>(null);
  const { signals, constituencies } = useLiveData();

  const activeConst = constituencies.find((c: any) => c.id === globalConstituencyId);
  const effectiveState = activeConst ? activeConst.state : globalStateFilter;

  // Progressive disclosure: on mobile, start with Briefing visible (videos collapsed).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.innerWidth < 768) {
      setCollapsed((c) => ({ ...c, videos: true, briefing: false }));
    }
  }, []);

  const getYouTubeThumbnail = (videoUrl?: string) => {
    if (!videoUrl) return "";
    // Supports embed URLs like https://www.youtube.com/embed/<id>?...
    const embedMatch = videoUrl.match(/embed\/([^?]+)/);
    if (embedMatch?.[1]) return `https://img.youtube.com/vi/${embedMatch[1]}/hqdefault.jpg`;
    // Fallback: try v= query param
    const vMatch = videoUrl.match(/[?&]v=([^&]+)/);
    if (vMatch?.[1]) return `https://img.youtube.com/vi/${vMatch[1]}/hqdefault.jpg`;
    return "";
  };

  const videoSignals = useMemo(() => {
    const filtered = signals.filter((s: any) => {
      if (excludeFromIntelligenceFeed(s)) return false;
      if (!s.video_url) return false;
      if (effectiveState !== "ALL") return s.state === effectiveState;
      return true;
    });
    filtered.sort((a: any, b: any) => {
      const at = Date.parse(a.created_at || "") || 0;
      const bt = Date.parse(b.created_at || "") || 0;
      return bt - at;
    });
    return filtered.slice(0, 12);
  }, [signals, effectiveState]);

  const showStateSignalsInsteadOfBriefing = centerMode === "map" || centerMode === "videos";

  const stateSignals = useMemo(() => {
    const filtered = signals.filter((s: any) => {
      if (excludeFromIntelligenceFeed(s)) return false;
      if (effectiveState !== "ALL") return s.state === effectiveState;
      return true;
    });
    filtered.sort((a: any, b: any) => {
      const at = Date.parse(a.created_at || "") || 0;
      const bt = Date.parse(b.created_at || "") || 0;
      return bt - at;
    });
    return filtered.slice(0, 20);
  }, [signals, effectiveState]);

  const liveStates = useMemo(() => Array.from(new Set(constituencies.map((c: any) => c.state))).filter(Boolean) as string[], [constituencies]);

  return (
    <aside className="flex flex-col h-full w-full overflow-hidden bg-[var(--surface-1)]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--border)] shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
            {globalConstituencyId ? "Seat brief" : "Today's brief"}
          </h2>
        </div>
        <span className="text-[11px] text-[var(--text-muted)] num font-mono tabular-nums">
          {videoSignals.length} {videoSignals.length === 1 ? "video" : "videos"}
        </span>
      </div>

      {/* Hide scrollbar chrome (still scrollable). */}
      <div className="flex-1 overflow-y-auto no-scrollbar overscroll-contain pb-8 max-md:pb-16 md:pb-3">
        {/* Videos */}
        <div className="border-b border-[color:var(--border)]">
          <button
            onClick={() => setCollapsed({ ...collapsed, videos: !collapsed.videos })}
            className="flex items-center justify-between w-full px-4 py-2.5 hover:bg-[var(--surface-2)] transition-colors"
            aria-expanded={!collapsed.videos}
          >
            <span className="text-[12px] font-semibold text-[var(--text-secondary)] flex items-center gap-1.5">
              <Video className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden /> Videos
            </span>
            {collapsed.videos ? <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" /> : <ChevronUp className="h-4 w-4 text-[var(--text-muted)]" />}
          </button>
          {!collapsed.videos && (
            <div className="px-4 pb-3">
              {videoSignals.length > 0 ? (
                <div className="flex gap-2 overflow-x-auto py-1 pr-1 no-scrollbar">
                  {videoSignals.map((s: any) => {
                    const thumb = getYouTubeThumbnail(s.video_url);
                    return (
                      <button
                        key={s.id}
                        onClick={() => onSelectSignal(s)}
                        className="shrink-0 w-[164px] rounded-[var(--radius)] border border-[color:var(--border)] bg-[var(--surface-1)] hover:bg-[var(--surface-2)] hover:border-[color:var(--border-strong)] transition-colors overflow-hidden text-left"
                        title={s.title}
                      >
                        <div className="w-full aspect-video bg-[var(--surface-3)] relative">
                          {thumb ? (
                            <img src={thumb} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[var(--text-muted)] text-[11px]">
                              No preview
                            </div>
                          )}
                        </div>
                        <div className="p-2">
                          <div className="text-[11px] text-[var(--text-muted)] truncate">
                            {s.state || "India"}
                          </div>
                          <div className="mt-0.5 text-[12px] font-medium text-[var(--text-primary)] leading-snug line-clamp-2">
                            {s.title}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-[var(--radius)] border border-dashed border-[color:var(--border)] bg-[var(--surface-2)] p-3 text-center">
                  <div className="text-[12px] text-[var(--text-muted)]">
                    No videos for this area yet.
                  </div>
                  {typeof onOpenSignals === "function" ? (
                    <button type="button" onClick={onOpenSignals} className="eb-btn-secondary mt-2">
                      Open news
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-b border-[color:var(--border)]">
          <button
            onClick={() => setCollapsed({ ...collapsed, briefing: !collapsed.briefing })}
            className="flex items-center justify-between w-full px-4 py-2.5 hover:bg-[var(--surface-2)] transition-colors"
            aria-expanded={!collapsed.briefing}
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="text-[12px] font-semibold text-[var(--text-secondary)] shrink-0">Daily brief</span>
              {!collapsed.briefing && briefMeta ? (
                <span className="min-w-0 truncate text-[11px] text-[var(--text-muted)]" suppressHydrationWarning>
                  {briefMeta.title.replace(" AI BRIEF", "").replace(/\bAI\b/gi, "").trim()} · {briefMeta.dateLabel}
                </span>
              ) : null}
            </div>
            {!collapsed.briefing && briefMeta ? (
              <span className="shrink-0 text-[11px] text-[var(--text-muted)]" suppressHydrationWarning>
                <span className="num font-mono tabular-nums">{briefMeta.sourcesCount}</span> sources
              </span>
            ) : null}
            {collapsed.briefing ? <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" /> : <ChevronUp className="h-4 w-4 text-[var(--text-muted)]" />}
          </button>
          {!collapsed.briefing ? (
            showStateSignalsInsteadOfBriefing ? (
              <div className="px-4 pb-3">
                <div className="mt-2 overflow-x-auto no-scrollbar">
                  <div className="eb-pills">
                    <button
                      type="button"
                      data-active={effectiveState === "ALL"}
                      onClick={() => onChangeGlobalStateFilter?.("ALL")}
                      className="eb-pill"
                    >
                      All
                    </button>
                    {liveStates.map((state) => {
                      const meta = STATE_META[state];
                      const isActive = effectiveState === state;
                      return (
                        <button
                          key={state}
                          type="button"
                          data-active={isActive}
                          onClick={() => onChangeGlobalStateFilter?.(state)}
                          className="eb-pill"
                        >
                          {meta?.abbr || state}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-3 grid gap-2">
                  {stateSignals.map((s: any) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onSelectSignal?.(s)}
                      className="w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[var(--surface-1)] px-3 py-2.5 text-left hover:bg-[var(--surface-2)] hover:border-[color:var(--border-strong)] transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-[var(--text-muted)] truncate">
                          {s.state || "India"} · S<span className="num font-mono tabular-nums">{s.severity || 1}</span>
                        </span>
                        <span className="text-[11px] text-[var(--text-muted)] shrink-0">{s.verified ? "Verified" : "Unverified"}</span>
                      </div>
                      <div className="mt-1 text-[13px] font-medium leading-snug text-[var(--text-primary)] line-clamp-2">{s.title}</div>
                      {s.body ? (
                        <div className="mt-1 text-[12px] leading-snug text-[var(--text-muted)] line-clamp-2">{s.body}</div>
                      ) : null}
                    </button>
                  ))}
                  {stateSignals.length === 0 ? (
                    <div className="rounded-[var(--radius)] border border-dashed border-[color:var(--border)] bg-[var(--surface-2)] p-4 text-center text-[12px] text-[var(--text-muted)]">
                      No news here yet. Try another state or check back later.
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <AIBriefing onMeta={setBriefMeta} />
            )
          ) : null}
        </div>
      </div>
    </aside>
  );
}