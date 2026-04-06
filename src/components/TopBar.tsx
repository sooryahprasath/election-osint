"use client";

import { useEffect, useState, useRef } from "react";
import { Radio, Shield, Activity, Clock, AlertTriangle, CheckCircle } from "lucide-react";
import { getNextElectionEvent, formatCountdown, formatTime } from "@/lib/utils/countdown";
import { useLiveData } from "@/lib/context/LiveDataContext";

// --- Inline SVG for GitHub ---
const GithubIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.24c3-.34 6-1.5 6-6.6a5.5 5.5 0 0 0-1.5-3.8 5.4 5.4 0 0 0-.15-3.8s-1.18-.38-3.9 1.4a13.4 13.4 0 0 0-7 0c-2.72-1.78-3.9-1.4-3.9-1.4a5.4 5.4 0 0 0-.15 3.8 5.5 5.5 0 0 0-1.5 3.8c0 5.1 3 6.26 6 6.6a4.8 4.8 0 0 0-1 3.24v4" />
    <path d="M9 18c-4.51 2-5-2-7-2" />
  </svg>
);

export default function TopBar() {
  const [mounted, setMounted] = useState(false);
  const [countdown, setCountdown] = useState(getNextElectionEvent());
  const [currentTime, setCurrentTime] = useState(new Date());
  const { signals } = useLiveData();

  // ==========================================
  // ⚙️ Ticker State & Logic (Pause-and-Restart)
  // ==========================================
  const [isScrolling, setIsScrolling] = useState(true);
  const [displayedSignals, setDisplayedSignals] = useState<any[]>([]);
  const latestSignalsRef = useRef<any[]>([]);

  // 1. Filter the live data for SEV-4+ OR Official
  const targetNews = signals.filter((s: any) => {
    const isSevere = s.severity >= 4;
    const isOfficial = s.category?.toLowerCase() === "official";
    return isSevere || isOfficial;
  }).slice(0, 15);

  // Fallback to top 5 general news if there are no severe/official alerts
  const freshSignals = targetNews.length > 0 ? targetNews : signals.slice(0, 5);

  useEffect(() => {
    latestSignalsRef.current = freshSignals;
    // Auto-start the very first load
    if (displayedSignals.length === 0 && freshSignals.length > 0) {
      setDisplayedSignals(freshSignals);
    }
  }, [freshSignals, displayedSignals.length]);

  const handleScrollComplete = () => {
    setIsScrolling(false); // Hide and pause
    setDisplayedSignals(latestSignalsRef.current); // Swap data silently

    setTimeout(() => {
      setIsScrolling(true); // Restart from right edge after 2 seconds
    }, 2000);
  };

  // Because there's no invisible dead space anymore, we lower the duration multiplier to keep it brisk
  const scrollDuration = Math.max(displayedSignals.length * 10, 12);

  // ==========================================

  useEffect(() => {
    setMounted(true);
    const interval = setInterval(() => {
      setCountdown(getNextElectionEvent());
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      {/* 🔥 FIX: Perfect bounds. Starts exactly at right edge, ends exactly at left edge. Zero delay. */}
      <style>{`
        @keyframes sweep-left {
          0% { 
            left: 100%; 
            transform: translateX(0); 
          }
          100% { 
            left: 0%; 
            transform: translateX(-100%); 
          }
        }
        .animate-sweep {
          animation: sweep-left linear forwards;
        }
      `}</style>

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

        {/* The Scrolling Container */}
        <div className="flex-1 overflow-hidden relative mx-2 h-full flex items-center">
          {isScrolling && displayedSignals.length > 0 && (
            <div
              className="flex whitespace-nowrap absolute animate-sweep"
              style={{ animationDuration: `${scrollDuration}s` }}
              onAnimationEnd={handleScrollComplete}
            >
              <div className="flex shrink-0 pr-8">
                {displayedSignals.map((h: any, i: number) => (
                  <span key={`news-${h.id || i}`} className="inline-flex items-center mr-8">
                    {h.severity >= 4 ? (
                      <AlertTriangle className="h-3 w-3 text-[#dc2626] mr-1 shrink-0" />
                    ) : h.category?.toLowerCase() === 'official' ? (
                      <CheckCircle className="h-3 w-3 text-[#16a34a] mr-1 shrink-0" />
                    ) : (
                      <Activity className="h-3 w-3 text-[#52525b] mr-1 shrink-0" />
                    )}

                    <span className={`mr-2 font-semibold ${h.severity >= 4 ? "text-[#dc2626]" : h.category?.toLowerCase() === 'official' ? "text-[#16a34a]" : "text-[#52525b]"}`}>
                      [{h.state ? h.state.toUpperCase() : "INDIA"}]
                    </span>
                    <span className="text-[#27272a]">{h.title}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="h-4 w-px bg-[#e4e4e7] ml-2 md:ml-3 mr-2 md:mr-3 shrink-0" />

        <div className="flex items-center gap-1.5 shrink-0">
          <Clock className="h-3 w-3 text-[#71717a]" />
          <span className="text-[#52525b] tabular-nums" suppressHydrationWarning>
            {formatTime(currentTime)} IST
          </span>
        </div>

        <div className="h-4 w-px bg-[#e4e4e7] ml-2 md:ml-3 mr-2 md:mr-3 shrink-0" />

        <a
          href="https://github.com/sooryahprasath/election-osint"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center shrink-0 text-[#71717a] hover:text-[#18181b] transition-colors"
          title="View source on GitHub"
        >
          <GithubIcon className="h-3.5 w-3.5" />
        </a>
      </header>
    </>
  );
}