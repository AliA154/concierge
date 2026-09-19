import { useEffect, useRef } from "react";
import { useNow } from "./useNow";
import { liveSla } from "../lib/sla";
import type { Store } from "../lib/store";
import type { ToastFn } from "../components/Toasts";

// Toast the moment a ticket crosses into breach (never on every poll), and
// keep the tab title's breach count current.
export function useBreachWatch(store: Store, toast: ToastFn): void {
  const nowMs = useNow();
  const lastStatus = useRef(new Map<number, string>());
  useEffect(() => {
    let breachCount = 0;
    const seen = new Map<number, string>();
    for (const id of store.queueIds) {
      const t = store.tickets.get(id);
      if (!t) continue;
      const status = liveSla(t, nowMs).status;
      if (status === "breached") breachCount += 1;
      const prev = lastStatus.current.get(id);
      if (prev !== undefined && prev !== "breached" && status === "breached") {
        toast(`${t.number} breached SLA`, { type: "crit", duration: 6000 });
      }
      seen.set(id, status);
    }
    lastStatus.current = seen;
    document.title = breachCount > 0 ? `(${breachCount}⚠) Concierge` : "Concierge";
  }, [store, nowMs, toast]);
}
