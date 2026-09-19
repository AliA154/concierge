import type { Dispatch, RefObject, SetStateAction } from "react";
import type { Meta, State } from "../api/types";
import { useNow } from "../hooks/useNow";
import { useShortcuts } from "../hooks/useShortcuts";
import type { Store } from "../lib/store";
import { visibleQueueIds, type QueueFilter } from "./Queue";

interface Props {
  store: Store;
  meta: Meta;
  filter: QueueFilter;
  search: string;
  selectedId: number | null;
  setSelectedId: Dispatch<SetStateAction<number | null>>;
  drawerId: number | null;
  setDrawerId: Dispatch<SetStateAction<number | null>>;
  overlayOpen: boolean;
  setOverlayOpen: Dispatch<SetStateAction<boolean>>;
  subjectRef: RefObject<HTMLInputElement>;
  changeState: (id: number, next: State) => Promise<void>;
  setShakeId: Dispatch<SetStateAction<number | null>>;
}

// Lives under NowProvider so selection can move through the same
// nowMs-derived queue order the Queue panel renders.
export function Shortcuts({ store, meta, filter, search, selectedId, setSelectedId, drawerId, setDrawerId, overlayOpen, setOverlayOpen, subjectRef, changeState, setShakeId }: Props) {
  const nowMs = useNow();

  const onMove = (dir: 1 | -1) => {
    const ids = visibleQueueIds(store, filter, search, nowMs);
    if (ids.length === 0) return;
    const idx = selectedId === null ? -1 : ids.indexOf(selectedId);
    const nextIdx = idx === -1 ? (dir === 1 ? 0 : ids.length - 1) : Math.min(Math.max(idx + dir, 0), ids.length - 1);
    const nextId = ids[nextIdx];
    if (nextId !== undefined) setSelectedId(nextId);
  };

  const onOpen = () => {
    if (selectedId !== null) setDrawerId(selectedId);
  };

  const onTransition = (next: State) => {
    if (selectedId === null) return;
    const t = store.tickets.get(selectedId);
    if (!t) return;
    const allowed = meta.transitions[t.state] ?? [];
    if (!allowed.includes(next)) { setShakeId(selectedId); return; }
    void changeState(selectedId, next);
  };

  const onEscape = () => {
    if (overlayOpen) { setOverlayOpen(false); return; }
    if (drawerId !== null) { setDrawerId(null); return; }
    setSelectedId(null);
  };

  useShortcuts({
    onNew: () => subjectRef.current?.focus(),
    onSearch: () => document.getElementById("search")?.focus(),
    onMove,
    onOpen,
    onTransition,
    onEscape,
    onToggleOverlay: () => setOverlayOpen((o) => !o),
    overlayOpen,
  });

  return null;
}
