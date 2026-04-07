"use client";

import { useEffect, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { supabase } from "@/lib/supabase";

export type AIBriefingMeta = {
  title: string;
  dateLabel: string;
  sourcesCount: number;
  confidence: number;
};

export default function AIBriefing({ onMeta }: { onMeta?: (m: AIBriefingMeta) => void }) {
  const [briefing, setBriefing] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const fetchBriefing = async () => {
      try {
        const { data } = await supabase
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

    const channel = supabase
      .channel("briefing_updates")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "briefings" }, (payload) => {
        if (isMounted) setBriefing(payload.new);
      })
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  // IMPORTANT: keep hooks order stable (no hooks after conditional returns).
  useEffect(() => {
    if (!onMeta) return;
    if (loading || !briefing) return;
    const title = `${String(briefing.time_of_day || "LATEST").toUpperCase()} AI BRIEF`;
    const dateLabel = new Date(briefing.created_at).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    const sourcesCount = Number(briefing.sources_count || 0);
    const confidence = Number(briefing.confidence_score || 3);
    onMeta({ title, dateLabel, sourcesCount, confidence });
  }, [onMeta, loading, briefing]);

  if (loading) {
    return (
      <div className="px-3 py-6 flex flex-col items-center justify-center text-[var(--text-muted)]">
        <Loader2 className="h-5 w-5 animate-spin mb-2 text-[#16a34a]" />
        <span className="font-mono text-[9px]">AWAITING AI SYNC...</span>
      </div>
    );
  }

  if (!briefing) {
    return (
      <div className="px-3 py-4 text-center text-[var(--text-muted)] font-mono text-[10px]">
        <ShieldAlert className="h-4 w-4 mx-auto mb-1 opacity-50" />
        No AI briefing available yet.
      </div>
    );
  }

  const sourcesCount = Number(briefing.sources_count || 0);
  const confidence = Number(briefing.confidence_score || 3);

  return (
    <div className="px-3 pb-3 pt-2">
      <div className="grid gap-2">
        {(briefing.paragraphs || []).map((para: any, idx: number) => (
          <div key={idx} className="rounded-lg border border-[color:var(--border)] bg-[var(--surface-2)] px-2.5 py-2">
            <div className="flex items-start gap-2">
              <span
                className="mt-1 h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: para.color_hex || "#16a34a" }}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <div className="text-[12px] font-semibold text-[var(--text-primary)] leading-snug">
                  {String(para.heading || "").replace(/:$/, "")}
                </div>
                <div className="mt-0.5 text-[11px] leading-snug text-[var(--text-secondary)]">{para.body}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-[color:var(--border)] pt-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] text-[var(--text-muted)]">AI RELIABILITY</span>
          <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className={`h-1.5 w-3 rounded-sm ${i <= confidence ? "bg-[#16a34a]" : "bg-[var(--surface-3)]"}`} />
            ))}
          </div>
        </div>
        <span className="font-mono text-[8px] text-[var(--text-muted)] text-right">BASED ON {sourcesCount} SOURCES</span>
      </div>
    </div>
  );
}

