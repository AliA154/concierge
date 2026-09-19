import type { Ticket } from "../api/types";
import { useNow } from "../hooks/useNow";
import { clamp01, fmtClock } from "../lib/format";
import { liveSla } from "../lib/sla";

// One row's SLA clock + bar. Subscribes to the 1 s tick itself so the row
// around it can stay memoized. On Hold rows keep a frozen instrument.
export function SlaInstrument({ ticket }: { ticket: Ticket }) {
  const nowMs = useNow();
  const sla = liveSla(ticket, nowMs);
  let text: string;
  let width: string;
  if (sla.status === "breached") {
    text = `BREACHED +${fmtClock(-(sla.remainingMin ?? 0))}`;
    width = "100%";
  } else if (sla.status === "paused") {
    text = `Paused · ${Math.round(sla.elapsedMin)}m used of ${ticket.sla_target_min}m`;
    width = `${clamp01((sla.remainingMin ?? 0) / ticket.sla_target_min) * 100}%`;
  } else {
    text = fmtClock(sla.remainingMin ?? 0);
    width = `${clamp01((sla.remainingMin ?? 0) / ticket.sla_target_min) * 100}%`;
  }
  return (
    <span className="cell sla">
      <span className="clock num">{text}</span>
      <span className="bar"><i style={{ width }} /></span>
    </span>
  );
}

export function slaRowClass(ticket: Ticket, nowMs: number): string {
  const s = liveSla(ticket, nowMs).status;
  return s === "breached" ? "sla-breached" : s === "paused" ? "sla-paused" : s === "at_risk" ? "sla-at-risk" : "";
}
