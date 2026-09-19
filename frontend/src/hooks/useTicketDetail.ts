import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { Ticket, TicketDetailResponse, TicketEvent } from "../api/types";
import type { Store } from "../lib/store";
import type { ToastFn } from "../components/Toasts";

export function useTicketDetail(id: number | null, store: Store, actingAgent: string, toast: ToastFn) {
  const [events, setEvents] = useState<TicketEvent[]>([]);
  const [fetched, setFetched] = useState<Ticket | null>(null);
  // Tracks the ticket currently shown so an in-flight response for a ticket
  // the drawer has since moved away from cannot clobber the new one's state.
  const idRef = useRef(id);
  idRef.current = id;

  const refresh = useCallback(async () => {
    if (id === null) return;
    try {
      const data = await api<TicketDetailResponse>(`/api/tickets/${id}`);
      if (idRef.current !== id) return; // stale: drawer has moved on to another ticket
      setFetched(data.ticket);
      setEvents(data.events);
    } catch (err) {
      if (idRef.current !== id) return;
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
    const noteId = id; // capture: the drawer may switch tickets before this resolves
    const temp: TicketEvent = { id: `pending-${Date.now()}`, actor: actingAgent || "System", event_type: "work_note", detail: text, created_at: new Date().toISOString(), pending: true };
    setEvents((list) => [temp, ...list]);
    try {
      const saved = await api<TicketEvent>(`/api/tickets/${noteId}/notes`, { method: "POST", body: { note: text }, agent: actingAgent });
      if (idRef.current === noteId) setEvents((list) => list.map((ev) => (ev === temp ? saved : ev)));
      return true;
    } catch (err) {
      if (idRef.current === noteId) setEvents((list) => list.filter((ev) => ev !== temp));
      toast(err instanceof Error ? err.message : "Request failed", { type: "error" });
      return false;
    }
  }, [id, actingAgent, toast]);

  return { ticket, events, refresh, addNote };
}
