"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface LiveDataContextProps {
  constituencies: any[];
  candidates: any[];
  signals: any[];
  turnoutData: any[];
  exitPolls: any[];
  liveResults: any[];
  isConnected: boolean;
  simulatedDate: Date | null;
  setSimulatedDate: (date: Date | null) => void;
  operationMode: string;
  setOperationMode: (mode: string) => void;
}

const LiveDataContext = createContext<LiveDataContextProps>({
  constituencies: [], candidates: [], signals: [], turnoutData: [], exitPolls: [], liveResults: [],
  isConnected: false, simulatedDate: null, setSimulatedDate: () => { },
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

  const [isConnected, setIsConnected] = useState(false);
  const [simulatedDate, setSimulatedDate] = useState<Date | null>(null);
  const [operationMode, setOperationMode] = useState<string>(process.env.NEXT_PUBLIC_OPERATION_MODE || "PRE-POLL");

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

    // 1. FAST PAYLOAD: Load Map, News, and HUD data instantly
    const loadVanguardData = async () => {
      try {
        const [cwRes, sigRes, turnRes, exitRes, liveRes] = await Promise.all([
          supabase.from("constituencies").select("*").limit(2000),
          supabase.from("signals").select("*").order("created_at", { ascending: false }).limit(500),
          supabase.from("voter_turnout").select("*"),
          supabase.from("exit_polls").select("*"),
          supabase.from("live_results").select("*")
        ]);

        if (isMounted) {
          if (cwRes.data) setConstituencies(cwRes.data);
          if (sigRes.data) setSignals(sigRes.data);
          if (turnRes.data) setTurnoutData(turnRes.data);
          if (exitRes.data) setExitPolls(exitRes.data);
          if (liveRes.data) setLiveResults(liveRes.data);
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

    // 3. REALTIME LISTENERS (Bulletproof Version)
    const channel = supabase.channel("schema-db-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "signals" }, (payload) => {
        if (!isMounted) return;

        console.log("Realtime Signal:", payload.eventType, payload.new?.id); // Keep this for debugging

        setSignals((prev) => {
          if (payload.eventType === "INSERT") {
            // 🔥 FIX: Just push it to the top. Do NOT sort here, let the UI handle sorting. 
            // This prevents date-parsing errors from breaking the realtime feed.
            return [payload.new, ...prev].slice(0, 500);
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
        if (isMounted && payload.eventType === "UPDATE") {
          setTurnoutData((prev) => prev.map((t) => (t.id === payload.new.id ? payload.new : t)));
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "live_results" }, (payload) => {
        if (isMounted && payload.eventType === "UPDATE") {
          setLiveResults((prev) => prev.map((lr) => (lr.id === payload.new.id ? payload.new : lr)));
        }
      })
      .subscribe((status, err) => {
        // 🔥 FIX: Added error logging so you know if Supabase disconnects
        if (status === 'SUBSCRIBED') {
          console.log('🟢 Supabase Realtime Connected');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('🔴 Supabase Realtime Error:', err);
        }
      });

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <LiveDataContext.Provider value={{ constituencies, candidates, signals, turnoutData, exitPolls, liveResults, isConnected, simulatedDate, setSimulatedDate, operationMode, setOperationMode }}>
      {children}
    </LiveDataContext.Provider>
  );
};