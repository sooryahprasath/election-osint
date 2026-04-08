import { useEffect, useRef, useState } from "react";

type PullState = "idle" | "pulling" | "ready" | "refreshing";

/**
 * Minimal pull-to-refresh for scroll containers.
 * - Only activates when the container is scrolled to top.
 * - Touch-only (mobile), safe for desktop.
 */
export function usePullToRefresh({
  enabled,
  onRefresh,
  thresholdPx = 56,
}: {
  enabled: boolean;
  onRefresh: () => Promise<void> | void;
  thresholdPx?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const startY = useRef<number | null>(null);
  const [pullPx, setPullPx] = useState(0);
  const [state, setState] = useState<PullState>("idle");
  const stateRef = useRef<PullState>("idle");
  const pullPxRef = useRef<number>(0);

  const setStateBoth = (next: PullState) => {
    stateRef.current = next;
    setState(next);
  };

  const setPullPxBoth = (next: number) => {
    pullPxRef.current = next;
    setPullPx(next);
  };

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    const isAtTop = () => el.scrollTop <= 0;

    const onTouchStart = (e: TouchEvent) => {
      if (stateRef.current === "refreshing") return;
      if (!isAtTop()) return;
      startY.current = e.touches[0]?.clientY ?? null;
      setPullPxBoth(0);
      setStateBoth("idle");
    };

    const onTouchMove = (e: TouchEvent) => {
      if (stateRef.current === "refreshing") return;
      if (startY.current == null) return;
      if (!isAtTop()) return;
      const y = e.touches[0]?.clientY ?? null;
      if (y == null) return;
      const dy = y - startY.current;
      if (dy <= 0) return;

      // Apply a little resistance.
      const next = Math.min(96, Math.round(dy * 0.55));
      setPullPxBoth(next);
      setStateBoth(next >= thresholdPx ? "ready" : "pulling");

      // Prevent the browser from doing native overscroll bounce.
      e.preventDefault();
    };

    const onTouchEnd = async () => {
      if (stateRef.current === "ready") {
        try {
          setStateBoth("refreshing");
          setPullPxBoth(thresholdPx);
          await onRefresh();
        } finally {
          startY.current = null;
          setPullPxBoth(0);
          setStateBoth("idle");
        }
        return;
      }
      startY.current = null;
      setPullPxBoth(0);
      setStateBoth("idle");
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    // must be non-passive to allow preventDefault()
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove as any);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [enabled, onRefresh, thresholdPx]);

  return {
    ref,
    pullPx,
    state,
  };
}

