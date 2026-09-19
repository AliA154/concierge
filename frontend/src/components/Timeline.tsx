import type { Meta, TicketEvent } from "../api/types";
import { useNow } from "../hooks/useNow";
import { fmtRelative } from "../lib/format";
import { agentByName } from "./Avatar";

function dotColor(ev: TicketEvent, meta: Meta): string {
  switch (ev.event_type) {
    case "created": return "var(--accent)";
    case "work_note": return "var(--text)";
    case "reopened": return "var(--warn)";
    case "assigned": return agentByName(meta.agents, ev.detail.startsWith("Assigned to ") ? ev.detail.slice(12) : null)?.color ?? "var(--muted)";
    default: return "var(--muted)";
  }
}

export function Timeline({ events, meta, loading }: { events: TicketEvent[]; meta: Meta; loading: boolean }) {
  const nowMs = useNow();
  return (
    <div>
      <div className="timeline-label">Timeline</div>
      {loading ? <p className="empty-sub">Loading timeline…</p> : (
        <div className="timeline">
          {events.map((ev) => (
            <div key={ev.id} className={`tl-item ${ev.pending ? "pending" : ""}`}>
              <span className="tl-dot" style={{ background: dotColor(ev, meta) }} />
              <div className="tl-head"><span className="tl-actor">{ev.actor}</span><span className="tl-time num">{fmtRelative(ev.created_at, nowMs)}</span></div>
              <div className="tl-detail">{ev.detail}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
