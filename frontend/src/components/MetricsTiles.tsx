import type { Metrics } from "../api/types";
import { Tile } from "./Tile";

const DONUT_R = 10;
const DONUT_C = 2 * Math.PI * DONUT_R;
const int = (v: number) => String(Math.round(v));

export function MetricsTiles({ metrics: m }: { metrics: Metrics }) {
  const donutColor = m.sla_met_pct >= 90 ? "var(--ok)" : m.sla_met_pct >= 75 ? "var(--warn)" : "var(--crit)";
  return (
    <section className="metrics" aria-label="Desk metrics">
      <Tile name="open" label="Open" value={m.open} format={int} context={`${m.vip_open} VIP`} />
      <Tile name="unassigned" label="Unassigned" value={m.unassigned} format={int} context={`of ${m.open} open`} className={m.unassigned > 0 ? "warn" : ""} />
      <Tile name="at_risk" label="At risk" value={m.at_risk} format={int} context="≥75% SLA used" className={m.at_risk > 0 ? "warn" : ""} />
      <Tile name="breaching" label="Breaching" value={m.breaching} format={int} context={m.breaching > 0 ? "needs eyes now" : "none breaching"} className={m.breaching > 0 ? "alert" : ""} extra={<span className="pulse-dot" hidden={m.breaching === 0} />} />
      <Tile name="sla_met" label="SLA met" value={m.sla_met_pct} format={(v) => `${Math.round(v)}%`} context="target ≥ 90%" extra={
        <svg className="donut" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
          <circle className="donut-bg" cx="12" cy="12" r={DONUT_R} />
          <circle className="donut-fg" cx="12" cy="12" r={DONUT_R} strokeDasharray={`${(m.sla_met_pct / 100) * DONUT_C} ${DONUT_C}`} style={{ stroke: donutColor }} />
        </svg>} />
      <Tile name="mttr" label="MTTR" value={m.mttr_min} format={(v) => `${v.toFixed(1)}m`} context={`${m.resolved} resolved`} />
    </section>
  );
}
