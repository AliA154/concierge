import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server, queueFixture } from "../test/handlers";
import { makeTicket, meta } from "../test/fixtures";
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
  server.use(http.patch("/api/tickets/1", async ({ request }) => {
    const body = (await request.json()) as { state: string };
    return HttpResponse.json({ ...queueFixture[1]!, state: body.state, assigned_to: "Priya Natarajan" });
  }));
  const { result } = renderHook(() => useTickets(opts));
  await waitFor(() => expect(result.current.store.loaded).toBe(true));
  await act(() => result.current.changeState(1, "In Progress"));
  expect(result.current.store.tickets.get(1)?.state).toBe("In Progress");
  expect(result.current.store.tickets.get(1)?.assigned_to).toBe("Priya Natarajan");
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

test("illegal transitions send nothing", async () => {
  let called = false;
  server.use(http.patch("/api/tickets/2", () => { called = true; return HttpResponse.json({}); }));
  const { result } = renderHook(() => useTickets(opts));
  await waitFor(() => expect(result.current.store.loaded).toBe(true));
  await act(() => result.current.changeState(4, "In Progress")); // Resolved -> In Progress is illegal
  expect(called).toBe(false);
});

test("createTicket inserts in sort position and resetDemo returns the message", async () => {
  server.use(
    http.post("/api/tickets", () => HttpResponse.json(makeTicket({ id: 9, number: "INC-1009", is_vip: true, priority: "Critical" }), { status: 201 })),
    http.post("/api/demo/reset", () => HttpResponse.json({ ok: true, message: "Demo data reset" })),
  );
  const { result } = renderHook(() => useTickets(opts));
  await waitFor(() => expect(result.current.store.loaded).toBe(true));
  await act(async () => { await result.current.createTicket({ subject: "x", requester: "y", ticket_type: "Incident", impact: "High", urgency: "High", is_vip: true }); });
  expect(result.current.store.queueIds[0]).toBe(9);
  await expect(act(() => result.current.resetDemo())).resolves.toBe("Demo data reset");
});
