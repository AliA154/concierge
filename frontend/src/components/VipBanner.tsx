import { useNow } from "../hooks/useNow";
import { liveSla } from "../lib/sla";
import type { Store } from "../lib/store";

export function VipBanner({ store, onOpen }: { store: Store; onOpen: (id: number) => void }) {
  const nowMs = useNow();
  const breached = store.queueIds.map((id) => store.tickets.get(id)).find((t) => t && t.is_vip && liveSla(t, nowMs).status === "breached");
  if (!breached) return null;
  return (
    <button type="button" className="vip-banner" onClick={() => onOpen(breached.id)}>
      &#9733; VIP ticket <span className="num">{breached.number}</span> has breached SLA
    </button>
  );
}
