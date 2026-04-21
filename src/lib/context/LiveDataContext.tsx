"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { normalizeOperationMode } from "@/lib/config/operationMode";
import { STATE_META } from "@/lib/utils/states";

const SIGNALS_PAGE_SIZE = 500;

interface LiveDataContextProps {
  constituencies: any[];
  candidates: any[];
  candidateCounts: Record<string, number>;
  /** Candidates with criminal_cases &gt; 0 (same scope as candidateCounts). */
  criminalCounts: Record<string, number>;
  signals: any[];
  turnoutData: any[];
  exitPolls: any[];
  liveResults: any[];
  opinionPolls: any[];
  isConnected: boolean;
  refreshSignals: () => Promise<void>;
  refreshWarRoom: () => Promise<void>;
  ensureCandidatesForPrefixes: (prefixes: string[]) => Promise<void>;
  simulatedDate: Date | null;
  setSimulatedDate: (date: Date | null) => void;
  operationMode: string;
  setOperationMode: (mode: string) => void;
}

const LiveDataContext = createContext<LiveDataContextProps>({
  constituencies: [],
  candidates: [],
  candidateCounts: {},
  criminalCounts: {},
  signals: [],
  turnoutData: [],
  exitPolls: [],
  liveResults: [],
  opinionPolls: [],
  isConnected: false,
  simulatedDate: null,
  setSimulatedDate: () => {},
  refreshSignals: async () => {},
  refreshWarRoom: async () => {},
  ensureCandidatesForPrefixes: async () => {},
  operationMode: "PRE-POLL",
  setOperationMode: () => {},
});

export const useLiveData = () => useContext(LiveDataContext);

