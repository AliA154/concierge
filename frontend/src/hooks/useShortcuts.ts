import { useEffect, useRef } from "react";
import type { State } from "../api/types";

export interface ShortcutHandlers {
  onNew: () => void; onSearch: () => void; onMove: (dir: 1 | -1) => void; onOpen: () => void;
  onTransition: (next: State) => void; onEscape: () => void; onToggleOverlay: () => void; overlayOpen: boolean;
}

const TYPING = ["INPUT", "TEXTAREA", "SELECT"];

export function useShortcuts(h: ShortcutHandlers): void {
  // Keep the latest handlers in a ref so the listener effect below can run
  // once instead of tearing down and re-attaching on every caller render
  // (callers rebuild the handlers object each render, including once a
  // second from useNow's tick).
  const ref = useRef(h);
  ref.current = h;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const handlers = ref.current;
      const el = document.activeElement;
      if (el && TYPING.includes(el.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "?") { e.preventDefault(); handlers.onToggleOverlay(); return; }
      if (e.key === "Escape") { handlers.onEscape(); return; }
      if (handlers.overlayOpen) return;
      switch (e.key) {
        case "n": e.preventDefault(); handlers.onNew(); break;
        case "/": e.preventDefault(); handlers.onSearch(); break;
        case "j": handlers.onMove(1); break;
        case "k": handlers.onMove(-1); break;
        case "Enter": handlers.onOpen(); break;
        case "1": handlers.onTransition("In Progress"); break;
        case "2": handlers.onTransition("On Hold"); break;
        case "3": handlers.onTransition("Resolved"); break;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}
