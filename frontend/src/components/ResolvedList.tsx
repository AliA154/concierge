import type { Meta, Ticket } from "../api/types";
import { DoneRow } from "./DoneRow";

export function ResolvedList({ tickets, total, meta, onOpen }: { tickets: Ticket[]; total: number; meta: Meta; onOpen: (id: number) => void }) {
  if (tickets.length === 0) return null;
  return (
    <div>
      <h2 className="section-label">Resolved <span className="count num">{total}</span></h2>
      <div className="queue resolved-list">{tickets.map((t) => <DoneRow key={t.id} ticket={t} meta={meta} onOpen={onOpen} />)}</div>
    </div>
  );
}
