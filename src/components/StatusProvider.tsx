"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { StatusResponse } from "@/lib/types";

interface StatusState {
  status: StatusResponse | null;
  ticks: number;
  refresh: () => void;
}

const Ctx = createContext<StatusState>({ status: null, ticks: 0, refresh: () => {} });
export const POLL_MS = 4000;

/** Polls /api/status every 4s (the Mission Control heartbeat) and shares it app-wide. */
export function StatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [ticks, setTicks] = useState(0);
  const inflight = useRef(false);

  const refresh = async () => {
    if (inflight.current || document.hidden) return;
    inflight.current = true;
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      if (res.ok) {
        setStatus(await res.json());
        setTicks((t) => t + 1);
      }
    } catch {
      /* server restarting */
    } finally {
      inflight.current = false;
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, []);

  return <Ctx.Provider value={{ status, ticks, refresh }}>{children}</Ctx.Provider>;
}

export function useStatus() {
  return useContext(Ctx);
}
