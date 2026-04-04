"use client";

import { Database, Wifi, MapPin, Users, Crosshair, Signal, WifiOff } from "lucide-react";
import { useLiveData } from "@/lib/context/LiveDataContext";

export default function BottomBar() {
  const { constituencies, signals, candidates, isConnected } = useLiveData();

  return (
    <footer className="fixed bottom-0 left-0 right-0 z-50 flex h-7 items-center justify-between border-t border-[#e4e4e7] bg-[#ffffff] px-3 font-mono text-[10px] select-none">
      {/* Left: System Status */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1">
          {isConnected ? (
            <>
              <Wifi className="h-3 w-3 text-[#16a34a]" />
              <span className="text-[#16a34a]">SUPABASE CONNECTED</span>
            </>
          ) : (
            <>
              <WifiOff className="h-3 w-3 text-[#ea580c]" />
              <span className="text-[#ea580c]">OFFLINE / MOCK DATA</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Database className="h-3 w-3 text-[#71717a]" />
          <span className="text-[#71717a]">{isConnected ? "REALTIME" : "LOCAL CACHE"}</span>
        </div>
      </div>

      {/* Center: Counts */}
      <div className="flex items-center gap-5">
        <div className="flex items-center gap-1">
          <Signal className="h-3 w-3 text-[#ea580c]" />
          <span className="text-[#52525b]">
            SIGNALS: <span className="text-[#ea580c]">{signals.length}</span>
          </span>
        </div>
        <div className="flex items-center gap-1">
          <MapPin className="h-3 w-3 text-[#0284c7]" />
          <span className="text-[#52525b]">
            CONSTITUENCIES:{" "}
            <span className="text-[#0284c7]">{constituencies.length}</span>
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Users className="h-3 w-3 text-[#16a34a]" />
          <span className="text-[#52525b]">
            CANDIDATES:{" "}
            <span className="text-[#16a34a]">{candidates.length}</span>
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Crosshair className="h-3 w-3 text-[#71717a]" />
          <span className="text-[#52525b]">
            STATES: <span className="text-[#27272a]">{new Set(constituencies.map((c: any) => c.state)).size}</span>
          </span>
        </div>
      </div>

      {/* Right: Attribution */}
      <div className="flex items-center gap-2 text-[#71717a]">
        <span>SRC: ECI / ADR / MyNeta</span>
        <span className="text-[#e4e4e7]">|</span>
        <span>v0.1.0-alpha</span>
      </div>
    </footer>
  );
}
