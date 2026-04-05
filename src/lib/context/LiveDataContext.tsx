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

    // 1. FAST PAYLOAD: Load Map, News, and HUD data instantly in parallel
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
          setIsConnected(true); // Unblocks the UI instantly
        }
      } catch (err) {
        console.error("[LiveDataContext] Fast Payload Failed", err);
      }
    };

    // 2. HEAVY PAYLOAD: Load Candidates in the background without blocking the UI
    const loadHeavyData = async () => {
      const cands = await fetchHeavyTable("candidates");
      if (isMounted && cands) setCandidates(cands);
    };

    // Execute Sequence
    loadVanguardData().then(() => loadHeavyData());

    // 3. REALTIME LISTENERS
    const channel = supabase.channel("schema-db-changes")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "signals" }, (p) => {
        if (isMounted) setSignals((prev) => [p.new, ...prev]);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "candidates" }, (p) => {
        if (isMounted) setCandidates((prev) => [...prev, p.new]);
      })
      // Targeted Refetches for War Room Data
      .on("postgres_changes", { event: "*", schema: "public", table: "voter_turnout" }, async () => {
        const { data } = await supabase.from("voter_turnout").select("*");
        if (isMounted && data) setTurnoutData(data);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "live_results" }, async () => {
        const { data } = await supabase.from("live_results").select("*");
        if (isMounted && data) setLiveResults(data);
      })
      .subscribe();

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