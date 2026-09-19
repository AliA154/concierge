import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { CreateTicketBody, Meta, Priority, State, Ticket, TicketsResponse } from "../api/types";
import { applyLocalTransition, applyTicket, emptyStore, replaceAll, type Store } from "../lib/store";
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

  const withRevert = useCallback(async (snap: Store, run: () => Promise<void>) => {
    try {
      await run();
    } catch (err) {
      setStore(snap);
      optsRef.current.toast(err instanceof Error ? err.message : "Request failed", { type: "error" });
    }
  }, []);

  const reconcile = useCallback((t: Ticket) => {
    setStore((s) => applyTicket(s, t, optsRef.current.priorities));
    void refresh();
  }, [refresh]);

  const reopenTicket = useCallback(async (id: number): Promise<Ticket | null> => {
    try {
      const updated = await api<Ticket>(`/api/tickets/${id}/reopen`, { method: "POST", agent: optsRef.current.actingAgent });
      reconcile(updated);
      optsRef.current.toast(`${updated.number} reopened`, { type: "ok" });
      return updated;
    } catch (err) {
      optsRef.current.toast(err instanceof Error ? err.message : "Request failed", { type: "error" });
      return null;
    }
  }, [reconcile]);

  const changeState = useCallback(async (id: number, next: State) => {
    const { transitions, actingAgent, agentNames, priorities, toast } = optsRef.current;
    const t = store.tickets.get(id);
    if (!t || !transitions || !(transitions[t.state] ?? []).includes(next)) return;
    const snap = store;
    const nowMs = Date.now() + store.clockOffsetMs;
    const local = applyLocalTransition(t, next, nowMs, actingAgent, agentNames);
    setStore((s) => applyTicket(s, local, priorities));
    const undo = next === "Resolved"
      ? toast(`${t.number} resolved`, { type: "ok", action: "Undo", onAction: () => void reopenTicket(id), duration: 6000 })
      : null;
    await withRevert(snap, async () => {
      try {
        reconcile(await api<Ticket>(`/api/tickets/${id}`, { method: "PATCH", body: { state: next }, agent: actingAgent }));
      } catch (err) {
        undo?.dismiss();
        throw err;
      }
    });
  }, [store, withRevert, reconcile, reopenTicket]);

  const assignTicket = useCallback(async (id: number, name: string | null) => {
    const t = store.tickets.get(id);
    if (!t || t.assigned_to === name) return;
    const snap = store;
    setStore((s) => applyTicket(s, { ...t, assigned_to: name }, optsRef.current.priorities));
    await withRevert(snap, async () => {
      reconcile(await api<Ticket>(`/api/tickets/${id}`, { method: "PATCH", body: { assigned_to: name }, agent: optsRef.current.actingAgent }));
    });
  }, [store, withRevert, reconcile]);

  const createTicket = useCallback(async (body: CreateTicketBody): Promise<Ticket> => {
    const created = await api<Ticket>("/api/tickets", { method: "POST", body, agent: optsRef.current.actingAgent });
    reconcile(created);
    return created;
  }, [reconcile]);

  const resetDemo = useCallback(async (): Promise<string> => {
    const res = await api<{ ok: boolean; message: string }>("/api/demo/reset", { method: "POST", agent: optsRef.current.actingAgent });
    await refresh();
    return res.message;
  }, [refresh]);

  return { store, refresh, createTicket, changeState, assignTicket, reopenTicket, resetDemo };
}
