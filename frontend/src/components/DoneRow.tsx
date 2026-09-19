import type { Meta, Ticket } from "../api/types";
import { useNow } from "../hooks/useNow";
import { fmtAge } from "../lib/format";
import { Avatar, agentByName } from "./Avatar";

const Lock = () => (
  <svg className="lock" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
    <rect x="2" y="5" width="8" height="6" rx="1" fill="currentColor" />
    <path d="M4 5V3.5a2 2 0 0 1 4 0V5" fill="none" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

export function DoneRow({ ticket: t, meta, onOpen }: { ticket: Ticket; meta: Meta; onOpen: (id: number) => void }) {
  const nowMs = useNow();
  const mins = Math.round(t.sla_elapsed_min);
  const lock = t.state === "Closed" ? <Lock /> : null;
  return (
    <div className={`row done ${t.is_vip ? "is-vip" : ""}`} data-id={t.id} onClick={() => onOpen(t.id)}>
      <span className="cell number num">{t.number}</span>
      <span className="cell glyph"><i className={`pglyph p-${t.priority.toLowerCase()}`} title={t.priority} /></span>
      <span className="cell subject">
        <span className="subject-text" title={t.subject}>{t.subject}</span>
        <span className="requester">{t.requester}</span>
        {t.reopened_count > 0 && <span className="tag-reopened">Reopened ×{t.reopened_count}</span>}
      </span>
      <span className="cell"><span className="type-tag">{t.ticket_type}</span></span>
      <span className="cell assignee"><Avatar agent={agentByName(meta.agents, t.assigned_to)} /></span>
      <span className="cell vip">{t.is_vip && <span className="vip-star">&#9733;</span>}</span>
      <span className="cell age num">{fmtAge(t.created_at, nowMs)}</span>
      <span className="cell sla">
        {t.sla_status === "met"
          ? <span className="outcome met">{lock}Met in {mins}m</span>
          : <span className="outcome missed">{lock}Missed · {mins}m</span>}
      </span>
    </div>
  );
}
