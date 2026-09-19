import type { Ticket } from "../api/types";
import { useNow } from "../hooks/useNow";
import { clamp01, fmtClock } from "../lib/format";
import { isOpen, liveSla } from "../lib/sla";

const RING_R = 42;
const RING_C = 2 * Math.PI * RING_R;

export function SlaRing({ ticket: t }: { ticket: Ticket }) {
  const nowMs = useNow();
  const sla = liveSla(t, nowMs);
  const heldNow = t.held_minutes + (t.on_hold_since ? (nowMs - Date.parse(t.on_hold_since)) / 60000 : 0);
  let frac: number; let cls: string; let value: string; let sub: string;
  if (!isOpen(t)) { frac = 1; cls = sla.status === "met" ? "ring-ok" : "ring-crit"; value = `${Math.round(sla.elapsedMin)}m`; sub = sla.status === "met" ? "met" : "missed"; }
  else if (sla.status === "breached") { frac = 1; cls = "ring-crit"; value = `+${fmtClock(-(sla.remainingMin ?? 0))}`; sub = "breached"; }
  else if (sla.status === "paused") { frac = (sla.remainingMin ?? 0) / t.sla_target_min; cls = "ring-muted"; value = fmtClock(sla.remainingMin ?? 0); sub = "paused"; }
  else { frac = (sla.remainingMin ?? 0) / t.sla_target_min; cls = sla.status === "at_risk" ? "ring-warn" : "ring-ok"; value = fmtClock(sla.remainingMin ?? 0); sub = "remaining"; }
  return (
    <div className="drawer-sla-inner">
      <div className={`ring-wrap ${cls}`}>
        <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true">
          <circle className="ring-bg" cx="48" cy="48" r={RING_R} />
          <circle className="ring-fg" cx="48" cy="48" r={RING_R} strokeDasharray={`${clamp01(frac) * RING_C} ${RING_C}`} />
        </svg>
        <div className="ring-center"><span className="ring-value num">{value}</span><span className="ring-sub">{sub}</span></div>
      </div>
      <div className="sla-facts">
        <div><span className="k">Target</span><span className="num">{t.sla_target_min}m</span>{t.is_vip && <span className="k"> (VIP halved)</span>}</div>
        <div><span className="k">Elapsed</span><span className="num">{Math.max(0, Math.round(sla.elapsedMin))}m</span></div>
        {heldNow > 0.5 && <div><span className="k">Held</span><span className="num">{Math.round(heldNow)}m</span></div>}
      </div>
    </div>
  );
}
