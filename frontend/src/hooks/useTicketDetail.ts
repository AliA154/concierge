import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { Ticket, TicketDetailResponse, TicketEvent } from "../api/types";
import type { Store } from "../lib/store";
import type { ToastFn } from "../components/Toasts";

export function useTicketDetail(id: number | null, store: Store, actingAgent: string, toast: ToastFn) {
  const [events, setEvents] = useState<TicketEvent[]>([]);
  const [fetched, setFetched] = useState<Ticket | null>(null);

  const refresh = useCallback(async () => {
    if (id === null) return;
    try {
      const data = await api<TicketDetailResponse>(`/api/tickets/${id}`);
      setFetched(data.ticket);
      setEvents(data.events);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Request failed", { type: "error" });
    }
  }, [id, toast]);

  useEffect(() => {
    setEvents([]);
    setFetched(null);
    void refresh();
  }, [refresh]);

  // The store copy is fresher after optimistic mutations; the fetched copy
  // fills the gap before the store has the ticket at all.
  const ticket = (id !== null && store.tickets.get(id)) || fetched;

  const addNote = useCallback(async (text: string): Promise<boolean> => {
    if (id === null) return false;
    const temp: TicketEvent = { id: `pending-${Date.now()}`, actor: actingAgent || "System", event_type: "work_note", detail: text, created_at: new Date().toISOString(), pending: true };
    setEvents((list) => [temp, ...list]);
    try {
      const saved = await api<TicketEvent>(`/api/tickets/${id}/notes`, { method: "POST", body: { note: text }, agent: actingAgent });
      setEvents((list) => list.map((ev) => (ev === temp ? saved : ev)));
      return true;
    } catch (err) {
      setEvents((list) => list.filter((ev) => ev !== temp));
      toast(err instanceof Error ? err.message : "Request failed", { type: "error" });
      return false;
    }
  }, [id, actingAgent, toast]);

  return { ticket, events, refresh, addNote };
}
