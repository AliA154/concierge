import type { Metrics, Priority, State, Ticket, TicketsResponse } from "../api/types";
import { compareKeys, isOpen, queueSortKey } from "./sla";

export interface Store {
  tickets: ReadonlyMap<number, Ticket>;
  queueIds: number[];
  resolvedIds: number[];
  metrics: Metrics | null;
  loaded: boolean;
  offline: boolean;
  clockOffsetMs: number;
}

export function emptyStore(): Store {
  return { tickets: new Map(), queueIds: [], resolvedIds: [], metrics: null, loaded: false, offline: false, clockOffsetMs: 0 };
}

export function replaceAll(store: Store, res: TicketsResponse): Store {
  const tickets = new Map<number, Ticket>();
  for (const t of [...res.queue, ...res.resolved]) tickets.set(t.id, t);
  return {
    ...store,
    tickets,
    queueIds: res.queue.map((t) => t.id),
    resolvedIds: res.resolved.map((t) => t.id),
    metrics: res.metrics,
    loaded: true,
    offline: false,
    clockOffsetMs: Date.parse(res.now) - Date.now(),
  };
}

// Put a ticket in the right membership list after a local mutation. Open
// tickets slot by sort key until the next poll restores server order.
export function applyTicket(store: Store, t: Ticket, priorities: readonly Priority[]): Store {
  const tickets = new Map(store.tickets);
  tickets.set(t.id, t);
  const queueIds = store.queueIds.filter((id) => id !== t.id);
  const resolvedIds = store.resolvedIds.filter((id) => id !== t.id);
  if (isOpen(t)) {
    const key = queueSortKey(t, priorities);
    const idx = queueIds.findIndex((id) => {
      const other = tickets.get(id);
      return other !== undefined && compareKeys(key, queueSortKey(other, priorities)) < 0;
    });
    if (idx === -1) queueIds.push(t.id);
    else queueIds.splice(idx, 0, t.id);
  } else {
    resolvedIds.unshift(t.id);
  }
  return { ...store, tickets, queueIds, resolvedIds };
}

// Local mirror of the backend transition side effects so the UI is truthful
// in the gap before the PATCH response reconciles it.
export function applyLocalTransition(t: Ticket, next: State, nowMs: number, actingAgent: string, agentNames: readonly string[]): Ticket {
  const iso = new Date(nowMs).toISOString();
  let out: Ticket = { ...t };
  if (out.on_hold_since) {
    out = { ...out, held_minutes: out.held_minutes + (nowMs - Date.parse(out.on_hold_since)) / 60000, on_hold_since: null };
  }
  if (next === "On Hold") out = { ...out, on_hold_since: iso };
  if (next === "Resolved") {
    const elapsed = (nowMs - Date.parse(out.created_at)) / 60000 - out.held_minutes;
    const met = out.sla_met === null ? elapsed <= out.sla_target_min : out.sla_met;
    out = { ...out, resolved_at: iso, sla_elapsed_min: Math.round(elapsed * 10) / 10, sla_remaining_min: null, sla_met: met, sla_status: met ? "met" : "missed" };
  }
  if (next === "Closed") out = { ...out, closed_at: iso };
  if (next === "In Progress" && !out.assigned_to && agentNames.includes(actingAgent)) {
    out = { ...out, assigned_to: actingAgent };
  }
  return { ...out, state: next };
}
