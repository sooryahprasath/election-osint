"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface LiveDataContextProps {
  constituencies: any[];
  candidates: any[];
  signals: any[];
  isConnected: boolean;
  simulatedDate: Date | null;
  setSimulatedDate: (date: Date | null) => void;
  operationMode: string;
  setOperationMode: (mode: string) => void;
}

const LiveDataContext = createContext<LiveDataContextProps>({
  constituencies: [],
  candidates: [],
  signals: [],
  isConnected: false,
  simulatedDate: null,
  setSimulatedDate: () => { },
  operationMode: "PRE-POLL",
  setOperationMode: () => { },
});

export const useLiveData = () => useContext(LiveDataContext);

export const LiveDataProvider = ({ children }: { children: React.ReactNode }) => {
  const [constituencies, setConstituencies] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [signals, setSignals] = useState<any[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [simulatedDate, setSimulatedDate] = useState<Date | null>(null);

  // Default to env, but allow UI override via Dev Menu
  const [operationMode, setOperationMode] = useState<string>(process.env.NEXT_PUBLIC_OPERATION_MODE || "PRE-POLL");

  const fetchAllRows = async (table: string) => {
    let allData: any[] = [];
    let from = 0;
    const step = 1000;
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
    const initDb = async () => {
      try {
        const cwData = await fetchAllRows("constituencies");
        if (isMounted && cwData) {
          setIsConnected(true);
          setConstituencies(cwData);
        }

        const cdData = await fetchAllRows("candidates");
        if (isMounted && cdData) setCandidates(cdData);

        const { data: sData } = await supabase.from("signals").select("*").order("created_at", { ascending: false }).limit(500);
        if (isMounted && sData) setSignals(sData);
      } catch (err) {
        console.error("[LiveDataContext] Supabase connection failed!", err);
      }
    };

    initDb();

    const channel = supabase.channel("schema-db-changes")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "signals" }, (payload) => {
        setSignals((prev) => [payload.new, ...prev]);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "candidates" }, (payload) => {
        setCandidates((prev) => [...prev, payload.new]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "constituencies" }, (payload) => {
        setConstituencies((prev) => prev.map((c) => (c.id === payload.new.id ? payload.new : c)));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "candidates" }, (payload) => {
        setCandidates((prev) => prev.map((c) => (c.id === payload.new.id ? payload.new : c)));
      })
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <LiveDataContext.Provider value={{ constituencies, candidates, signals, isConnected, simulatedDate, setSimulatedDate, operationMode, setOperationMode }}>
      {children}
    </LiveDataContext.Provider>
  );
};