"use client";

import { useEffect, useState } from "react";
import { Radio, Shield, Activity, Clock, AlertTriangle } from "lucide-react";
import { getNextElectionEvent, formatCountdown, formatTime } from "@/lib/utils/countdown";
import { useLiveData } from "@/lib/context/LiveDataContext";

export default function TopBar() {
  const [mounted, setMounted] = useState(false);
  const [countdown, setCountdown] = useState(getNextElectionEvent());
  const [currentTime, setCurrentTime] = useState(new Date());
  const { signals } = useLiveData();

  const recentSignals = signals.slice(0, 5);

  useEffect(() => {
    setMounted(true);
    const interval = setInterval(() => {
      setCountdown(getNextElectionEvent());
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 flex h-9 items-center border-b border-[#e4e4e7] bg-[#ffffff] px-2 md:px-3 font-mono text-[10px] md:text-xs select-none">
      <div className="flex items-center gap-2 mr-2 md:mr-4 shrink-0">
        <Shield className="h-3.5 w-3.5 text-[#16a34a]" />
        <span className="font-bold text-[#16a34a] tracking-widest hidden md:inline">DHARMA-OSINT</span>
        <span className="font-bold text-[#16a34a] tracking-widest md:hidden">D-OSINT</span>
      </div>

      <div className="h-4 w-px bg-[#e4e4e7] mr-2 md:mr-3 shrink-0" />

      <div className="flex items-center gap-1.5 mr-2 md:mr-4 shrink-0">
        <div className="h-1.5 w-1.5 rounded-full bg-[#dc2626] animate-pulse shrink-0" />
        <span className="text-[#dc2626] font-semibold">LIVE</span>
      </div>

      <div className="hidden md:flex items-center gap-1.5 mr-4 shrink-0">
        <Radio className="h-3 w-3 text-[#16a34a] animate-pulse" />
        <span className="text-[#52525b]">{countdown.label}:</span>
        <span className="text-[#16a34a] font-bold tabular-nums min-w-[120px]">
          {mounted ? `T-${formatCountdown(countdown)}` : "T-00d 00h 00m 00s"}
        </span>
      </div>

      <div className="hidden md:block h-4 w-px bg-[#e4e4e7] mr-3 shrink-0" />

      <div className="flex-1 overflow-hidden relative mx-2">
        <div className="flex animate-ticker whitespace-nowrap">
          {[...recentSignals, ...recentSignals].map((h: any, i) => (
            <span key={`${h.id}-${i}`} className="inline-flex items-center mr-8">
              {h.severity >= 4 ? <AlertTriangle className="h-3 w-3 text-[#dc2626] mr-1 shrink-0" /> : <Activity className="h-3 w-3 text-[#52525b] mr-1 shrink-0" />}
              <span className={`mr-2 font-semibold ${h.severity >= 4 ? "text-[#dc2626]" : h.severity >= 3 ? "text-[#ea580c]" : "text-[#52525b]"}`}>[{h.state ? h.state.toUpperCase() : "INDIA"}]</span>
              <span className="text-[#27272a]">{h.title}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="h-4 w-px bg-[#e4e4e7] ml-2 md:ml-3 mr-2 md:mr-3 shrink-0" />

      <div className="flex items-center gap-1.5 shrink-0">
        <Clock className="h-3 w-3 text-[#71717a]" />
        <span className="text-[#52525b] tabular-nums" suppressHydrationWarning>
          {formatTime(currentTime)} IST
        </span>
      </div>
    </header>
  );
}