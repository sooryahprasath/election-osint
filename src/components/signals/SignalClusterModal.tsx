"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X, MapPin, AlertTriangle } from "lucide-react";
import { relativeTime, severityLabel } from "@/lib/utils/formatting";

export default function SignalClusterModal({
  signals,
  onClose,
  onPick,
}: {
  signals: any[];
  onClose: () => void;
  onPick: (s: any) => void;
}) {
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "auto";
    };
  }, []);

  const sorted = [...signals].sort((a, b) => {
    const ds = (b.severity || 1) - (a.severity || 1);
    if (ds !== 0) return ds;
    return (Date.parse(b.created_at || "") || 0) - (Date.parse(a.created_at || "") || 0);
  });

  return createPortal(
    <div
      className="fixed inset-0 z-[9998] flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[min(70vh,520px)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-[color:var(--border)] bg-[var(--surface-1)] shadow-2xl sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[color:var(--border)] bg-[var(--surface-2)] px-4 py-3">
          <div className="flex items-center gap-2 font-mono text-xs font-bold text-[var(--text-secondary)]">
            <AlertTriangle className="h-4 w-4 text-[#ea580c]" />
            MAP CLUSTER · {signals.length} SIGNALS
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-3)]" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="border-b border-[color:var(--border)] px-4 py-2 font-mono text-[8px] leading-snug text-[var(--text-muted)]">
          Same map pin groups nearby items. Open one to read the full dossier.
        </p>
        <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {sorted.map((s) => (
            <li key={s.id} className="border-b border-[color:var(--border)] last:border-0">
              <button
                type="button"
                onClick={() => onPick(s)}
                className="flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-2)]"
              >
                <span className="font-mono text-[11px] font-semibold leading-snug text-[var(--text-primary)]">{s.title}</span>
                <span className="flex flex-wrap items-center gap-2 font-mono text-[9px] text-[var(--text-muted)]">
                  <span className="rounded bg-[var(--surface-3)] px-1.5 py-0.5 font-bold text-[var(--text-secondary)]">
                    SEV-{s.severity || 1} {severityLabel(s.severity)}
                  </span>
                  {s.state && (
                    <span className="flex items-center gap-0.5 text-[#0284c7]">
                      <MapPin className="h-2.5 w-2.5" /> {String(s.state).toUpperCase()}
                    </span>
                  )}
                  <span>{relativeTime(new Date(s.created_at || ""))}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body
  );
}
