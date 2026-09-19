import type { Priority, SlaStatus, State, Ticket } from "../api/types";

export const OPEN_STATES: readonly State[] = ["New", "In Progress", "On Hold"];
export const isOpen = (t: Ticket): boolean => OPEN_STATES.includes(t.state);

export interface LiveSla { elapsedMin: number; remainingMin: number | null; status: SlaStatus; }

// Client-side mirror of the backend ramp, evaluated every second so clocks
// never freeze between polls. Breach is sticky even On Hold.
export function liveSla(t: Ticket, nowMs: number): LiveSla {
  if (!isOpen(t)) return { elapsedMin: t.sla_elapsed_min, remainingMin: null, status: t.sla_status };
  let elapsedMin = (nowMs - Date.parse(t.created_at)) / 60000 - t.held_minutes;
  if (t.on_hold_since) elapsedMin -= (nowMs - Date.parse(t.on_hold_since)) / 60000;
  const remainingMin = t.sla_target_min - elapsedMin;
  let status: SlaStatus;
  if (elapsedMin > t.sla_target_min) status = "breached";
  else if (t.state === "On Hold") status = "paused";
  else if (elapsedMin / t.sla_target_min >= 0.75) status = "at_risk";
  else status = "ok";
  return { elapsedMin, remainingMin, status };
}

export type SortKey = [number, number, string];

export function queueSortKey(t: Ticket, priorities: readonly Priority[]): SortKey {
  const rank = priorities.indexOf(t.priority);
  return [t.is_vip ? 0 : 1, rank === -1 ? 99 : rank, t.created_at];
}

export function compareKeys(a: SortKey, b: SortKey): number {
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

export const QUICK_ACTION: Partial<Record<State, { label: string; state: State }>> = {
  New: { label: "Start", state: "In Progress" },
  "In Progress": { label: "Resolve", state: "Resolved" },
  "On Hold": { label: "Resume", state: "In Progress" },
};
