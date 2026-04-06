"use client";

import { useEffect, useState } from "react";
import { Sun, Moon, Loader2, ShieldAlert } from "lucide-react";
// 🔥 FIX: Use the shared, single-instance Supabase client
import { supabase } from "@/lib/supabase";

export default function MorningBriefing() {
  const [briefing, setBriefing] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const fetchBriefing = async () => {
      try {
        const { data, error } = await supabase
          .from("briefings")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (isMounted) {
          if (data) setBriefing(data);
          setLoading(false);
        }
      } catch (err) {
        console.error("Failed to load briefing:", err);
        if (isMounted) setLoading(false);
      }
    };

    fetchBriefing();

    // Set up a realtime subscription
    const channel = supabase.channel('briefing_updates')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'briefings' }, (payload) => {
        if (isMounted) setBriefing(payload.new);
      }).subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  const getIcon = (timeOfDay: string) => {
    if (timeOfDay === "MORNING") return <Sun className="h-3.5 w-3.5 text-[#16a34a]" />;
    if (timeOfDay === "AFTERNOON") return <Sun className="h-3.5 w-3.5 text-[#ea580c]" />;
    return <Moon className="h-3.5 w-3.5 text-[#0284c7]" />;
  };

  if (loading) {
    return (
      <div className="px-3 py-6 flex flex-col items-center justify-center text-[#71717a]">
        <Loader2 className="h-5 w-5 animate-spin mb-2 text-[#16a34a]" />
        <span className="font-mono text-[9px]">AWAITING AI SYNC...</span>
      </div>
    );
  }

  if (!briefing) {
    return (
      <div className="px-3 py-4 text-center text-[#71717a] font-mono text-[10px]">
        <ShieldAlert className="h-4 w-4 mx-auto mb-1 opacity-50" />
        No tactical briefing available yet.
      </div>
    );
  }

  return (
    <div className="px-3 py-2.5">
      <div className="shadow-sm border border-[#e4e4e7] rounded p-3 bg-white">
        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          {getIcon(briefing.time_of_day || "MORNING")}
          <span className="font-mono text-[10px] font-bold text-[#18181b]" suppressHydrationWarning>
            {briefing.time_of_day} AI BRIEF — {new Date(briefing.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
          </span>
        </div>

        {/* Dynamic Briefing Content */}
        <div className="space-y-3 text-[11px] text-[#27272a] leading-relaxed">
          {briefing.paragraphs && briefing.paragraphs.map((para: any, idx: number) => (
            <p key={idx}>
              <span style={{ color: para.color_hex || "#16a34a" }} className="font-bold">
                ▸ {para.heading}
              </span>{" "}
              {para.body}
            </p>
          ))}
        </div>

        {/* Confidence Indicator */}
        <div className="mt-3 flex items-center justify-between pt-2 border-t border-[#e4e4e7]">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[9px] text-[#71717a]">AI RELIABILITY:</span>
            <div className="flex gap-0.5">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className={`h-1.5 w-3 rounded-sm ${i <= (briefing.confidence_score || 3) ? "bg-[#16a34a]" : "bg-[#e4e4e7]"}`} />
              ))}
            </div>
          </div>
          <span className="font-mono text-[8px] text-[#71717a] text-right">
            BASED ON {briefing.sources_count || 0} CORROBORATED SOURCES
          </span>
        </div>
      </div>
    </div>
  );
}