import { useEffect, useRef, useState } from "react";
import type { State } from "../api/types";

const RESOLVE_COLLAPSE_MS = 200;

interface UseResolveCollapseArgs {
  reduced: boolean;
  changeState: (id: number, next: State) => Promise<void>;
}

interface UseResolveCollapseResult {
  collapsingId: number | null;
  resolveFromRow: (id: number) => void;
}

// Plays a 200ms collapse animation on a row before resolving it, unless the
// viewer prefers reduced motion (then it resolves immediately). Shared by the
// row quick action, the drawer control, and the "3" shortcut.
export function useResolveCollapse({ reduced, changeState }: UseResolveCollapseArgs): UseResolveCollapseResult {
  const [collapsingId, setCollapsingId] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const resolveFromRow = (id: number) => {
    if (reduced) { void changeState(id, "Resolved"); return; }
    setCollapsingId(id);
    timerRef.current = setTimeout(() => {
      setCollapsingId(null);
      void changeState(id, "Resolved");
    }, RESOLVE_COLLAPSE_MS);
  };

  return { collapsingId, resolveFromRow };
}
