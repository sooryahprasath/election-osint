"use client";

import { useEffect, useMemo, useState } from "react";
import { Radio, ChevronDown, ChevronUp, Video } from "lucide-react";
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
    <aside className="flex flex-col h-full w-full overflow-hidden bg-[var(--surface-1)] border-r border-[color:var(--border)]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[color:var(--border)] shrink-0">
        <div className="flex items-center gap-2">
          <Radio className="h-3.5 w-3.5 text-[#16a34a] animate-pulse" />
          <span className="font-mono text-xs font-bold text-[#16a34a] tracking-wider">
            {globalConstituencyId ? "LOCAL · BRIEFING" : "AI BRIEFING"}
          </span>
        </div>
        <span className="font-mono text-[10px] text-[var(--text-muted)]">{videoSignals.length} VIDEOS</span>
      </div>

      {/* Hide scrollbar chrome (still scrollable). */}
      <div className="flex-1 overflow-y-auto no-scrollbar overscroll-contain pb-8 max-md:pb-16 md:pb-3">
        {/* Video Intel Strip */}
        <div className="border-b border-[color:var(--border)]">
          <button
            onClick={() => setCollapsed({ ...collapsed, videos: !collapsed.videos })}
            className="flex items-center justify-between w-full px-3 py-1.5 hover:bg-[var(--surface-2)]"
          >
            <span className="font-mono text-[10px] text-[var(--text-secondary)] tracking-wider flex items-center gap-1.5">
              <Video className="h-3 w-3" /> ◆ VIDEO INTEL
            </span>
            {collapsed.videos ? <ChevronDown className="h-3 w-3 text-[var(--text-muted)]" /> : <ChevronUp className="h-3 w-3 text-[var(--text-muted)]" />}
          </button>
          {!collapsed.videos && (
            <div className="px-3 pb-3">
              {videoSignals.length > 0 ? (
                <div className="flex gap-2 overflow-x-auto py-1 pr-1">
                  {videoSignals.map((s: any) => {
                    const thumb = getYouTubeThumbnail(s.video_url);
                    return (
                      <button
                        key={s.id}
                        onClick={() => onSelectSignal(s)}
                        className="shrink-0 w-[156px] rounded-lg border border-[color:var(--border)] bg-[var(--surface-1)] hover:bg-[var(--surface-2)] transition-colors overflow-hidden text-left"
                        title={s.title}
                      >
                        <div className="w-full aspect-video bg-[#0f172a] relative">
                          {thumb ? (
                            <img src={thumb} alt="" className="w-full h-full object-cover opacity-90" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[var(--text-muted)] font-mono text-[9px]">
                              NO THUMB
                            </div>
                          )}
                          <div className="absolute bottom-1 left-1 font-mono text-[8px] font-bold bg-black/60 text-white px-1.5 py-0.5 rounded">
                            SEV-{s.severity || 1}
                          </div>
                        </div>
                        <div className="p-2">
                          <div className="font-mono text-[9px] font-bold text-[var(--text-muted)] truncate">
                            {(s.state || "INDIA").toUpperCase()}
                          </div>
                          <div className="text-[10px] text-[var(--text-primary)] leading-tight line-clamp-2">
                            {s.title}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="p-3 text-center">
                  <div className="font-mono text-[10px] text-[var(--text-muted)]">
                    No video intel available for this scope yet.
                  </div>
                  {typeof onOpenSignals === "function" ? (
                    <button
                      type="button"
                      onClick={onOpenSignals}
                      className="mt-2 rounded-lg border border-[color:var(--border)] bg-[var(--surface-1)] px-3 py-2 font-mono text-[10px] font-bold text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
                    >
                      OPEN SIGNALS
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-b border-[color:var(--border)]">
          <button onClick={() => setCollapsed({ ...collapsed, briefing: !collapsed.briefing })} className="flex items-center justify-between w-full px-3 py-1.5 hover:bg-[var(--surface-2)]">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="font-mono text-[10px] text-[var(--text-muted)] tracking-wider shrink-0">◆ AI BRIEFING</span>
              {!collapsed.briefing && briefMeta ? (
                <span className="min-w-0 truncate font-mono text-[10px] font-bold text-[var(--text-secondary)]" suppressHydrationWarning>
                  {briefMeta.title.replace(" AI BRIEF", "")} · {briefMeta.dateLabel}
                </span>
              ) : null}
            </div>
            {!collapsed.briefing && briefMeta ? (
              <span className="shrink-0 font-mono text-[10px] font-bold text-[var(--text-secondary)]" suppressHydrationWarning>
                {briefMeta.sourcesCount} sources
              </span>
            ) : null}
            {collapsed.briefing ? <ChevronDown className="h-3 w-3 text-[var(--text-muted)]" /> : <ChevronUp className="h-3 w-3 text-[var(--text-muted)]" />}
          </button>
          {!collapsed.briefing ? (
            showStateSignalsInsteadOfBriefing ? (
              <div className="px-3 pb-3">
                <div className="mt-2 overflow-x-auto">
                  <div className="inline-flex min-w-full gap-1 rounded-xl border border-[color:var(--border)] bg-[var(--surface-2)] p-1">
                    <button
                      type="button"
                      onClick={() => onChangeGlobalStateFilter?.("ALL")}
                      className={[
                        "shrink-0 rounded-lg px-2.5 py-1 font-mono text-[10px] font-bold tracking-wide transition-colors",
                        effectiveState === "ALL"
                          ? "bg-[var(--surface-1)] text-[#16a34a] shadow-sm"
                          : "text-[var(--text-muted)] hover:bg-[var(--surface-3)] hover:text-[var(--text-secondary)]",
                      ].join(" ")}
                    >
                      ALL
                    </button>
                    {liveStates.map((state) => {
                      const meta = STATE_META[state];
                      const isActive = effectiveState === state;
                      return (
                        <button
                          key={state}
                          type="button"
                          onClick={() => onChangeGlobalStateFilter?.(state)}
                          className={[
                            "shrink-0 rounded-lg px-2.5 py-1 font-mono text-[10px] font-bold tracking-wide transition-colors",
                            isActive
                              ? "bg-[var(--surface-1)] text-[#16a34a] shadow-sm"
                              : "text-[var(--text-muted)] hover:bg-[var(--surface-3)] hover:text-[var(--text-secondary)]",
                          ].join(" ")}
                        >
                          {meta?.abbr || state}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-2 grid gap-2">
                  {stateSignals.map((s: any) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onSelectSignal?.(s)}
                      className="w-full rounded-lg border border-[color:var(--border)] bg-[var(--surface-1)] px-2.5 py-2 text-left hover:bg-[var(--surface-2)]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[9px] font-bold text-[var(--text-muted)]">
                          {(s.state || "INDIA").toUpperCase()} · SEV-{s.severity || 1}
                        </span>
                        <span className="font-mono text-[9px] text-[var(--text-muted)]">{s.verified ? "VERIFIED" : "UNVERIFIED"}</span>
                      </div>
                      <div className="mt-1 text-[11px] font-semibold leading-snug text-[var(--text-primary)] line-clamp-2">{s.title}</div>
                      {s.body ? (
                        <div className="mt-0.5 text-[10px] leading-snug text-[var(--text-secondary)] line-clamp-2">{s.body}</div>
                      ) : null}
                    </button>
                  ))}
                  {stateSignals.length === 0 ? (
                    <div className="p-3 text-center font-mono text-[10px] text-[var(--text-muted)]">
                      No signals for this scope yet.
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