import { renderHook } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useShortcuts } from "./useShortcuts";

test("dispatches keys, ignores typing and modifiers, and is inert under the overlay", async () => {
  const h = { onNew: vi.fn(), onSearch: vi.fn(), onMove: vi.fn(), onOpen: vi.fn(), onTransition: vi.fn(), onEscape: vi.fn(), onToggleOverlay: vi.fn(), overlayOpen: false };
  const { rerender } = renderHook((p) => useShortcuts(p), { initialProps: h });
  await userEvent.keyboard("j"); expect(h.onMove).toHaveBeenCalledWith(1);
  await userEvent.keyboard("k"); expect(h.onMove).toHaveBeenCalledWith(-1);
  await userEvent.keyboard("1"); expect(h.onTransition).toHaveBeenCalledWith("In Progress");
  await userEvent.keyboard("{Enter}"); expect(h.onOpen).toHaveBeenCalled();
  await userEvent.keyboard("?"); expect(h.onToggleOverlay).toHaveBeenCalled();
  await userEvent.keyboard("{Control>}j{/Control}"); expect(h.onMove).toHaveBeenCalledTimes(2);
  const input = document.createElement("input"); document.body.append(input); input.focus();
  await userEvent.keyboard("n"); expect(h.onNew).not.toHaveBeenCalled();
  input.blur(); input.remove();
  rerender({ ...h, overlayOpen: true });
  await userEvent.keyboard("j"); expect(h.onMove).toHaveBeenCalledTimes(2);
  await userEvent.keyboard("{Escape}"); expect(h.onEscape).toHaveBeenCalled();
});
