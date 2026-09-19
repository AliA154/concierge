import { compareKeys, isOpen, liveSla, queueSortKey, QUICK_ACTION } from "./sla";
import { makeTicket, meta, NOW_MS } from "../test/fixtures";

const min = (n: number) => n * 60_000;

test("isOpen", () => {
  expect(isOpen(makeTicket({ state: "On Hold" }))).toBe(true);
  expect(isOpen(makeTicket({ state: "Resolved" }))).toBe(false);
});

test("ok before 75% of target", () => {
  const t = makeTicket({ created_at: new Date(NOW_MS - min(60)).toISOString(), sla_target_min: 240 });
  const s = liveSla(t, NOW_MS);
  expect(s.status).toBe("ok");
  expect(s.remainingMin).toBeCloseTo(180, 5);
});

test("at_risk at exactly 75%", () => {
  const t = makeTicket({ created_at: new Date(NOW_MS - min(180)).toISOString(), sla_target_min: 240 });
  expect(liveSla(t, NOW_MS).status).toBe("at_risk");
});

test("breached past target, even while On Hold", () => {
  const t = makeTicket({ state: "On Hold", created_at: new Date(NOW_MS - min(300)).toISOString(), on_hold_since: new Date(NOW_MS - min(5)).toISOString(), sla_target_min: 240 });
  expect(liveSla(t, NOW_MS).status).toBe("breached");
});

test("paused subtracts held time and the open hold", () => {
  const t = makeTicket({ state: "On Hold", created_at: new Date(NOW_MS - min(100)).toISOString(), held_minutes: 30, on_hold_since: new Date(NOW_MS - min(10)).toISOString(), sla_target_min: 240 });
  const s = liveSla(t, NOW_MS);
  expect(s.status).toBe("paused");
  expect(s.elapsedMin).toBeCloseTo(60, 5);
});

test("done tickets echo server values", () => {
  const t = makeTicket({ state: "Resolved", sla_status: "met", sla_elapsed_min: 42 });
  expect(liveSla(t, NOW_MS)).toEqual({ elapsedMin: 42, remainingMin: null, status: "met" });
});

test("queue sort: VIP first, then priority rank, then created_at", () => {
  const vipLow = makeTicket({ is_vip: true, priority: "Low", created_at: "2026-09-18T11:00:00+00:00" });
  const crit = makeTicket({ priority: "Critical", created_at: "2026-09-18T10:00:00+00:00" });
  expect(compareKeys(queueSortKey(vipLow, meta.priorities), queueSortKey(crit, meta.priorities))).toBeLessThan(0);
  const older = makeTicket({ priority: "High", created_at: "2026-09-18T09:00:00+00:00" });
  const newer = makeTicket({ priority: "High", created_at: "2026-09-18T10:00:00+00:00" });
  expect(compareKeys(queueSortKey(older, meta.priorities), queueSortKey(newer, meta.priorities))).toBeLessThan(0);
});

test("quick actions per state", () => {
  expect(QUICK_ACTION["New"]).toEqual({ label: "Start", state: "In Progress" });
  expect(QUICK_ACTION["Resolved"]).toBeUndefined();
});
