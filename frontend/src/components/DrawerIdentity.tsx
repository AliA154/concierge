import type { Meta, Ticket } from "../api/types";
import { Avatar, agentByName } from "./Avatar";

export function DrawerIdentity({ ticket: t, meta, onAssign }: { ticket: Ticket; meta: Meta; onAssign: (name: string | null) => void }) {
  const pCode = `P${Math.max(0, meta.priorities.indexOf(t.priority)) + 1}`;
  return (
    <div className="identity">
      <div className="identity-row">
        <span className="requester-name">{t.requester}</span>
        {t.is_vip && <span className="chip vip-chip">&#9733; VIP</span>}
        <span className="type-tag">{t.ticket_type}</span>
        <span className="chip">{t.state}</span>
        {t.reopened_count > 0 && <span className="tag-reopened">Reopened ×{t.reopened_count}</span>}
      </div>
      <div className="identity-line"><span className="pcode">{pCode}</span> · {t.priority} — Impact {t.impact} / Urgency {t.urgency}</div>
      <div className="identity-assign">
        <span className="label">Assignee</span>
        <Avatar agent={agentByName(meta.agents, t.assigned_to)} />
        <select aria-label="Assignee" value={t.assigned_to ?? ""} onChange={(e) => onAssign(e.target.value || null)}>
          <option value="">Unassigned</option>
          {meta.agents.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
        </select>
      </div>
    </div>
  );
}
