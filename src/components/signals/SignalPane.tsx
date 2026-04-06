"use client";

import { useMemo, useState, useEffect } from "react";
import { Radio, ChevronDown, ChevronUp, Video } from "lucide-react";
import SignalCard from "./SignalCard";
import MorningBriefing from "./MorningBriefing";
import { useLiveData } from "@/lib/context/LiveDataContext";
import { STATE_META } from "@/lib/utils/states";

export default function SignalPane({ globalStateFilter, setGlobalStateFilter, globalConstituencyId, onSelectSignal }: any) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ videos: false, briefing: false, signals: false });
  // 🔥 FIX: The 'Tick' state forces the UI to re-render every minute so '7m ago' becomes '8m ago'
  const [tick, setTick] = useState(0);
  const { signals, constituencies } = useLiveData();

  // 🔥 FIX: The Timer
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((t) => t + 1);
    }, 60000); // Ticks every 60 seconds
    return () => clearInterval(timer);
  }, []);

  const liveStates = Array.from(new Set(constituencies.map((c: any) => c.state))).filter(Boolean) as string[];

  const activeConst = constituencies.find((c: any) => c.id === globalConstituencyId);
  const effectiveState = activeConst ? activeConst.state : globalStateFilter;

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

  const filteredSignals = useMemo(() => {
    const filtered = signals.filter((s: any) => {
      if (effectiveState !== "ALL") return s.state === effectiveState;
      return true;
    });
    filtered.sort((a: any, b: any) => {
      const at = Date.parse(a.created_at || "") || 0;
      const bt = Date.parse(b.created_at || "") || 0;
      return bt - at;
    });
    return filtered;
  }, [signals, effectiveState]);

  return (
    <aside className="flex flex-col h-full w-full overflow-hidden bg-[#ffffff] border-r border-[#e4e4e7]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#e4e4e7] shrink-0">
        <div className="flex items-center gap-2">
          <Radio className="h-3.5 w-3.5 text-[#16a34a] animate-pulse" />
          <span className="font-mono text-xs font-bold text-[#16a34a] tracking-wider">
            {globalConstituencyId ? "LOCAL INTEL" : "SIGNAL FEED"}
          </span>
        </div>
        <span className="font-mono text-[10px] text-[#71717a]">{filteredSignals.length} ITEMS</span>
      </div>

      <div className="flex gap-1 px-2 py-1.5 border-b border-[#e4e4e7] overflow-x-auto shrink-0">
        <button
          onClick={() => setGlobalStateFilter("ALL")}
          className={`px-2 py-0.5 font-mono text-[10px] rounded transition-colors shrink-0 ${effectiveState === "ALL" ? "bg-[#16a34a]/10 text-[#16a34a] border border-[#16a34a]/30" : "text-[#71717a] hover:text-[#52525b] border border-transparent"
            }`}
        >
          ALL
        </button>
        {liveStates.map((state) => {
          const meta = STATE_META[state];
          const isActive = effectiveState === state;
          return (
            <button
              key={state}
              onClick={() => setGlobalStateFilter(state)}
              style={{ backgroundColor: isActive ? `${meta?.color}20` : 'transparent', color: isActive ? meta?.color : '#71717a' }}
              className="px-2 py-0.5 font-mono text-[10px] font-bold rounded transition-colors shrink-0"
            >
              {meta?.abbr || state}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Video Intel Strip */}
        <div className="border-b border-[#e4e4e7]">
          <button
            onClick={() => setCollapsed({ ...collapsed, videos: !collapsed.videos })}
            className="flex items-center justify-between w-full px-3 py-1.5 hover:bg-[#f4f4f5]"
          >
            <span className="font-mono text-[10px] text-[#52525b] tracking-wider flex items-center gap-1.5">
              <Video className="h-3 w-3" /> ◆ VIDEO INTEL
            </span>
            {collapsed.videos ? <ChevronDown className="h-3 w-3 text-[#71717a]" /> : <ChevronUp className="h-3 w-3 text-[#71717a]" />}
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
                        className="shrink-0 w-[148px] rounded border border-[#e4e4e7] bg-white hover:bg-[#f4f4f5] transition-colors overflow-hidden text-left"
                        title={s.title}
                      >
                        <div className="w-full aspect-video bg-[#0f172a] relative">
                          {thumb ? (
                            <img src={thumb} alt="" className="w-full h-full object-cover opacity-90" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[#a1a1aa] font-mono text-[9px]">
                              NO THUMB
                            </div>
                          )}
                          <div className="absolute bottom-1 left-1 font-mono text-[8px] font-bold bg-black/60 text-white px-1.5 py-0.5 rounded">
                            SEV-{s.severity || 1}
                          </div>
                        </div>
                        <div className="p-2">
                          <div className="font-mono text-[9px] font-bold text-[#52525b] truncate">
                            {(s.state || "INDIA").toUpperCase()}
                          </div>
                          <div className="text-[10px] text-[#18181b] leading-tight line-clamp-2">
                            {s.title}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="p-3 text-center font-mono text-[10px] text-[#a1a1aa]">
                  No video intel available for this sector yet.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-b border-[#e4e4e7]">
          <button onClick={() => setCollapsed({ ...collapsed, briefing: !collapsed.briefing })} className="flex items-center justify-between w-full px-3 py-1.5 hover:bg-[#f4f4f5]">
            <span className="font-mono text-[10px] text-[#52525b] tracking-wider">◆ AI BRIEFING</span>
            {collapsed.briefing ? <ChevronDown className="h-3 w-3 text-[#71717a]" /> : <ChevronUp className="h-3 w-3 text-[#71717a]" />}
          </button>
          {!collapsed.briefing && <MorningBriefing />}
        </div>

        <div>
          <button onClick={() => setCollapsed({ ...collapsed, signals: !collapsed.signals })} className="flex items-center justify-between w-full px-3 py-1.5 hover:bg-[#f4f4f5] border-b border-[#e4e4e7]">
            <span className="font-mono text-[10px] text-[#52525b] tracking-wider">◆ INTELLIGENCE FEED</span>
            {collapsed.signals ? <ChevronDown className="h-3 w-3 text-[#71717a]" /> : <ChevronUp className="h-3 w-3 text-[#71717a]" />}
          </button>
          {!collapsed.signals && (
            <div className="flex flex-col">
              {filteredSignals.length > 0 ? filteredSignals.map((signal: any) => (
                // 🔥 FIX: Passing 'tick' as a prop forces the SignalCard to re-render the time strings
                <SignalCard key={signal.id} signal={signal} tick={tick} onClick={() => onSelectSignal(signal)} />
              )) : (
                <div className="p-6 text-center font-mono text-[10px] text-[#a1a1aa]">No intelligence reports filed for this sector.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}