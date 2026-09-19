import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./useReducedMotion";

// 300 ms count-up between values; instant under reduced motion. An
// interrupted tween continues from whatever value is currently on screen
// (tracked in displayedRef) instead of snapping back to the pre-interruption
// base, mirroring the old static/app.js setTileValue behavior.
export function useTween(value: number, ms = 300): number {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  const displayedRef = useRef(value);
  useEffect(() => {
    if (reduced || !Number.isFinite(fromRef.current) || fromRef.current === value) {
      fromRef.current = value;
      displayedRef.current = value;
      setShown(value);
      return;
    }
    const from = fromRef.current;
    const started = performance.now();
    let raf = 0;
    const step = (ts: number) => {
      const p = Math.min(1, (ts - started) / ms);
      const eased = 1 - (1 - p) * (1 - p);
      const next = from + (value - from) * eased;
      displayedRef.current = next;
      setShown(next);
      if (p < 1) raf = requestAnimationFrame(step);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      fromRef.current = displayedRef.current;
    };
  }, [value, ms, reduced]);
  return shown;
}
