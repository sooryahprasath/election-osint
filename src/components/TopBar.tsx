"use client";

import { useEffect, useState, useRef } from "react";
import { Radio, Shield, Activity, Clock, AlertTriangle, CheckCircle, Sun, Moon } from "lucide-react";
import { getNextElectionEvent, formatCountdown, formatTime } from "@/lib/utils/countdown";
import { useLiveData } from "@/lib/context/LiveDataContext";
import { excludeFromIntelligenceFeed } from "@/lib/utils/signalClassifier";

/** Tiranga — compact for header (matches prior GitHub icon footprint). */
const IndiaFlagIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 6" className={className} aria-hidden="true">
    <rect width="9" height="2" fill="#FF9933" />
    <rect y="2" width="9" height="2" fill="#FFFFFF" />
    <rect y="4" width="9" height="2" fill="#138808" />
    <circle cx="4.5" cy="3" r="0.55" fill="none" stroke="#000080" strokeWidth="0.12" />
  </svg>
);

type TopBarProps = {
  /** Opens the signal detail modal when user taps a ticker headline (desktop + mobile). */
  onSelectTickerSignal?: (signal: any) => void;
};

export default function TopBar({ onSelectTickerSignal }: TopBarProps) {
  const [mounted, setMounted] = useState(false);
  const [countdown, setCountdown] = useState(getNextElectionEvent());
  const [currentTime, setCurrentTime] = useState(new Date());
  const { signals } = useLiveData();
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem("theme") : null;
    const prefersDark =
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
        : false;
    const nextDark = stored ? stored === "dark" : prefersDark;
    setIsDark(nextDark);
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("dark", nextDark);
    }
  }, []);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    if (typeof document !== "undefined") {
      // Smooth theme swap without “cascading” flashes.
      document.documentElement.classList.add("theme-transition");
      document.documentElement.classList.toggle("dark", next);
      window.setTimeout(() => {
        document.documentElement.classList.remove("theme-transition");
      }, 220);
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem("theme", next ? "dark" : "light");
    }
  };

  // ==========================================
  // ⚙️ Ticker State & Logic (Pause-and-Restart)
  // ==========================================
  const [isScrolling, setIsScrolling] = useState(true);
  const [displayedSignals, setDisplayedSignals] = useState<any[]>([]);
  const latestSignalsRef = useRef<any[]>([]);

  // 1. Filter the live data for SEV-4+ OR Official
  const intelSignals = signals.filter((s: any) => !excludeFromIntelligenceFeed(s));

  const targetNews = intelSignals.filter((s: any) => {
    const isSevere = s.severity >= 4;
    const isOfficial = s.category?.toLowerCase() === "official";
    return isSevere || isOfficial;
  }).slice(0, 15);

  // Fallback to top 5 general news if there are no severe/official alerts
  const freshSignals = targetNews.length > 0 ? targetNews : intelSignals.slice(0, 5);

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

      <header className="fixed top-0 left-0 right-0 z-50 flex h-9 items-center justify-between border-b border-[color:var(--border)] bg-[var(--surface-1)] px-2 md:px-3 font-mono text-[10px] md:text-xs select-none">
        <div className="flex min-w-0 items-center gap-2 shrink-0">
          <Shield className="h-3.5 w-3.5 text-[#16a34a]" />
          <span className="font-bold text-[#16a34a] tracking-widest hidden md:inline">DHARMA-OSINT</span>
          <span className="font-bold text-[#16a34a] tracking-widest md:hidden">D-OSINT</span>
        </div>

        <div className="hidden md:block h-4 w-px bg-[color:var(--border)] mx-2 shrink-0" />

        <div className="hidden md:flex items-center gap-1.5 shrink-0">
          <div className="h-1.5 w-1.5 rounded-full bg-[#dc2626] animate-pulse shrink-0" />
          <span className="text-[#dc2626] font-semibold">LIVE</span>
        </div>

        <div className="hidden md:flex items-center gap-1.5 shrink-0 ml-3">
          <Radio className="h-3 w-3 text-[#16a34a] animate-pulse" />
          <span className="text-[var(--text-secondary)]">{countdown.label}:</span>
          <span className="text-[#16a34a] font-bold tabular-nums min-w-[120px]">
            {mounted ? `T-${formatCountdown(countdown)}` : "T-00d 00h 00m 00s"}
          </span>
        </div>

        {/* Desktop ticker only (mobile stays calm) */}
        <div className="hidden md:flex flex-1 min-w-0 overflow-hidden relative mx-3 h-full items-center">
          {isScrolling && displayedSignals.length > 0 && (
            <div
              className="flex whitespace-nowrap absolute animate-sweep"
              style={{ animationDuration: `${scrollDuration}s` }}
              onAnimationEnd={handleScrollComplete}
            >
              <div className="flex shrink-0 pr-8">
                {displayedSignals.map((h: any, i: number) => (
                  <button
                    key={`news-${h.id || i}`}
                    type="button"
                    className="inline-flex items-center mr-8 cursor-pointer rounded-sm border-0 bg-transparent p-0 text-left font-mono hover:bg-[var(--surface-2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0284c7] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--surface-1)]"
                    onClick={() => onSelectTickerSignal?.(h)}
                  >
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
                    <span className="text-[var(--text-primary)]">{h.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="flex items-center gap-1.5 shrink-0">
            <Clock className="h-3 w-3 text-[var(--text-muted)]" />
            <span className="text-[var(--text-secondary)] tabular-nums" suppressHydrationWarning>
              {formatTime(currentTime)} IST
            </span>
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-[color:var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            title={isDark ? "Light mode" : "Dark mode"}
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          <IndiaFlagIcon className="h-3.5 w-[21px]" />
        </div>
 
      </header>
    </>
  );
}