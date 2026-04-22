"use client";

import { useEffect, useState, useRef } from "react";
import { Activity, AlertTriangle, CheckCircle, Sun, Moon } from "lucide-react";
import { getNextElectionEvent, formatCountdown, formatTime } from "@/lib/utils/countdown";
import { useLiveData } from "@/lib/context/LiveDataContext";
import { excludeFromIntelligenceFeed } from "@/lib/utils/signalClassifier";

/** Tiranga — mobile + desktop top-right. */
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
  onSelectTickerSignal?: (signal: unknown) => void;
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
    queueMicrotask(() => setIsDark(nextDark));
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("dark", nextDark);
    }
  }, []);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    if (typeof document !== "undefined") {
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

  // Ticker
  const [isScrolling, setIsScrolling] = useState(true);
  const [displayedSignals, setDisplayedSignals] = useState<unknown[]>([]);
  const latestSignalsRef = useRef<unknown[]>([]);

  const intelSignals = signals.filter((s: unknown) => !excludeFromIntelligenceFeed(s));
  const targetNews = intelSignals.filter((s: unknown) => {
    const ss = s as Record<string, unknown>;
    const isSevere = Number(ss.severity || 0) >= 4;
    const isOfficial = String(ss.category || "").toLowerCase() === "official";
    return isSevere || isOfficial;
  }).slice(0, 15);
  const freshSignals = targetNews.length > 0 ? targetNews : intelSignals.slice(0, 5);

  useEffect(() => {
    latestSignalsRef.current = freshSignals;
    if (displayedSignals.length === 0 && freshSignals.length > 0) {
      queueMicrotask(() => setDisplayedSignals(freshSignals));
    }
  }, [freshSignals, displayedSignals.length]);

  const handleScrollComplete = () => {
    setIsScrolling(false);
    setDisplayedSignals(latestSignalsRef.current);
    setTimeout(() => { setIsScrolling(true); }, 1800);
  };

  const scrollDuration = Math.max(displayedSignals.length * 10, 12);

  useEffect(() => {
    queueMicrotask(() => setMounted(true));
    const interval = setInterval(() => {
      setCountdown(getNextElectionEvent());
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <style>{`
        @keyframes sweep-left {
          0%   { left: 100%; transform: translateX(0); }
          100% { left: 0%;   transform: translateX(-100%); }
        }
        .animate-sweep { animation: sweep-left linear forwards; }
      `}</style>

      <header
        className="fixed top-0 left-0 right-0 z-50 flex h-10 items-center gap-3 border-b border-[color:var(--border)] bg-[var(--surface-1)] px-3 md:px-4 text-[13px] select-none"
      >
        {/* Brand */}
        <div className="flex min-w-0 items-center gap-2 shrink-0">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--brand)] text-white">
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              {/* ballot box */}
              <path d="M5 10h14" />
              <path d="M7 10V7a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v3" />
              <path d="M6 10v9a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-9" />
              {/* ballot */}
              <path d="M10 3h4" />
              <path d="M10 3v4h4V3" />
            </svg>
          </div>
          <span className="font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
            Election Watch
          </span>
        </div>

        {/* Countdown (desktop) */}
        <div className="hidden md:flex items-center gap-2 shrink-0 pl-3 border-l border-[color:var(--border)]">
          <span className="text-[var(--text-muted)]">{countdown.label}</span>
          <span className="num font-mono tabular-nums text-[var(--text-primary)] min-w-[120px]">
            {mounted ? formatCountdown(countdown) : "00d 00h 00m 00s"}
          </span>
        </div>

        {/* Ticker (desktop) */}
        <div className="hidden md:flex flex-1 min-w-0 relative h-full items-center overflow-hidden">
          {isScrolling && displayedSignals.length > 0 && (
            <div
              className="flex whitespace-nowrap absolute animate-sweep"
              style={{ animationDuration: `${scrollDuration}s` }}
              onAnimationEnd={handleScrollComplete}
            >
              <div className="flex shrink-0 pr-8">
                {displayedSignals.map((h: unknown, i: number) => {
                  const hh = h as Record<string, unknown>;
                  const isSevere = Number(hh.severity || 0) >= 4;
                  const isOfficial = String(hh.category || "").toLowerCase() === "official";
                  return (
                    <button
                      key={`news-${String(hh.id || i)}`}
                      type="button"
                      className="inline-flex items-center mr-8 cursor-pointer rounded-sm border-0 bg-transparent p-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                      onClick={() => onSelectTickerSignal?.(h)}
                    >
                      {isSevere ? (
                        <AlertTriangle className="h-3.5 w-3.5 text-[var(--danger)] mr-1.5 shrink-0" />
                      ) : isOfficial ? (
                        <CheckCircle className="h-3.5 w-3.5 text-[var(--brand)] mr-1.5 shrink-0" />
                      ) : (
                        <Activity className="h-3.5 w-3.5 text-[var(--text-muted)] mr-1.5 shrink-0" />
                      )}
                      <span className="mr-2 font-medium text-[var(--text-muted)]">
                        {hh.state ? String(hh.state) : "India"}
                      </span>
                      <span className="text-[var(--text-primary)]">{String(hh.title || "")}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right cluster */}
        <div className="flex shrink-0 items-center gap-2 ml-auto">
          <span className="hidden lg:inline text-[var(--text-muted)] num font-mono tabular-nums" suppressHydrationWarning>
            {formatTime(currentTime)} IST
          </span>

          <button
            type="button"
            onClick={toggleTheme}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] hover:border-[color:var(--border)] transition-colors"
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            title={isDark ? "Light mode" : "Dark mode"}
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          <IndiaFlagIcon className="h-4 w-[24px] rounded-[2px] ring-1 ring-[color:var(--border)]" />
        </div>
      </header>
    </>
  );
}
