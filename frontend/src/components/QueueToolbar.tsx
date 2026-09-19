export type QueueFilter = "all" | "vip" | "at_risk" | "unassigned";
export type FilterCounts = Record<QueueFilter, number>;

interface Props { filter: QueueFilter; counts: FilterCounts; search: string; onFilter: (f: QueueFilter) => void; onSearch: (q: string) => void; }

const LABELS: Record<QueueFilter, string> = { all: "All", vip: "VIP", at_risk: "At risk", unassigned: "Unassigned" };

export function QueueToolbar({ filter, counts, search, onFilter, onSearch }: Props) {
  return (
    <div className="queue-toolbar">
      <div className="segmented" role="group" aria-label="Queue filters">
        {(Object.keys(LABELS) as QueueFilter[]).map((key) => (
          <button key={key} type="button" className={filter === key ? "active" : ""} onClick={() => onFilter(key)}>
            {key === "vip" && <span className="star">&#9733; </span>}{LABELS[key]} <span className="count num">{counts[key]}</span>
          </button>
        ))}
      </div>
      <input id="search" type="search" placeholder="Search subject, requester, number…" aria-label="Search tickets" value={search} onChange={(e) => onSearch(e.target.value)} />
    </div>
  );
}
