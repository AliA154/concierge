import { useCallback, useEffect, useState } from "react";
import type { Meta } from "../api/types";

export const AGENT_STORAGE_KEY = "concierge.actingAgent";

function stored(): string {
  try { return localStorage.getItem(AGENT_STORAGE_KEY) ?? ""; } catch { return ""; }
}

export function useActingAgent(meta: Meta | null): [string, (name: string) => void] {
  const [name, setName] = useState(stored);
  useEffect(() => {
    if (!meta) return;
    const known = meta.agents.some((a) => a.name === name);
    if (!known) setName(meta.agents[0]?.name ?? "");
  }, [meta, name]);
  const set = useCallback((next: string) => {
    setName(next);
    try { localStorage.setItem(AGENT_STORAGE_KEY, next); } catch { /* private mode */ }
  }, []);
  return [name, set];
}
