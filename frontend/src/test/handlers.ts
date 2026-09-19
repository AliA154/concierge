import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { events, makeTicket, meta, metrics, NOW_ISO } from "./fixtures";

export const queueFixture = [
  makeTicket({ id: 2, number: "INC-1002", subject: "CEO laptop", requester: "Sam V", is_vip: true, priority: "High", sla_target_min: 30, created_at: "2026-09-18T11:50:00+00:00" }),
  makeTicket({ id: 1 }),
  makeTicket({ id: 3, number: "REQ-1003", subject: "Monitor request", ticket_type: "Request", state: "On Hold", on_hold_since: "2026-09-18T11:55:00+00:00", assigned_to: "Marcus Bell" }),
];
export const resolvedFixture = [makeTicket({ id: 4, number: "INC-0999", subject: "Printer jam", state: "Resolved", sla_status: "met", sla_elapsed_min: 22, sla_met: true, resolved_at: "2026-09-18T10:00:00+00:00" })];

export const handlers = [
  http.get("/api/meta", () => HttpResponse.json(meta)),
  http.get("/api/tickets", () => HttpResponse.json({ now: NOW_ISO, queue: queueFixture, resolved: resolvedFixture, metrics })),
  http.get("/api/tickets/:id", ({ params }) => {
    const id = Number(params["id"]);
    const t = [...queueFixture, ...resolvedFixture].find((x) => x.id === id);
    return t ? HttpResponse.json({ now: NOW_ISO, ticket: t, events }) : HttpResponse.json({ error: { code: 404, message: "not found" } }, { status: 404 });
  }),
];

export const server = setupServer(...handlers);
