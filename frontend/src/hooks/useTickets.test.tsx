import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server, queueFixture, resolvedFixture } from "../test/handlers";
import { makeTicket, meta, metrics, NOW_ISO } from "../test/fixtures";
import type { Ticket } from "../api/types";
import { POLL_MS, useTickets } from "./useTickets";

const opts = { actingAgent: "Priya Natarajan", priorities: meta.priorities, agentNames: meta.agents.map((a) => a.name), transitions: meta.transitions, toast: vi.fn() };

afterEach(() => {
  vi.useRealTimers();
});

test("first poll loads the store in server order", async () => {
  const { result } = renderHook(() => useTickets(opts));
  await waitFor(() => expect(result.current.store.loaded).toBe(true));
  expect(result.current.store.queueIds).toEqual([2, 1, 3]);
  expect(result.current.store.resolvedIds).toEqual([4]);
  expect(result.current.store.metrics?.open).toBe(3);
});

test("a failed poll keeps data and flags offline; next success clears it", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { result } = renderHook(() => useTickets(opts));
  await waitFor(() => expect(result.current.store.loaded).toBe(true));
  server.use(http.get("/api/tickets", () => HttpResponse.error(), { once: true }));
  await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS + 50); });
  await waitFor(() => expect(result.current.store.offline).toBe(true));
  expect(result.current.store.queueIds).toEqual([2, 1, 3]);
  await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS + 50); });
  await waitFor(() => expect(result.current.store.offline).toBe(false));
});

test("changeState applies optimistically then reconciles with the server ticket", async () => {
  let current: Ticket[] = queueFixture;
  let mutated = false;
  let getCalls = 0;
  server.use(
    http.patch("/api/tickets/1", async ({ request }) => {
      const body = (await request.json()) as { state: string };
      const updated = { ...queueFixture[1]!, state: body.state, assigned_to: "Priya Natarajan" } as Ticket;
      current = current.map((t) => (t.id === 1 ? updated : t));
      mutated = true;
      return HttpResponse.json(updated);
    }),
    // metrics.open only flips to 99 once the PATCH has run, so a passing
    // assertion on it (and on the call count) proves changeState's
    // post-mutation refresh() actually fired a second GET, not just that
    // reconcile applied the PATCH response synchronously.
    http.get("/api/tickets", () => {
      getCalls += 1;
      return HttpResponse.json({ now: NOW_ISO, queue: current, resolved: resolvedFixture, metrics: { ...metrics, open: mutated ? 99 : metrics.open } });
    }),
  );
  const { result } = renderHook(() => useTickets(opts));
  await waitFor(() => expect(result.current.store.loaded).toBe(true));
  const callsBeforeMutation = getCalls;
  await act(() => result.current.changeState(1, "In Progress"));
  expect(result.current.store.tickets.get(1)?.state).toBe("In Progress");
  expect(result.current.store.tickets.get(1)?.assigned_to).toBe("Priya Natarajan");
  await waitFor(() => expect(getCalls).toBeGreaterThan(callsBeforeMutation));
  await waitFor(() => expect(result.current.store.metrics?.open).toBe(99));
});

test("changeState reverts and toasts on a server error", async () => {
  const toast = vi.fn().mockReturnValue({ dismiss: vi.fn() });
  server.use(http.patch("/api/tickets/1", () => HttpResponse.json({ error: { code: 400, message: "cannot move New → Closed" } }, { status: 400 })));
  const { result } = renderHook(() => useTickets({ ...opts, toast }));
  await waitFor(() => expect(result.current.store.loaded).toBe(true));
  await act(() => result.current.changeState(1, "Resolved"));
  expect(result.current.store.tickets.get(1)?.state).toBe("New");
  expect(result.current.store.queueIds).toEqual([2, 1, 3]);
  expect(toast).toHaveBeenCalledWith("cannot move New → Closed", { type: "error" });
});

test("assignTicket applies optimistically then reconciles with the server ticket", async () => {
  let current: Ticket[] = queueFixture;
  let mutated = false;
  server.use(
    http.patch("/api/tickets/1", async ({ request }) => {
      const body = (await request.json()) as { assigned_to: string | null };
      const updated = { ...queueFixture[1]!, assigned_to: body.assigned_to } as Ticket;
      current = current.map((t) => (t.id === 1 ? updated : t));
      mutated = true;
      return HttpResponse.json(updated);
    }),
    // metrics.open only flips to 99 once the follow-up GET has actually been
    // parsed into state, so waiting on it (not just the PATCH) proves the
    // background refresh() settled before the test ends.
    http.get("/api/tickets", () =>
      HttpResponse.json({ now: NOW_ISO, queue: current, resolved: resolvedFixture, metrics: { ...metrics, open: mutated ? 99 : metrics.open } }),
    ),
  );
  const { result } = renderHook(() => useTickets(opts));
  await waitFor(() => expect(result.current.store.loaded).toBe(true));
  await act(() => result.current.assignTicket(1, "Marcus Bell"));
  expect(result.current.store.tickets.get(1)?.assigned_to).toBe("Marcus Bell");
  await waitFor(() => expect(result.current.store.metrics?.open).toBe(99));
});

