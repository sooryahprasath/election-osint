"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { normalizeOperationMode } from "@/lib/config/operationMode";

const SIGNALS_PAGE_SIZE = 500;

interface LiveDataContextProps {
  constituencies: any[];
  candidates: any[];
  signals: any[];
  turnoutData: any[];
  exitPolls: any[];
  liveResults: any[];
  opinionPolls: any[];
  isConnected: boolean;
  refreshSignals: () => Promise<void>;
  refreshWarRoom: () => Promise<void>;
  simulatedDate: Date | null;
  setSimulatedDate: (date: Date | null) => void;
  operationMode: string;
  setOperationMode: (mode: string) => void;
}

const LiveDataContext = createContext<LiveDataContextProps>({
  constituencies: [], candidates: [], signals: [], turnoutData: [], exitPolls: [], liveResults: [], opinionPolls: [],
  isConnected: false, simulatedDate: null, setSimulatedDate: () => { },
  refreshSignals: async () => { },
  refreshWarRoom: async () => { },
  operationMode: "PRE-POLL", setOperationMode: () => { },
});

export const useLiveData = () => useContext(LiveDataContext);

export const LiveDataProvider = ({ children }: { children: React.ReactNode }) => {
  const [constituencies, setConstituencies] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);
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

  // Helper to bypass 1000 limit silently in the background
  const fetchHeavyTable = async (table: string) => {
    let allData: any[] = [];
    let from = 0; const step = 1000;
    while (true) {
      const { data, error } = await supabase.from(table).select("*").range(from, from + step - 1);
      if (error || !data) break;
      allData = [...allData, ...data];
      if (data.length < step) break;
      from += step;
    }
    return allData;
  };

  useEffect(() => {
    let isMounted = true;

    const mergeSignalsNewestFirst = (incoming: any[], prev: any[]) => {
      const byId = new Map<string, any>();
      for (const s of incoming) byId.set(String(s.id), s);
      for (const s of prev) {
        const id = String(s.id);
        if (!byId.has(id)) byId.set(id, s);
      }
      const merged = Array.from(byId.values());
      merged.sort((a, b) => {
        const at = Date.parse(a.created_at || "") || 0;
        const bt = Date.parse(b.created_at || "") || 0;
        return bt - at;
      });
      return merged.slice(0, SIGNALS_PAGE_SIZE);
    };

    // 1. FAST PAYLOAD: Load Map, News, and HUD data instantly
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
        console.error("[LiveDataContext] Fast Payload Failed", err);
      }
    };

    // 2. HEAVY PAYLOAD: Load Candidates in the background
    const loadHeavyData = async () => {
      const cands = await fetchHeavyTable("candidates");
      if (isMounted && cands) setCandidates(cands);
    };

    loadVanguardData().then(() => loadHeavyData());

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

    // 2B. SAFETY NET: If realtime drops or is blocked, poll latest signals.
    // This ensures the Intelligence feed updates without a full page refresh.
    const signalsPoller = setInterval(async () => {
      if (!isMounted) return;
      try {
        await refreshSignals();
      } catch {
        // silent: realtime error logging already exists below
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

    // 3. REALTIME LISTENERS (Bulletproof Version)
    const channel = supabase.channel("schema-db-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "signals" }, (payload) => {
        if (!isMounted) return;

        console.log("Realtime Signal:", payload.eventType, 'new' in payload ? (payload.new as any).id : 'N/A');

        setSignals((prev) => {
          if (payload.eventType === "INSERT") {
            // 🔥 FIX: Just push it to the top. Do NOT sort here, let the UI handle sorting. 
            // This prevents date-parsing errors from breaking the realtime feed.
            return [payload.new, ...prev].slice(0, SIGNALS_PAGE_SIZE);
          }
          else if (payload.eventType === "UPDATE") {
            return prev.map((sig) => (sig.id === payload.new.id ? payload.new : sig));
          }
          else if (payload.eventType === "DELETE") {
            return prev.filter((sig) => sig.id !== payload.old.id);
          }
          return prev;
        });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "candidates" }, (payload) => {
        if (isMounted) setCandidates((prev) => [...prev, payload.new]);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "voter_turnout" }, (payload) => {
        if (!isMounted) return;
        if (payload.eventType === "INSERT") {
          setTurnoutData((prev) => [payload.new, ...prev]);
        } else if (payload.eventType === "UPDATE") {
          setTurnoutData((prev) => prev.map((t) => (t.id === payload.new.id ? payload.new : t)));
        } else if (payload.eventType === "DELETE") {
          setTurnoutData((prev) => prev.filter((t) => t.id !== payload.old.id));
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "exit_polls" }, (payload) => {
        if (!isMounted) return;
        if (payload.eventType === "INSERT") {
          setExitPolls((prev) => [payload.new, ...prev]);
        } else if (payload.eventType === "UPDATE") {
          setExitPolls((prev) => prev.map((e) => (e.id === payload.new.id ? payload.new : e)));
        } else if (payload.eventType === "DELETE") {
          setExitPolls((prev) => prev.filter((e) => e.id !== payload.old.id));
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "live_results" }, (payload) => {
        if (isMounted && payload.eventType === "UPDATE") {
          setLiveResults((prev) => prev.map((lr) => (lr.id === payload.new.id ? payload.new : lr)));
        }
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "opinion_polls" }, (payload) => {
        if (isMounted) setOpinionPolls((prev) => [payload.new, ...prev]);
      })
      .subscribe((status, err) => {
        // 🔥 FIX: Added error logging so you know if Supabase disconnects
        if (status === 'SUBSCRIBED') {
          console.log('🟢 Supabase Realtime Connected');
          if (isMounted) setIsConnected(true);
        } else if (status === 'CHANNEL_ERROR') {
          console.error('🔴 Supabase Realtime Error:', err);
          if (isMounted) setIsConnected(false);
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
      signals,
      turnoutData,
      exitPolls,
      liveResults,
      opinionPolls,
      isConnected,
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
      signals,
      turnoutData,
      exitPolls,
      liveResults,
      opinionPolls,
      isConnected,
      simulatedDate,
      operationMode,
      setOperationMode,
    ]
  );

  return <LiveDataContext.Provider value={value}>{children}</LiveDataContext.Provider>;
};