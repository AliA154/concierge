import type { Meta, State, Ticket } from "../api/types";
import { useNow } from "../hooks/useNow";
import { liveSla } from "../lib/sla";
import type { Store } from "../lib/store";
import { QueueClear, NoMatch } from "./EmptyState";
import { QueueRow } from "./QueueRow";
import { QueueToolbar, type FilterCounts, type QueueFilter } from "./QueueToolbar";
import { ResolvedList } from "./ResolvedList";

export type { QueueFilter } from "./QueueToolbar";

interface Props {
  store: Store; meta: Meta; filter: QueueFilter; search: string;
  onFilter: (f: QueueFilter) => void; onSearch: (q: string) => void;
  selectedId: number | null; onSelect: (id: number) => void; onOpen: (id: number) => void;
  onTake: (id: number) => void; onQuickState: (id: number, next: State) => void;
}

const matches = (t: Ticket, q: string) =>
  t.subject.toLowerCase().includes(q) || t.requester.toLowerCase().includes(q) || t.number.toLowerCase().includes(q);

export function visibleQueueIds(store: Store, filter: QueueFilter, search: string, nowMs: number): number[] {
  const q = search.trim().toLowerCase();
  return store.queueIds.filter((id) => {
    const t = store.tickets.get(id);
    if (!t) return false;
    if (filter === "vip" && !t.is_vip) return false;
    if (filter === "unassigned" && t.assigned_to) return false;
    if (filter === "at_risk") {
      const s = liveSla(t, nowMs).status; // breached stays in At risk
      if (s !== "at_risk" && s !== "breached") return false;
    }
    return !q || matches(t, q);
  });
}

export function filterCounts(store: Store, nowMs: number): FilterCounts {
  const open = store.queueIds.flatMap((id) => { const t = store.tickets.get(id); return t ? [t] : []; });
  return {
    all: open.length,
    vip: open.filter((t) => t.is_vip).length,
    at_risk: open.filter((t) => ["at_risk", "breached"].includes(liveSla(t, nowMs).status)).length,
    unassigned: open.filter((t) => !t.assigned_to).length,
  };
}

export function Queue({ store, meta, filter, search, onFilter, onSearch, selectedId, onSelect, onOpen, onTake, onQuickState }: Props) {
  const nowMs = useNow();
  const ids = visibleQueueIds(store, filter, search, nowMs);
  const q = search.trim().toLowerCase();
  const done = store.resolvedIds.flatMap((id) => { const t = store.tickets.get(id); return t && (!q || matches(t, q)) ? [t] : []; });
  return (
    <section className="panel queue-panel">
      <QueueToolbar filter={filter} counts={filterCounts(store, nowMs)} search={search} onFilter={onFilter} onSearch={onSearch} />
      <div className="queue" data-testid="queue">
        {ids.map((id) => { const t = store.tickets.get(id); return t ? <QueueRow key={id} ticket={t} meta={meta} selected={selectedId === id} onSelect={onSelect} onOpen={onOpen} onTake={onTake} onQuickState={onQuickState} /> : null; })}
      </div>
      {store.queueIds.length === 0 && <QueueClear />}
      {store.queueIds.length > 0 && ids.length === 0 && <NoMatch />}
      <ResolvedList tickets={done} total={store.resolvedIds.length} meta={meta} onOpen={onOpen} />
    </section>
  );
}
