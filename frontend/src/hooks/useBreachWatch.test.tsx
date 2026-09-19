import { renderHook } from "@testing-library/react";
import { emptyStore, replaceAll } from "../lib/store";
import { makeTicket, metrics, NOW_ISO } from "../test/fixtures";
import { useBreachWatch } from "./useBreachWatch";

test("toasts once when a ticket crosses into breach and updates the title", () => {
  const toast = vi.fn().mockReturnValue({ dismiss: vi.fn() });
  const ok = makeTicket({ id: 1, created_at: new Date(Date.now() - 10 * 60000).toISOString(), sla_target_min: 60 });
  let store = replaceAll(emptyStore(), { now: NOW_ISO, queue: [ok], resolved: [], metrics });
  store = { ...store, clockOffsetMs: 0 };
  const { rerender } = renderHook(({ s }) => useBreachWatch(s, toast), { initialProps: { s: store } });
  expect(toast).not.toHaveBeenCalled();
  const breached = { ...ok, created_at: new Date(Date.now() - 90 * 60000).toISOString() };
  const next = replaceAll(store, { now: new Date().toISOString(), queue: [breached], resolved: [], metrics });
  rerender({ s: next });
  rerender({ s: next });
  expect(toast).toHaveBeenCalledTimes(1);
  expect(toast).toHaveBeenCalledWith("INC-1001 breached SLA", { type: "crit", duration: 6000 });
  expect(document.title).toBe("(1⚠) Concierge");
});
