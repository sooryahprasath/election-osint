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
    const tod = String(briefing.time_of_day || "Latest").trim();
    const prettyTod = tod ? tod.charAt(0).toUpperCase() + tod.slice(1).toLowerCase() : "Latest";
    const title = `${prettyTod} brief`;
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
      <div className="px-4 py-6 flex flex-col items-center justify-center text-[var(--text-muted)]">
        <Loader2 className="h-4 w-4 animate-spin mb-2 text-[var(--brand)]" />
        <span className="text-[12px]">Loading today&apos;s briefing…</span>
      </div>
    );
  }

  if (!briefing) {
    return (
      <div className="mx-4 my-3 rounded-[var(--radius)] border border-dashed border-[color:var(--border)] bg-[var(--surface-2)] p-4 text-center text-[var(--text-muted)] text-[12px]">
        <ShieldAlert className="h-4 w-4 mx-auto mb-1.5 opacity-60" />
        No briefing for today yet. We post a fresh one every morning.
      </div>
    );
  }

  const sourcesCount = Number(briefing.sources_count || 0);
  const confidence = Number(briefing.confidence_score || 3);

  return (
    <div className="px-4 pb-3 pt-1">
      <div className="overflow-hidden rounded-[var(--radius)] border border-[color:var(--border)] bg-[var(--surface-1)]">
        {(briefing.paragraphs || []).map((para: any, idx: number) => (
          <div
            key={idx}
            className={`flex items-start gap-2.5 px-3 py-3 ${
              idx > 0 ? "border-t border-[color:var(--border)]" : ""
            }`}
          >
            <span
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: para.color_hex || "var(--brand)" }}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <div className="text-[12.5px] font-semibold leading-snug text-[var(--text-primary)]">
                {String(para.heading || "").replace(/:$/, "")}
              </div>
              <div className="mt-1 text-[12px] leading-snug text-[var(--text-secondary)]">{para.body}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--text-muted)]">Confidence</span>
          <div className="flex gap-0.5" aria-label={`Confidence ${confidence} of 5`}>
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className={`h-1.5 w-3 rounded-[2px] ${i <= confidence ? "bg-[var(--brand)]" : "bg-[var(--surface-3)]"}`} />
            ))}
          </div>
        </div>
        <span className="text-[11px] text-[var(--text-muted)] text-right">
          <span className="num font-mono tabular-nums">{sourcesCount}</span> sources
        </span>
      </div>
    </div>
  );
}

