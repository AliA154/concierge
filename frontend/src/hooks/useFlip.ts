import { useLayoutEffect, useRef, type RefObject } from "react";

// FLIP: remember where each [data-id] row sat before this render, then play
// the inverted delta back to identity. Skipped entirely when disabled.
export function useFlip(containerRef: RefObject<HTMLElement>, deps: unknown[], enabled: boolean): void {
  const prev = useRef<Map<string, number> | null>(null);
  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root || !enabled) { prev.current = null; return; }
    const before = prev.current;
    const next = new Map<string, number>();
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(".row[data-id]"))) {
      const id = el.dataset["id"] ?? "";
      const top = el.getBoundingClientRect().top;
      next.set(id, top);
      if (!before) continue;
      const prevTop = before.get(id);
      if (prevTop === undefined) { el.classList.add("row-enter"); continue; }
      const delta = prevTop - top;
      if (Math.abs(delta) < 1) continue;
      el.style.transform = `translateY(${delta}px)`;
      el.style.transition = "none";
      requestAnimationFrame(() => {
        el.style.transition = "transform 250ms ease";
        el.style.transform = "";
        el.addEventListener("transitionend", () => { el.style.transition = ""; }, { once: true });
      });
    }
    prev.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
