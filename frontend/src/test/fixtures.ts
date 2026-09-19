import type { Meta, Metrics, Ticket, TicketEvent } from "../api/types";

export const NOW_ISO = "2026-09-18T12:00:00+00:00";
export const NOW_MS = Date.parse(NOW_ISO);

export const meta: Meta = {
  types: ["Incident", "Request", "Problem", "Change"],
  states: ["New", "In Progress", "On Hold", "Resolved", "Closed"],
  priorities: ["Critical", "High", "Medium", "Low"],
  impacts: ["High", "Medium", "Low"],
  urgencies: ["High", "Medium", "Low"],
  priority_matrix: {
    "High|High": "Critical", "High|Medium": "High", "High|Low": "Medium",
    "Medium|High": "High", "Medium|Medium": "Medium", "Medium|Low": "Low",
    "Low|High": "Medium", "Low|Medium": "Low", "Low|Low": "Low",
  },
  sla_targets: { Critical: 30, High: 60, Medium: 240, Low: 480 },
  transitions: {
    New: ["In Progress", "On Hold", "Resolved"],
    "In Progress": ["On Hold", "Resolved"],
    "On Hold": ["In Progress", "Resolved"],
    Resolved: ["Closed"],
    Closed: [],
  },
  agents: [
    { name: "Priya Natarajan", initials: "PN", color: "#7c5cff" },
    { name: "Marcus Bell", initials: "MB", color: "#2fbf71" },
  ],
};

export function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 1, number: "INC-1001", subject: "VPN down", requester: "Dana K", ticket_type: "Incident",
    impact: "Medium", urgency: "Medium", priority: "Medium", state: "New", is_vip: false,
    assigned_to: null, created_at: "2026-09-18T11:00:00+00:00", resolved_at: null, closed_at: null,
    on_hold_since: null, held_minutes: 0, reopened_count: 0, sla_target_min: 240, sla_elapsed_min: 60,
    sla_remaining_min: 180, sla_status: "ok", sla_met: null, ...overrides,
  };
}

export const metrics: Metrics = { open: 3, vip_open: 1, unassigned: 2, at_risk: 1, breaching: 0, sla_met_pct: 92, mttr_min: 41.5, resolved: 4, reopened: 1 };

export const events: TicketEvent[] = [
  { id: 2, actor: "Priya Natarajan", event_type: "work_note", detail: "Checked the tunnel", created_at: "2026-09-18T11:30:00+00:00" },
  { id: 1, actor: "System", event_type: "created", detail: "Ticket created — Medium Incident", created_at: "2026-09-18T11:00:00+00:00" },
];