test("resolving a ticket toasts an Undo action that reopens it", async () => {
  const toast = vi.fn().mockReturnValue({ dismiss: vi.fn() });
  let current: Ticket[] = queueFixture;
  // metrics.open advances a stage at a time so waiting on it (rather than on
  // the PATCH/POST alone) proves each background refresh() settled into
  // state before the test moves on — otherwise the trailing setState from a
  // still-in-flight refresh fires after unmount.
  let stage: 0 | 1 | 2 = 0;
  server.use(
    http.patch("/api/tickets/1", () => {
      current = current.map((t) => (t.id === 1 ? ({ ...t, state: "Resolved" } as Ticket) : t));
      stage = 1;
      return HttpResponse.json(current.find((t) => t.id === 1));
    }),
    http.post("/api/tickets/1/reopen", () => {
      current = current.map((t) => (t.id === 1 ? ({ ...t, state: "In Progress" } as Ticket) : t));
      stage = 2;
      return HttpResponse.json(current.find((t) => t.id === 1));
    }),
    http.get("/api/tickets", () =>
      HttpResponse.json({ now: NOW_ISO, queue: current, resolved: resolvedFixture, metrics: { ...metrics, open: 90 + stage } }),
    ),
  );
  const { result } = renderHook(() => useTickets({ ...opts, toast }));
  await waitFor(() => expect(result.current.store.loaded).toBe(true));
  await act(() => result.current.changeState(1, "Resolved"));
  expect(result.current.store.tickets.get(1)?.state).toBe("Resolved");
  expect(toast).toHaveBeenCalledWith(
    "INC-1001 resolved",
    expect.objectContaining({ type: "ok", action: "Undo", onAction: expect.any(Function) }),
  );
  await waitFor(() => expect(result.current.store.metrics?.open).toBe(91));
  const undoCall = toast.mock.calls.find(([, opts]) => opts?.action === "Undo");
  await act(async () => { await undoCall![1].onAction(); });
  expect(result.current.store.tickets.get(1)?.state).toBe("In Progress");
  expect(toast).toHaveBeenCalledWith("INC-1001 reopened", { type: "ok" });
  await waitFor(() => expect(result.current.store.metrics?.open).toBe(92));
});

test("illegal transitions send nothing", async () => {
  let called = false;
  server.use(http.patch("/api/tickets/2", () => { called = true; return HttpResponse.json({}); }));
  const { result } = renderHook(() => useTickets(opts));
  await waitFor(() => expect(result.current.store.loaded).toBe(true));
  await act(() => result.current.changeState(4, "In Progress")); // Resolved -> In Progress is illegal
  expect(called).toBe(false);
});

test("createTicket inserts in sort position and resetDemo returns the message", async () => {
  let current: Ticket[] = queueFixture;
  let mutated = false;
  let getCalls = 0;
  server.use(
    http.post("/api/tickets", () => {
      const created = makeTicket({ id: 9, number: "INC-1009", is_vip: true, priority: "Critical" });
      current = [created, ...current];
      mutated = true;
      return HttpResponse.json(created, { status: 201 });
    }),
    // Same rationale as above: metrics.open only flips to 99 once the POST has
    // run, so a passing assertion on it (and on the call count) proves
    // createTicket's post-mutation refresh() fired a second GET.
    http.get("/api/tickets", () => {
      getCalls += 1;
      return HttpResponse.json({ now: NOW_ISO, queue: current, resolved: resolvedFixture, metrics: { ...metrics, open: mutated ? 99 : metrics.open } });
    }),
    http.post("/api/demo/reset", () => HttpResponse.json({ ok: true, message: "Demo data reset" })),
  );
  const { result } = renderHook(() => useTickets(opts));
  await waitFor(() => expect(result.current.store.loaded).toBe(true));
  const callsBeforeMutation = getCalls;
  await act(async () => { await result.current.createTicket({ subject: "x", requester: "y", ticket_type: "Incident", impact: "High", urgency: "High", is_vip: true }); });
  expect(result.current.store.queueIds[0]).toBe(9);
  await waitFor(() => expect(getCalls).toBeGreaterThan(callsBeforeMutation));
  await waitFor(() => expect(result.current.store.metrics?.open).toBe(99));
  await expect(act(() => result.current.resetDemo())).resolves.toBe("Demo data reset");
});

