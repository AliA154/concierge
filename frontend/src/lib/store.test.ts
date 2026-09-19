import { applyLocalTransition, applyTicket, emptyStore, replaceAll } from "./store";
import { makeTicket, meta, metrics, NOW_ISO, NOW_MS } from "../test/fixtures";

test("replaceAll loads queue and resolved ids in server order and stores the clock offset", () => {
  const a = makeTicket({ id: 1 }); const b = makeTicket({ id: 2, is_vip: true }); const r = makeTicket({ id: 3, state: "Resolved" });
  const s = replaceAll(emptyStore(), { now: NOW_ISO, queue: [b, a], resolved: [r], metrics });
  expect(s.queueIds).toEqual([2, 1]);
  expect(s.resolvedIds).toEqual([3]);
  expect(s.loaded).toBe(true);
  expect(s.offline).toBe(false);
  expect(Math.abs(s.clockOffsetMs - (NOW_MS - Date.now()))).toBeLessThan(2000);
});

test("applyTicket inserts an open ticket in sort position and moves done tickets to resolved", () => {
  const low = makeTicket({ id: 1, priority: "Low" });
  const s0 = replaceAll(emptyStore(), { now: NOW_ISO, queue: [low], resolved: [], metrics });
  const crit = makeTicket({ id: 2, priority: "Critical" });
  const s1 = applyTicket(s0, crit, meta.priorities);
  expect(s1.queueIds).toEqual([2, 1]);
  const s2 = applyTicket(s1, { ...crit, state: "Resolved" }, meta.priorities);
  expect(s2.queueIds).toEqual([1]);
  expect(s2.resolvedIds).toEqual([2]);
  expect(s0.queueIds).toEqual([1]); // immutability
});

test("applyLocalTransition mirrors hold accounting, resolve freeze, and auto-assign", () => {
  const held = makeTicket({ state: "On Hold", on_hold_since: new Date(NOW_MS - 10 * 60000).toISOString(), held_minutes: 5 });
  const resumed = applyLocalTransition(held, "In Progress", NOW_MS, "Priya Natarajan", ["Priya Natarajan"]);
  expect(resumed.held_minutes).toBeCloseTo(15, 3);
  expect(resumed.on_hold_since).toBeNull();
  expect(resumed.assigned_to).toBe("Priya Natarajan");
  const resolved = applyLocalTransition(makeTicket({ created_at: new Date(NOW_MS - 30 * 60000).toISOString(), sla_target_min: 60 }), "Resolved", NOW_MS, "", []);
  expect(resolved.sla_met).toBe(true);
  expect(resolved.sla_status).toBe("met");
  expect(resolved.resolved_at).not.toBeNull();
  expect(held.state).toBe("On Hold"); // input untouched
});
