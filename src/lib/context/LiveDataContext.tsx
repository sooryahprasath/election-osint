"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase, Constituency, Candidate, Signal } from "@/lib/supabase";

interface LiveDataContextProps {
  constituencies: Constituency[];
  candidates: Candidate[];
  signals: Signal[];
  isConnected: boolean;
}

const LiveDataContext = createContext<LiveDataContextProps>({
  constituencies: [],
  candidates: [],
  signals: [],
  isConnected: false,
});

export const useLiveData = () => useContext(LiveDataContext);

export const LiveDataProvider = ({ children }: { children: React.ReactNode }) => {
  const [constituencies, setConstituencies] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [signals, setSignals] = useState<any[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const initDb = async () => {
      try {
        // Attempt to fetch real data
        const { data: cwData, error: cwErr } = await supabase.from("constituencies").select("*");
        if (cwErr) throw cwErr;

        if (isMounted) {
          setIsConnected(true);
          if (cwData && cwData.length > 0) setConstituencies(cwData);

          const { data: cdData } = await supabase.from("candidates").select("*");
          if (cdData && cdData.length > 0) setCandidates(cdData);

          const { data: sData } = await supabase.from("signals").select("*");
          if (sData && sData.length > 0) setSignals(sData);
        }
      } catch (err) {
        console.error("[LiveDataContext] Supabase connection failed! Data will remain empty.", err);
      }
    };

    initDb();

    // ─── Setup Supabase Realtime Subscriptions ──────────────────────────────
    const channel = supabase.channel("schema-db-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "signals" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setSignals((prev) => [payload.new, ...prev]);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "constituencies" },
        (payload) => {
          setConstituencies((prev) =>
            prev.map((c) => (c.id === payload.new.id ? payload.new : c))
          );
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "candidates" },
        (payload) => {
          setCandidates((prev) =>
            prev.map((c) => (c.id === payload.new.id ? payload.new : c))
          );
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && isMounted && isConnected) {
          console.log("[LiveDataContext] Realtime Linked to Supabase.");
        }
      });

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [isConnected]);

  return (
    <LiveDataContext.Provider value={{ constituencies, candidates, signals, isConnected }}>
      {children}
    </LiveDataContext.Provider>
  );
};
