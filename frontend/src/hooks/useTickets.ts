import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { CreateTicketBody, Meta, Priority, State, Ticket, TicketsResponse } from "../api/types";
import { emptyStore, replaceAll, type Store } from "../lib/store";
import type { ToastFn } from "../components/Toasts";

export const POLL_MS = 15000;

export interface UseTicketsOptions {
  actingAgent: string;
  priorities: readonly Priority[];
  agentNames: readonly string[];
  transitions: Meta["transitions"] | null;
  toast: ToastFn;
}

export interface TicketActions {
  store: Store;
  refresh: () => Promise<void>;
  createTicket: (body: CreateTicketBody) => Promise<Ticket>;
  changeState: (id: number, next: State) => Promise<void>;
  assignTicket: (id: number, name: string | null) => Promise<void>;
  reopenTicket: (id: number) => Promise<Ticket | null>;
  resetDemo: () => Promise<string>;
}

export function useTickets(opts: UseTicketsOptions): TicketActions {
  const [store, setStore] = useState<Store>(emptyStore);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const refresh = useCallback(async () => {
    try {
      const res = await api<TicketsResponse>("/api/tickets");
      setStore((s) => replaceAll(s, res));
    } catch {
      setStore((s) => ({ ...s, offline: true })); // keep last known state on screen
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const notImplemented = async (): Promise<never> => { throw new Error("not implemented"); };

  return { store, refresh, createTicket: notImplemented, changeState: notImplemented, assignTicket: notImplemented, reopenTicket: notImplemented, resetDemo: notImplemented };
}
