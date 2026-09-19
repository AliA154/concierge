import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider, useToast } from "./Toasts";

function Trigger() {
  const toast = useToast();
  return <>
    <button onClick={() => toast("saved", { type: "ok" })}>one</button>
    <button onClick={() => toast("undo me", { action: "Undo", onAction: () => toast("undone") })}>two</button>
  </>;
}

test("shows, caps at three, supports actions, and auto-dismisses", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  render(<ToastProvider><Trigger /></ToastProvider>);
  const one = screen.getByText("one");
  await userEvent.click(one); await userEvent.click(one); await userEvent.click(one); await userEvent.click(one);
  expect(screen.getAllByText("saved")).toHaveLength(3);
  await userEvent.click(screen.getByText("two"));
  await userEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(screen.getByText("undone")).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(4300); });
  expect(screen.queryByText("saved")).not.toBeInTheDocument();
  vi.useRealTimers();
});
