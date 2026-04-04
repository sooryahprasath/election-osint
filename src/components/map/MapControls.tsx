"use client";

import { Crosshair, MapPin } from "lucide-react";
import { useLiveData } from "@/lib/context/LiveDataContext";

interface MapControlsProps {
  onFlyToState: (state: string) => void;
}

export default function MapControls({ onFlyToState }: MapControlsProps) {
  const { constituencies } = useLiveData();
  const STATES = Array.from(new Set(constituencies.map((c: any) => c.state))).filter(Boolean) as string[];

  return (
    <div className="fixed top-[48px] right-2 md:right-auto md:left-[290px] z-30 pointer-events-auto select-none w-40 md:w-48">
      <div className="bg-[#ffffff]/90 border border-[#e4e4e7] rounded shadow-sm backdrop-blur-sm">
        <div className="px-2 py-1.5 border-b border-[#e4e4e7] flex items-center gap-1.5 bg-[#f4f4f5]">
          <Crosshair className="h-3 w-3 text-[#52525b]" />
          <span className="font-mono text-[9px] font-bold text-[#52525b] tracking-wider">TACTICAL FLY-TO</span>
        </div>
        <button
          onClick={() => onFlyToState("India")}
          className="flex items-center gap-1.5 w-full px-2 py-1.5 font-mono text-[10px] text-[#52525b] hover:bg-[#f4f4f5] transition-colors border-b border-[#e4e4e7]"
        >
          <MapPin className="h-3 w-3" /> NATIONAL OVERVIEW
        </button>
        {STATES.map(state => (
          <button
            key={state}
            onClick={() => onFlyToState(state)}
            className="flex items-center gap-1.5 w-full px-2 py-1.5 font-mono text-[10px] text-[#71717a] hover:bg-[#f4f4f5] transition-colors border-b border-[#e4e4e7] last:border-b-0"
          >
            <MapPin className="h-3 w-3" /> {state.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}