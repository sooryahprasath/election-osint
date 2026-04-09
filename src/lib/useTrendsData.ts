"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { HistoricalResult, TrendWindow } from "@/lib/utils/trends";

const PAGE_SIZE = 1000;
const signalCache = new Map<TrendWindow, any[]>();
let historicalResultsCache: HistoricalResult[] | null = null;
let historicalResultsPromise: Promise<HistoricalResult[]> | null = null;

function windowStartIso(window: TrendWindow): string {
  const now = Date.now();
  const delta =
    window === "6h"
      ? 6 * 60 * 60 * 1000
      : window === "24h"
        ? 24 * 60 * 60 * 1000
        : window === "3d"
          ? 3 * 24 * 60 * 60 * 1000
          : 7 * 24 * 60 * 60 * 1000;
  return new Date(now - delta).toISOString();
}

async function fetchSignals(window: TrendWindow): Promise<any[]> {
  const cached = signalCache.get(window);
  if (cached) return cached;

  const since = windowStartIso(window);
  const rows: any[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("signals")
      .select("*")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  signalCache.set(window, rows);
  return rows;
}

async function fetchHistoricalResults(): Promise<HistoricalResult[]> {
  if (historicalResultsCache) return historicalResultsCache;
  if (historicalResultsPromise) return historicalResultsPromise;

  historicalResultsPromise = (async () => {
    const { data, error } = await supabase
      .from("historical_results")
      .select("*")
      .order("election_year", { ascending: false })
      .limit(5000);

    if (error) {
      historicalResultsCache = [];
      return [];
    }

    historicalResultsCache = (data ?? []) as HistoricalResult[];
    return historicalResultsCache;
  })();

  return historicalResultsPromise;
}

export function useTrendsData(window: TrendWindow, active: boolean) {
  const [signals, setSignals] = useState<any[]>([]);
  const [historicalResults, setHistoricalResults] = useState<HistoricalResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let isMounted = true;

    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [nextSignals, nextHistoricalResults] = await Promise.all([
          fetchSignals(window),
          fetchHistoricalResults(),
        ]);
        if (!isMounted) return;
        setSignals(nextSignals);
        setHistoricalResults(nextHistoricalResults);
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : "Failed to load trends data.");
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    void load();

    const channel = supabase
      .channel(`trends-signals-${window}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "signals" }, () => {
        signalCache.clear();
        void load();
      })
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [active, window]);

  return { signals, historicalResults, isLoading, error };
}