export const LiveDataProvider = ({ children }: { children: React.ReactNode }) => {
  const [constituencies, setConstituencies] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [candidateCounts, setCandidateCounts] = useState<Record<string, number>>({});
  const [criminalCounts, setCriminalCounts] = useState<Record<string, number>>({});
  const [signals, setSignals] = useState<any[]>([]);
  const [turnoutData, setTurnoutData] = useState<any[]>([]);
  const [exitPolls, setExitPolls] = useState<any[]>([]);
  const [liveResults, setLiveResults] = useState<any[]>([]);
  const [opinionPolls, setOpinionPolls] = useState<any[]>([]);

  const [isConnected, setIsConnected] = useState(false);
  const [simulatedDate, setSimulatedDate] = useState<Date | null>(null);
  const [operationMode, setOperationModeState] = useState<string>(() =>
    normalizeOperationMode(process.env.NEXT_PUBLIC_OPERATION_MODE || "PRE-POLL")
  );
  const setOperationMode = useCallback((mode: string) => {
    setOperationModeState(normalizeOperationMode(mode));
  }, []);

  // Columns required across CandidateRow + CandidateModal + ConstituencyCard.
  // Excludes `background` (large text) — loaded on-demand in CandidateModal.
  const CANDIDATE_COLS = [
    "id", "name", "party", "party_abbreviation", "party_color",
    "constituency_id", "is_independent", "incumbent", "removed",
    "age", "gender", "assets_value", "liabilities_value",
    "criminal_cases", "photo_url", "education", "nomination_status",
    "eci_affidavit_url", "source_url", "myneta_url", "myneta_candidate_id",
    "eci_last_synced_at", "myneta_last_synced_at",
  ].join(",")

  const fetchHeavyTable = async (table: string) => {
    const STEP = 1000
    // Probe total count first, then fetch all pages in parallel.
    const baseQuery = supabase.from(table)
    const countQuery =
      table === "candidates"
        ? baseQuery.select(CANDIDATE_COLS, { count: "exact", head: true }).eq("removed", false)
        : baseQuery.select("*", { count: "exact", head: true })

    const { count, error: cntErr } = await countQuery
    if (cntErr || count == null || count === 0) return []

    const pages = Math.ceil(count / STEP)
    const fetches = Array.from({ length: pages }, (_, i) =>
      table === "candidates"
        ? supabase
            .from(table)
            .select(CANDIDATE_COLS)
            .eq("removed", false)
            .range(i * STEP, (i + 1) * STEP - 1)
        : supabase
            .from(table)
            .select("*")
            .range(i * STEP, (i + 1) * STEP - 1)
    )
    const results = await Promise.all(fetches)
    const allData: any[] = []
    for (const { data } of results) {
      if (data) allData.push(...data)
    }
    return allData
  }

  const loadedCandidatePrefixesRef = useRef<Set<string>>(new Set())

  const fetchCandidatesForPrefix = useCallback(
    async (prefix: string) => {
      const STEP = 1000
      const { count, error: cntErr } = await supabase
        .from("candidates")
        .select(CANDIDATE_COLS, { count: "exact", head: true })
        .eq("removed", false)
        .like("constituency_id", `${prefix}-%`)
      if (cntErr || count == null || count === 0) return []

      const pages = Math.ceil(count / STEP)
      const fetches = Array.from({ length: pages }, (_, i) =>
        supabase
          .from("candidates")
          .select(CANDIDATE_COLS)
          .eq("removed", false)
          .like("constituency_id", `${prefix}-%`)
          .range(i * STEP, (i + 1) * STEP - 1)
      )
      const results = await Promise.all(fetches)
      const out: any[] = []
      for (const { data } of results) if (data) out.push(...data)
      return out
    },
    [CANDIDATE_COLS]
  )

  const ensureCandidatesForPrefixes = useCallback(
    async (prefixes: string[]) => {
      const wanted = (prefixes || []).map((p) => String(p || "").trim()).filter(Boolean)
      const toLoad = wanted.filter((p) => !loadedCandidatePrefixesRef.current.has(p))
      if (toLoad.length === 0) return

      for (const pfx of toLoad) loadedCandidatePrefixesRef.current.add(pfx)

      const chunks = await Promise.all(toLoad.map((pfx) => fetchCandidatesForPrefix(pfx)))
      const incoming = chunks.flat()
      if (incoming.length === 0) return

      setCandidates((prev) => {
        const byId = new Map<string, any>()
        for (const c of prev) byId.set(String(c.id), c)
        for (const c of incoming) byId.set(String(c.id), c)
        return Array.from(byId.values())
      })
    },
    [fetchCandidatesForPrefix]
  )

  useEffect(() => {
    let isMounted = true;

    const mergeSignalsNewestFirst = (incoming: any[], prev: any[]) => {
      const byId = new Map<string, any>();
      for (const signal of incoming) byId.set(String(signal.id), signal);
      for (const signal of prev) {
        const id = String(signal.id);
        if (!byId.has(id)) byId.set(id, signal);
      }
      const merged = Array.from(byId.values());
      merged.sort((a, b) => {
        const at = Date.parse(a.created_at || "") || 0;
        const bt = Date.parse(b.created_at || "") || 0;
        return bt - at;
      });
      return merged.slice(0, SIGNALS_PAGE_SIZE);
    };

    const loadVanguardData = async () => {
      try {
        const [cwRes, sigRes, turnRes, exitRes, liveRes, pollRes] = await Promise.all([
          supabase.from("constituencies").select("*").limit(2000),
          supabase.from("signals").select("*").order("created_at", { ascending: false }).limit(SIGNALS_PAGE_SIZE),
          supabase.from("voter_turnout").select("*"),
          supabase.from("exit_polls").select("*"),
          supabase.from("live_results").select("*"),
          supabase.from("opinion_polls").select("*").order("publish_date", { ascending: false }).limit(200),
        ]);

        if (isMounted) {
          if (cwRes.data) setConstituencies(cwRes.data);
          if (sigRes.data) setSignals(sigRes.data);
          if (turnRes.data) setTurnoutData(turnRes.data);
          if (exitRes.data) setExitPolls(exitRes.data);
          if (liveRes.data) setLiveResults(liveRes.data);
          if (pollRes.data) setOpinionPolls(pollRes.data);
          setIsConnected(true);
        }
      } catch (err) {
        console.error("[LiveDataContext] Fast payload failed", err);
      }
    };

    /** Head-only counts so CANDS + CRIM show immediately (no candidate row download). */
    const loadOverviewStats = async () => {
      try {
        const stateNames = Object.keys(STATE_META).filter((s) => s !== "ALL");
        const rows = await Promise.all(
          stateNames.map(async (stateName) => {
            const prefix = STATE_META[stateName]?.dbPrefix;
            if (!prefix) return { state: stateName, total: 0, criminal: 0 };
            const like = `${prefix}-%`;
            const [totalRes, crimRes] = await Promise.all([
              supabase
                .from("candidates")
                .select("id", { count: "exact", head: true })
                .eq("removed", false)
                .like("constituency_id", like),
              supabase
                .from("candidates")
                .select("id", { count: "exact", head: true })
                .eq("removed", false)
                .like("constituency_id", like)
                .gt("criminal_cases", 0),
            ]);
            return {
              state: stateName,
              total: totalRes.count ?? 0,
              criminal: crimRes.count ?? 0,
            };
          })
        );
        const cand: Record<string, number> = {};
        const crim: Record<string, number> = {};
        for (const r of rows) {
          cand[r.state] = r.total;
          crim[r.state] = r.criminal;
        }
        cand.ALL = Object.values(cand).reduce((s, n) => s + (Number(n) || 0), 0);
        crim.ALL = Object.values(crim).reduce((s, n) => s + (Number(n) || 0), 0);
        if (isMounted) {
          setCandidateCounts(cand);
          setCriminalCounts(crim);
        }
      } catch (err) {
        console.error("[LiveDataContext] Overview stats preload failed", err);
      }
    };

    const loadHeavyData = async () => {
      // Candidates are loaded on-demand per state prefix (prevents huge cold-start payloads).
    };

    loadVanguardData()
      .then(() => loadOverviewStats())
      .then(() => loadHeavyData());

    const refreshSignals = async () => {
      if (!isMounted) return;
      const { data } = await supabase
        .from("signals")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(SIGNALS_PAGE_SIZE);
      if (data && data.length > 0) {
        setSignals((prev) => mergeSignalsNewestFirst(data, prev));
      }
    };

    const signalsPoller = setInterval(async () => {
      if (!isMounted) return;
      try {
        await refreshSignals();
      } catch {
        // silent: realtime status logging below already covers the degraded path
      }
    }, 15000);

    const warRoomPoller = setInterval(async () => {
      if (!isMounted) return;
      try {
        const [tRes, eRes] = await Promise.all([
          supabase.from("voter_turnout").select("*"),
          supabase.from("exit_polls").select("*"),
        ]);
        if (tRes.data) setTurnoutData(tRes.data);
        if (eRes.data) setExitPolls(eRes.data);
      } catch {
        /* ignore */
      }
    }, 45000);

    const realtimeWarnedRef = { current: false as boolean };

    const channel = supabase
      .channel("schema-db-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "signals" }, (payload) => {
        if (!isMounted) return;

        console.log("Realtime Signal:", payload.eventType, "new" in payload ? (payload.new as any).id : "N/A");

        setSignals((prev) => {
          if (payload.eventType === "INSERT") {
            return [payload.new, ...prev].slice(0, SIGNALS_PAGE_SIZE);
          }
          if (payload.eventType === "UPDATE") {
            return prev.map((signal) => (signal.id === payload.new.id ? payload.new : signal));
          }
          if (payload.eventType === "DELETE") {
            return prev.filter((signal) => signal.id !== payload.old.id);
          }
          return prev;
        });
      })
      // NOTE: Do not realtime-stream candidates.
      // Candidates are large and re-scrapes can introduce duplicates; we load per-state on demand instead.
      .on("postgres_changes", { event: "*", schema: "public", table: "voter_turnout" }, (payload) => {
        if (!isMounted) return;
        if (payload.eventType === "INSERT") {
          setTurnoutData((prev) => [payload.new, ...prev]);
        } else if (payload.eventType === "UPDATE") {
          setTurnoutData((prev) => prev.map((row) => (row.id === payload.new.id ? payload.new : row)));
        } else if (payload.eventType === "DELETE") {
          setTurnoutData((prev) => prev.filter((row) => row.id !== payload.old.id));
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "exit_polls" }, (payload) => {
        if (!isMounted) return;
        if (payload.eventType === "INSERT") {
          setExitPolls((prev) => [payload.new, ...prev]);
        } else if (payload.eventType === "UPDATE") {
          setExitPolls((prev) => prev.map((row) => (row.id === payload.new.id ? payload.new : row)));
        } else if (payload.eventType === "DELETE") {
          setExitPolls((prev) => prev.filter((row) => row.id !== payload.old.id));
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "live_results" }, (payload) => {
        if (isMounted && payload.eventType === "UPDATE") {
          setLiveResults((prev) => prev.map((row) => (row.id === payload.new.id ? payload.new : row)));
        }
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "opinion_polls" }, (payload) => {
        if (isMounted) setOpinionPolls((prev) => [payload.new, ...prev]);
      })
      .subscribe((status, err) => {
        if (!isMounted) return;

        if (status === "SUBSCRIBED") {
          console.log("[LiveDataContext] Supabase Realtime connected");
          setIsConnected(true);
          return;
        }

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          const detail =
            err instanceof Error
              ? err.message
              : typeof err === "string"
                ? err
                : "No error details from Supabase; falling back to polling.";

          // Polling still refreshes signals/war-room; Realtime is optional.
          // Common causes: Realtime not enabled for tables (Dashboard → Database → Publications),
          // or opening the app from file:// instead of http://localhost.
          if (!realtimeWarnedRef.current) {
            realtimeWarnedRef.current = true;
            console.warn(
              `[LiveDataContext] Supabase Realtime ${status.toLowerCase()} (once): ${detail} ` +
                "Signals still update via polling every 15s."
            );
          }
          setIsConnected(false);
        }
      });

    return () => {
      isMounted = false;
      clearInterval(signalsPoller);
      clearInterval(warRoomPoller);
      supabase.removeChannel(channel);
    };
  }, []);

  const value = useMemo(
    () => ({
      constituencies,
      candidates,
      candidateCounts,
      criminalCounts,
      signals,
      turnoutData,
      exitPolls,
      liveResults,
      opinionPolls,
      isConnected,
      ensureCandidatesForPrefixes,
      refreshSignals: async () => {
        const { data } = await supabase
          .from("signals")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(SIGNALS_PAGE_SIZE);
        if (data && data.length > 0) {
          setSignals((prev) => {
            const byId = new Map<string, any>();
            for (const s of data) byId.set(String(s.id), s);
            for (const s of prev) {
              const id = String(s.id);
              if (!byId.has(id)) byId.set(id, s);
            }
            const merged = Array.from(byId.values());
            merged.sort((a, b) => (Date.parse(b.created_at || "") || 0) - (Date.parse(a.created_at || "") || 0));
            return merged.slice(0, SIGNALS_PAGE_SIZE);
          });
        }
      },
      refreshWarRoom: async () => {
        const [tRes, eRes] = await Promise.all([
          supabase.from("voter_turnout").select("*"),
          supabase.from("exit_polls").select("*"),
        ]);
        if (tRes.data) setTurnoutData(tRes.data);
        if (eRes.data) setExitPolls(eRes.data);
      },
      simulatedDate,
      setSimulatedDate,
      operationMode,
      setOperationMode,
    }),
    [
      constituencies,
      candidates,
      candidateCounts,
      criminalCounts,
      signals,
      turnoutData,
      exitPolls,
      liveResults,
      opinionPolls,
      isConnected,
      ensureCandidatesForPrefixes,
      simulatedDate,
      operationMode,
      setOperationMode,
    ]
  );

  return <LiveDataContext.Provider value={value}>{children}</LiveDataContext.Provider>;
};
