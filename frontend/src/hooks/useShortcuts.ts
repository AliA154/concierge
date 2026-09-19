import { useEffect } from "react";
import type { State } from "../api/types";

export interface ShortcutHandlers {
  onNew: () => void; onSearch: () => void; onMove: (dir: 1 | -1) => void; onOpen: () => void;
  onTransition: (next: State) => void; onEscape: () => void; onToggleOverlay: () => void; overlayOpen: boolean;
}

const TYPING = ["INPUT", "TEXTAREA", "SELECT"];

export function useShortcuts(h: ShortcutHandlers): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && TYPING.includes(el.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "?") { e.preventDefault(); h.onToggleOverlay(); return; }
      if (e.key === "Escape") { h.onEscape(); return; }
      if (h.overlayOpen) return;
      switch (e.key) {
        case "n": e.preventDefault(); h.onNew(); break;
        case "/": e.preventDefault(); h.onSearch(); break;
        case "j": h.onMove(1); break;
        case "k": h.onMove(-1); break;
        case "Enter": h.onOpen(); break;
        case "1": h.onTransition("In Progress"); break;
        case "2": h.onTransition("On Hold"); break;
        case "3": h.onTransition("Resolved"); break;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [h]);
}
