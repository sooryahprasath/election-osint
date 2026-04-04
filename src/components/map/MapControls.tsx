"use client";

import { Eye, EyeOff, Crosshair, MapPin, Terminal } from "lucide-react";
import { useLiveData } from "@/lib/context/LiveDataContext";

interface MapControlsProps {
  nightVisionEnabled: boolean;
  onToggleNightVision: () => void;
  debugModeEnabled: boolean;
  onToggleDebugMode: () => void;
  onFlyToState: (state: string) => void;
}

export default function MapControls({
  nightVisionEnabled,
  onToggleNightVision,
  debugModeEnabled,
  onToggleDebugMode,
  onFlyToState,
}: MapControlsProps) {
  const { constituencies } = useLiveData();
  const STATES = Array.from(new Set(constituencies.map((c: any) => c.state))).filter(Boolean) as string[];

  const btn = (active: boolean, label: string, icon: React.ReactNode, onClick: () => void) => (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded font-mono text-[10px] transition-all select-none ${
        active
          ? "bg-[#16a34a]/15 text-[#16a34a] border border-[#16a34a]/30"
          : "bg-[#ffffff]/90 text-[#52525b] border border-[#e4e4e7] hover:border-[#333] hover:text-[#16a34a]"
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div
      style={{ position: "fixed", top: 48, right: 8, zIndex: 30 }}
      className="flex flex-col gap-2 pointer-events-auto select-none"
    >
      {/* Toggle buttons */}
      {btn(nightVisionEnabled, `NV-${nightVisionEnabled ? "ON" : "OFF"}`,
        nightVisionEnabled ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />,
        onToggleNightVision
      )}
      {btn(debugModeEnabled, `DBG-${debugModeEnabled ? "ON" : "OFF"}`,
        <Terminal className="h-3 w-3" />,
        onToggleDebugMode
      )}

      {/* Fly-to panel */}
      <div className="bg-[#ffffff]/90 border border-[#e4e4e7] rounded overflow-hidden backdrop-blur-sm">
        <div className="px-2 py-1 border-b border-[#e4e4e7] flex items-center gap-1">
          <Crosshair className="h-2.5 w-2.5 text-[#71717a]" />
          <span className="font-mono text-[8px] text-[#71717a] tracking-wider">FLY TO</span>
        </div>
        <button
          onClick={() => onFlyToState("India")}
          className="flex items-center gap-1.5 w-full px-2 py-1 font-mono text-[9px] text-[#52525b] hover:bg-[#f4f4f5] hover:text-[#16a34a] transition-colors border-b border-[#e4e4e7]"
        >
          <MapPin className="h-2.5 w-2.5" /> OVERVIEW
        </button>
        {STATES.map(state => (
          <button
            key={state}
            onClick={() => onFlyToState(state)}
            className="flex items-center gap-1.5 w-full px-2 py-1 font-mono text-[9px] text-[#71717a] hover:bg-[#f4f4f5] hover:text-[#16a34a] transition-colors border-b border-[#e4e4e7] last:border-b-0"
          >
            <MapPin className="h-2.5 w-2.5" /> {state.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}
