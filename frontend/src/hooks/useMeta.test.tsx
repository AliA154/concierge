import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../test/handlers";
import { meta } from "../test/fixtures";
import { useMeta } from "./useMeta";

test("loads meta", async () => {
  const { result } = renderHook(() => useMeta());
  await waitFor(() => expect(result.current?.agents).toHaveLength(2));
});

test("retries after a failure", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let calls = 0;
  server.use(http.get("/api/meta", () => (++calls === 1 ? HttpResponse.error() : HttpResponse.json(meta))));
  const { result } = renderHook(() => useMeta());
  await act(async () => { await vi.advanceTimersByTimeAsync(3500); });
  await waitFor(() => expect(result.current).not.toBeNull());
  expect(calls).toBe(2);
  vi.useRealTimers();
});
