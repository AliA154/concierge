import { renderHook } from "@testing-library/react";
import { useShimmer } from "./useShimmer";

afterEach(() => {
  document.body.classList.remove("shimmer-on");
  vi.useRealTimers();
});

test("shimmer-on is not present immediately and is removed after the data loads", () => {
  vi.useFakeTimers();
  const { rerender } = renderHook(({ loaded }: { loaded: boolean }) => useShimmer(loaded), { initialProps: { loaded: false } });
  expect(document.body.classList.contains("shimmer-on")).toBe(false);

  vi.advanceTimersByTime(300);
  expect(document.body.classList.contains("shimmer-on")).toBe(true);

  rerender({ loaded: true });
  expect(document.body.classList.contains("shimmer-on")).toBe(false);
});

test("never arms shimmer-on when the data loads before the 300ms delay", () => {
  vi.useFakeTimers();
  const { rerender } = renderHook(({ loaded }: { loaded: boolean }) => useShimmer(loaded), { initialProps: { loaded: false } });
  vi.advanceTimersByTime(200);
  rerender({ loaded: true });
  vi.advanceTimersByTime(200);
  expect(document.body.classList.contains("shimmer-on")).toBe(false);
});
