"use client";

import { Map as MapIcon, Video, Radar, Radio, BarChart3, Sparkles } from "lucide-react";

export type CenterMode = "signals" | "videos" | "map" | "live" | "polls" | "insights";

const MODE_META: Record<CenterMode, { label: string; Icon: React.ComponentType<{ className?: string }> }> = {
  signals:  { label: "News",     Icon: Radio },
  videos:   { label: "Videos",   Icon: Video },
  map:      { label: "Map",      Icon: MapIcon },
  live:     { label: "Live",     Icon: Radar },
  polls:    { label: "Polls",    Icon: BarChart3 },
  insights: { label: "Insights", Icon: Sparkles },
};

export function CenterModeSwitcher({
  value,
  onChange,
  showLive,
  liveLabel,
}: {
  value: CenterMode;
  onChange: (mode: CenterMode) => void;
  showLive?: boolean;
  liveLabel?: string;
}) {
  const modes: CenterMode[] = showLive
    ? ["insights", "signals", "videos", "map", "polls", "live"]
    : ["insights", "signals", "videos", "map", "polls"];

  return (
    <div className="flex w-full min-w-0 justify-center overflow-x-auto no-scrollbar py-0.5">
      <div
        className="eb-pills mx-auto w-max max-w-full snap-x snap-mandatory"
        role="tablist"
        aria-label="Views"
      >
        {modes.map((mode) => {
          const meta = MODE_META[mode];
          const active = value === mode;
          const Icon = meta.Icon;
          const label = mode === "live" && liveLabel ? liveLabel : meta.label;
          return (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={active}
              data-active={active}
              onClick={() => onChange(mode)}
              className="eb-pill snap-start shrink-0"
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
