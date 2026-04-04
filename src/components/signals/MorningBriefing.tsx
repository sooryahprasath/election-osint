"use client";

import { useEffect, useState } from "react";
import { Sparkles, Sun, Sunset, Moon } from "lucide-react";

export default function MorningBriefing() {
  const [timeOfDay, setTimeOfDay] = useState("MORNING");

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 12) setTimeOfDay("MORNING");
    else if (hour < 18) setTimeOfDay("AFTERNOON");
    else setTimeOfDay("EVENING");
  }, []);

  const getIcon = () => {
    if (timeOfDay === "MORNING") return <Sun className="h-3.5 w-3.5 text-[#16a34a]" />;
    if (timeOfDay === "AFTERNOON") return <Sun className="h-3.5 w-3.5 text-[#ea580c]" />;
    return <Moon className="h-3.5 w-3.5 text-[#0284c7]" />;
  };

  return (
    <div className="px-3 py-2.5">
      <div className="shadow-sm border border-[#e4e4e7] rounded p-3">
        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          {getIcon()}
          <span className="font-mono text-[10px] text-[#16a34a] font-bold" suppressHydrationWarning>{timeOfDay} AI BRIEF — {new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
          </span>
        </div>

        {/* Briefing Content */}
        <div className="space-y-2 text-[11px] text-[#27272a] leading-relaxed">
          <p>
            <span className="text-[#16a34a] font-bold">▸ T-6 to Phase 1:</span>{" "}
            Kerala and Assam enter the final campaign stretch. ECI has deployed
            additional CAPF in 47 sensitive constituencies across Malabar and
            upper Assam. Model code violations reported at an all-time high.
          </p>
          <p>
            <span className="text-[#ea580c] font-bold">▸ Key Battleground:</span>{" "}
            Northern Kerala remains the most volatile zone with CPI(M)-Congress
            margins under 2% in 23 constituencies. BJP targeting 15+ seats in
            Malappuram-Kozhikode belt with OBC consolidation strategy.
          </p>
          <p>
            <span className="text-[#0284c7] font-bold">▸ Assam Watch:</span>{" "}
            BJP-AGP alliance projects confidence in retaining power. AIUDF-Congress
            understanding in minority-dominated Dhubri corridor could flip 8-12
            seats. NRC factor remains unpredictable variable.
          </p>
          <p>
            <span className="text-[#52525b] font-bold">▸ Phase 2 Preview:</span>{" "}
            Tamil Nadu DMK machinery in full deployment. AIADMK internal rift
            weakens opposition bench. Bengal TMC faces aggressive BJP ground game
            in North Bengal tribal belts.
          </p>
        </div>

        {/* Confidence Indicator */}
        <div className="mt-2.5 flex items-center gap-2 pt-2 border-t border-[#e4e4e7]">
          <span className="font-mono text-[9px] text-[#71717a]">CONFIDENCE:</span>
          <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className={`h-1.5 w-3 rounded-sm ${
                  i <= 3 ? "bg-[#16a34a]" : "bg-[#e4e4e7]"
                }`}
              />
            ))}
          </div>
          <span className="font-mono text-[9px] text-[#71717a]">
            MODERATE — BASED ON 15 SOURCES
          </span>
        </div>
      </div>
    </div>
  );
}
