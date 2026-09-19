import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../test/handlers";
import { meta } from "../test/fixtures";
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
