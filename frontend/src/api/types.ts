export type TicketType = "Incident" | "Request" | "Problem" | "Change";
export type State = "New" | "In Progress" | "On Hold" | "Resolved" | "Closed";
export type Priority = "Critical" | "High" | "Medium" | "Low";
export type Level = "High" | "Medium" | "Low";
export type SlaStatus = "ok" | "at_risk" | "breached" | "paused" | "met" | "missed";

export interface Agent {
  name: string;
  initials: string;
  color: string;
}

export interface Meta {
  types: TicketType[];
  states: State[];
  priorities: Priority[];
  impacts: Level[];
  urgencies: Level[];
  priority_matrix: Record<string, Priority>;
  sla_targets: Record<Priority, number>;
  transitions: Record<State, State[]>;
  agents: Agent[];
}

export interface Ticket {
  id: number;
  number: string;
  subject: string;
  requester: string;
  ticket_type: TicketType;
  impact: Level;
  urgency: Level;
  priority: Priority;
  state: State;
  is_vip: boolean;
  assigned_to: string | null;
  created_at: string;
  resolved_at: string | null;
  closed_at: string | null;
  on_hold_since: string | null;
  held_minutes: number;
  reopened_count: number;
  sla_target_min: number;
  sla_elapsed_min: number;
  sla_remaining_min: number | null;
  sla_status: SlaStatus;
  sla_met: boolean | null;
}

export type EventType = "created" | "state_change" | "assigned" | "work_note" | "reopened";

export interface TicketEvent {
  id: number | string;
  actor: string;
  event_type: EventType;
  detail: string;
  created_at: string;
  pending?: boolean;
}

export interface Metrics {
  open: number;
  vip_open: number;
  unassigned: number;
  at_risk: number;
  breaching: number;
  sla_met_pct: number;
  mttr_min: number;
  resolved: number;
  reopened: number;
}

export interface TicketsResponse {
  now: string;
  queue: Ticket[];
  resolved: Ticket[];
  metrics: Metrics;
}

export interface TicketDetailResponse {
  now: string;
  ticket: Ticket;
  events: TicketEvent[];
}

export interface ApiErrorBody {
  error: {
    code: number;
    message: string;
  };
}

export interface CreateTicketBody {
  subject: string;
  requester: string;
  ticket_type: TicketType;
  impact: Level;
  urgency: Level;
  is_vip: boolean;
}
