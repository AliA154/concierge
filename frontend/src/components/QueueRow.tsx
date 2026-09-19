import { memo } from "react";
import type { MouseEvent, ReactNode } from "react";
import type { Meta, State, Ticket } from "../api/types";
import { useNow } from "../hooks/useNow";
import { fmtAge } from "../lib/format";
import { QUICK_ACTION } from "../lib/sla";
import { Avatar, agentByName } from "./Avatar";
import { SlaInstrument, slaRowClass } from "./SlaInstrument";

interface Props {
  ticket: Ticket; meta: Meta; selected: boolean;
  onSelect: (id: number) => void; onOpen: (id: number) => void;
  onTake: (id: number) => void; onQuickState: (id: number, next: State) => void;
}

function Age({ iso }: { iso: string }) {
  const nowMs = useNow();
  return <span className="cell age num">{fmtAge(iso, nowMs)}</span>;
}

function RowClass({ ticket, children, selected }: { ticket: Ticket; selected: boolean; children: ReactNode }) {
  const nowMs = useNow();
  const cls = ["row", ticket.is_vip ? "is-vip" : "", !ticket.is_vip && ticket.priority === "Critical" ? "is-crit" : "", selected ? "selected" : "", slaRowClass(ticket, nowMs)].filter(Boolean).join(" ");
  return <div className={cls} data-id={ticket.id} data-testid="queue-row">{children}</div>;
}

export const QueueRow = memo(function QueueRow({ ticket: t, meta, selected, onSelect, onOpen, onTake, onQuickState }: Props) {
  const quick = QUICK_ACTION[t.state];
  const glyphTitle = `${t.priority} — Impact ${t.impact} / Urgency ${t.urgency}`;
  const stop = (e: MouseEvent) => e.stopPropagation();
  return (
    <div onClick={() => { onSelect(t.id); onOpen(t.id); }}>
      <RowClass ticket={t} selected={selected}>
        <span className="cell number num">{t.number}</span>
        <span className="cell glyph"><i className={`pglyph p-${t.priority.toLowerCase()}`} title={glyphTitle} /></span>
        <span className="cell subject">
          <span className="subject-text" title={t.subject}>{t.subject}</span>
          <span className="requester">{t.requester}</span>
          {t.reopened_count > 0 && <span className="tag-reopened">Reopened ×{t.reopened_count}</span>}
          <span className="row-actions">
            {!t.assigned_to && <button type="button" className="ghost" onClick={(e) => { stop(e); onTake(t.id); }}>Take</button>}
            {quick && <button type="button" className="ghost" onClick={(e) => { stop(e); onQuickState(t.id, quick.state); }}>{quick.label}</button>}
          </span>
        </span>
        <span className="cell"><span className="type-tag">{t.ticket_type}</span></span>
        <span className="cell assignee"><Avatar agent={agentByName(meta.agents, t.assigned_to)} /></span>
        <span className="cell vip">{t.is_vip && <span className="vip-star" title="VIP — SLA target halved">&#9733;</span>}</span>
        <Age iso={t.created_at} />
        <SlaInstrument ticket={t} />
      </RowClass>
    </div>
  );
});
