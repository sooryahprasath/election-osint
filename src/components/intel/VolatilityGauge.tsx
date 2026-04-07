"use client";

import { volatilityColor } from "@/lib/utils/formatting";

interface VolatilityGaugeProps {
  score: number; // 0-100
}

export default function VolatilityGauge({ score }: VolatilityGaugeProps) {
  const color = volatilityColor(score);
  const segments = 20;
  const filledSegments = Math.round((score / 100) * segments);

  return (
    <div className="flex flex-col gap-1.5">
      {/* Bar gauge */}
      <div className="flex gap-0.5">
        {Array.from({ length: segments }).map((_, i) => (
          <div
            key={i}
            className="h-2 flex-1 rounded-sm transition-all"
            style={{
              backgroundColor: i < filledSegments ? color : "var(--surface-3)",
              opacity: i < filledSegments ? 0.5 + (i / segments) * 0.5 : 1,
            }}
          />
        ))}
      </div>

      {/* Labels */}
      <div className="flex justify-between font-mono text-[8px] text-[var(--text-muted)]">
        <span>STABLE</span>
        <span>MODERATE</span>
        <span>VOLATILE</span>
        <span>CRITICAL</span>
      </div>
    </div>
  );
}
