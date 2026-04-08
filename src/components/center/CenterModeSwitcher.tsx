"use client";

import { Map as MapIcon, Video, Radar, Radio } from "lucide-react";

export type CenterMode = "signals" | "videos" | "map" | "live";

const MODE_META: Record<
  CenterMode,
  { label: string; Icon: React.ComponentType<{ className?: string }> ; accent: string; bg: string; border: string }
> = {
  signals: { label: "SIGNALS", Icon: Radio, accent: "#16a34a", bg: "bg-emerald-500/10", border: "border-emerald-500/25" },
  videos: { label: "VIDEOS", Icon: Video, accent: "#0284c7", bg: "bg-sky-500/10", border: "border-sky-500/25" },
  map: { label: "MAP", Icon: MapIcon, accent: "#0284c7", bg: "bg-sky-500/10", border: "border-sky-500/25" },
  live: { label: "LIVE", Icon: Radar, accent: "#dc2626", bg: "bg-red-500/10", border: "border-red-500/25" },
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
  const modes: CenterMode[] = showLive ? ["live", "signals", "videos", "map"] : ["signals", "videos", "map"];
  return (
    <div className="flex items-center gap-1 rounded-lg border border-[color:var(--border)] bg-[var(--surface-1)]/85 p-1 shadow-sm backdrop-blur-sm">
      {modes.map((mode) => {
        const meta = MODE_META[mode];
        const active = value === mode;
        const Icon = meta.Icon;
        const label = mode === "live" && liveLabel ? liveLabel : meta.label;
        return (
          <button
            key={mode}
            type="button"
            onClick={() => onChange(mode)}
            className={[
              "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-mono text-[10px] font-bold tracking-wider transition-colors",
              active
                ? `${meta.bg} ${meta.border} border`
                : "border border-transparent text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text-secondary)]",
            ].join(" ")}
            style={active ? { color: meta.accent } : undefined}
            aria-pressed={active}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

