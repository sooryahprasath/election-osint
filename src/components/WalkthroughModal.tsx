"use client";

import { useEffect, useMemo, useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

const KEY = "osint_walkthrough_seen_v1";

export default function WalkthroughModal() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    try {
      const seen = window.localStorage.getItem(KEY);
      if (!seen) setOpen(true);
    } catch {
      // ignore
    }
  }, []);

  const steps = useMemo(
    () => [
      { title: "AI Briefing", body: "Your 7-point summary. Use it as a starting map of what changed." },
      { title: "Center modes", body: "Switch between Signals, Videos, Map, and Live (when enabled)." },
      { title: "Map actions", body: "Reset view, jump to Intel, and change marker layers." },
      { title: "Intel pane", body: "Search seats or candidates; tap a result to drill into the constituency." },
    ],
    []
  );

  const close = () => {
    setOpen(false);
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      // ignore
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-end md:items-center justify-center bg-black/40 p-2" role="dialog" aria-modal="true">
      <div className="w-full max-w-[560px] overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[var(--surface-1)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[color:var(--border)] px-4 py-3">
          <div className="min-w-0">
            <div className="font-mono text-[11px] font-bold tracking-wider text-[#16a34a]">WELCOME</div>
            <div className="text-[13px] font-semibold text-[var(--text-primary)]">Guided walkthrough</div>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-md border border-[color:var(--border)] bg-[var(--surface-1)] px-2 py-1 font-mono text-[10px] font-bold text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
            aria-label="Close walkthrough"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4">
          <div className="rounded-xl border border-[color:var(--border)] bg-[var(--surface-2)] px-3 py-3">
            <div className="font-mono text-[9px] text-[var(--text-muted)] tracking-wider">
              STEP {step + 1} / {steps.length}
            </div>
            <div className="mt-1 text-[14px] font-semibold text-[var(--text-primary)]">{steps[step]?.title}</div>
            <div className="mt-1 text-[12px] leading-relaxed text-[var(--text-secondary)]">{steps[step]?.body}</div>
            <div className="mt-2 text-[11px] text-[var(--text-muted)]">
              Tip: keep this open and try the UI in the background — use Next/Back.
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--border)] bg-[var(--surface-1)] px-2.5 py-2 font-mono text-[10px] font-bold text-[var(--text-secondary)] hover:bg-[var(--surface-2)] disabled:opacity-40"
              disabled={step === 0}
            >
              <ChevronLeft className="h-4 w-4" /> BACK
            </button>
            {step < steps.length - 1 ? (
              <button
                type="button"
                onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#16a34a] px-3 py-2 font-mono text-[10px] font-bold text-white hover:bg-[#16a34a]/90"
              >
                NEXT <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={close}
                className="rounded-md bg-[#16a34a] px-3 py-2 font-mono text-[10px] font-bold text-white hover:bg-[#16a34a]/90"
              >
                FINISH
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
