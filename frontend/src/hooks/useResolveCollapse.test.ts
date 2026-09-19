import { act, renderHook } from "@testing-library/react";
import { useResolveCollapse } from "./useResolveCollapse";

afterEach(() => {
  vi.useRealTimers();
});

test("collapses the row for 200ms before resolving, then clears collapsingId", () => {
  vi.useFakeTimers();
  const changeState = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() => useResolveCollapse({ reduced: false, changeState }));

  act(() => result.current.resolveFromRow(7));
  expect(result.current.collapsingId).toBe(7);
  expect(changeState).not.toHaveBeenCalled();

  act(() => { vi.advanceTimersByTime(200); });
  expect(result.current.collapsingId).toBeNull();
  expect(changeState).toHaveBeenCalledWith(7, "Resolved");
});

test("resolves immediately with no collapse under reduced motion", () => {
  vi.useFakeTimers();
  const changeState = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() => useResolveCollapse({ reduced: true, changeState }));

  act(() => result.current.resolveFromRow(3));
  expect(result.current.collapsingId).toBeNull();
  expect(changeState).toHaveBeenCalledWith(3, "Resolved");
});

test("clears the pending timeout on unmount so it never fires late", () => {
  vi.useFakeTimers();
  const clearSpy = vi.spyOn(global, "clearTimeout");
  const changeState = vi.fn().mockResolvedValue(undefined);
  const { result, unmount } = renderHook(() => useResolveCollapse({ reduced: false, changeState }));

  act(() => result.current.resolveFromRow(9));
  unmount();
  act(() => { vi.advanceTimersByTime(200); });
  expect(changeState).not.toHaveBeenCalled();
  expect(clearSpy).toHaveBeenCalled();
});
