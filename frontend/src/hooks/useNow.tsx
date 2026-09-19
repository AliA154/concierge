import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const NowContext = createContext<number>(Date.now());

export function NowProvider({ offsetMs, children }: { offsetMs: number; children: ReactNode }) {
  const [nowMs, setNowMs] = useState(() => Date.now() + offsetMs);
  useEffect(() => {
    setNowMs(Date.now() + offsetMs);
    const id = setInterval(() => setNowMs(Date.now() + offsetMs), 1000);
    return () => clearInterval(id);
  }, [offsetMs]);
  return <NowContext.Provider value={nowMs}>{children}</NowContext.Provider>;
}

// Server-adjusted wall clock. Every time-derived value in the UI uses this.
export const useNow = (): number => useContext(NowContext);
