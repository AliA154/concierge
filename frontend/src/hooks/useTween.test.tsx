import { act, renderHook } from "@testing-library/react";
import { useTween } from "./useTween";

test("continues from the currently displayed value when interrupted mid-tween", () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "performance"] });
  try {
    const { result, rerender } = renderHook(({ v }: { v: number }) => useTween(v), { initialProps: { v: 0 } });
    expect(result.current).toBe(0);

    rerender({ v: 100 });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    const mid = result.current;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(100);

    rerender({ v: 200 });
    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(result.current).toBeGreaterThanOrEqual(mid);
  } finally {
    vi.useRealTimers();
  }
});
