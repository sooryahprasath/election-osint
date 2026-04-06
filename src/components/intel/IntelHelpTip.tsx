"use client";

import { useState, useRef, useLayoutEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HelpCircle } from "lucide-react";

/**
 * Help popover rendered via portal + fixed positioning so it is never clipped
 * by the intel sidebar’s overflow:hidden (unlike absolute children).
 */
export default function IntelHelpTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [box, setBox] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) {
      setBox(null);
      return;
    }
    const r = btnRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(288, vw - 20);
    const left = Math.min(Math.max(10, r.right - width), vw - width - 10);
    const margin = 8;
    const preferredMax = 300;
    const spaceBelow = vh - r.bottom - margin - 8;
    const spaceAbove = r.top - margin - 8;
    const openUp = spaceBelow < 100 && spaceAbove > spaceBelow;
    const maxHeight = Math.min(preferredMax, openUp ? spaceAbove : spaceBelow);
    const top = openUp ? Math.max(margin, r.top - maxHeight - margin) : Math.min(vh - margin, r.bottom + margin);
    setBox({ top, left, width, maxHeight: Math.max(120, maxHeight) });
  }, [open]);

  return (
    <span className="inline-flex shrink-0 align-middle">
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="rounded p-0.5 text-[#a1a1aa] transition-colors hover:bg-[#f4f4f5] hover:text-[#52525b]"
      >
        <HelpCircle className="h-2.5 w-2.5" />
      </button>
      {open &&
        typeof document !== "undefined" &&
        box &&
        createPortal(
          <>
            <button
              type="button"
              className="fixed inset-0 z-[200] cursor-default bg-black/20"
              aria-label="Dismiss"
              onClick={() => setOpen(false)}
            />
            <div
              role="dialog"
              aria-modal="true"
              className="fixed z-[210] overflow-y-auto overscroll-contain rounded-lg border border-zinc-600 bg-zinc-900 p-3 font-mono text-[8px] font-normal leading-relaxed text-zinc-100 shadow-2xl normal-case tracking-normal"
              style={{
                top: box.top,
                left: box.left,
                width: box.width,
                maxHeight: box.maxHeight,
              }}
            >
              {children}
            </div>
          </>,
          document.body
        )}
    </span>
  );
}
