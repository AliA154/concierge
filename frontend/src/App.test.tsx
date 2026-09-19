import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { App } from "./App";
import { queueFixture, server } from "./test/handlers";
import { makeTicket, metrics, NOW_ISO } from "./test/fixtures";

const rowById = (id: string) => screen.getAllByTestId("queue-row").find((r) => r.dataset["id"] === id)!;

test("boots meta and tickets and renders the queue", async () => {
  render(<App />);
  expect(await screen.findByText("CEO laptop")).toBeInTheDocument();
  expect(screen.getByText("Concierge")).toBeInTheDocument();
});

test("reset demo asks for confirmation then toasts the message", async () => {
  server.use(http.post("/api/demo/reset", () => HttpResponse.json({ ok: true, message: "Demo data reset" })));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<App />);
  await screen.findByText("CEO laptop");
  await userEvent.click(screen.getByRole("button", { name: "Reset demo data" }));
  expect(await screen.findByText("Demo data reset")).toBeInTheDocument();
});

test("? opens the shortcuts overlay and Escape closes it", async () => {
  render(<App />);
  await screen.findByText("CEO laptop");
  await userEvent.keyboard("?");
  expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  expect(screen.getByRole("dialog", { name: "Keyboard shortcuts", hidden: true })).not.toBeVisible();
});

test("j moves the selection down the visible queue and k moves it back", async () => {
  const scrollSpy = vi.fn();
  HTMLElement.prototype.scrollIntoView = scrollSpy;
  render(<App />);
  await screen.findByText("CEO laptop");
  await userEvent.keyboard("j");
  await userEvent.keyboard("j");
  expect(rowById("1")).toHaveClass("selected");
  expect(scrollSpy).toHaveBeenCalledWith({ block: "nearest", behavior: expect.any(String) });
  await userEvent.keyboard("k");
  expect(rowById("2")).toHaveClass("selected");
});

test("clicking the VIP banner scrolls to the row, selects it, and opens the drawer", async () => {
  const breachedVip = makeTicket({
    id: 2, number: "INC-1002", subject: "CEO laptop", requester: "Sam V", is_vip: true,
    priority: "High", sla_target_min: 5, created_at: "2026-09-18T11:00:00+00:00",
  });
  server.use(http.get("/api/tickets", () => HttpResponse.json({ now: NOW_ISO, queue: [breachedVip], resolved: [], metrics })));
  const scrollSpy = vi.fn();
  HTMLElement.prototype.scrollIntoView = scrollSpy;
  render(<App />);
  await screen.findByText("CEO laptop");

  await userEvent.click(screen.getByRole("button", { name: /INC-1002/ }));

  expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ block: "center" }));
  const drawer = await screen.findByRole("dialog", { name: "Ticket detail" });
  expect(within(drawer).getByText("INC-1002")).toBeInTheDocument();
});

test("Enter opens the drawer for the selected ticket", async () => {
  render(<App />);
  await screen.findByText("CEO laptop");
  await userEvent.keyboard("j");
  await userEvent.keyboard("{Enter}");
  const drawer = await screen.findByRole("dialog", { name: "Ticket detail" });
  expect(within(drawer).getByText("INC-1002")).toBeInTheDocument();
});

test("an illegal transition shakes the row and sends nothing; a legal one calls the API", async () => {
  let patchCalls = 0;
  server.use(http.patch("/api/tickets/3", () => {
    patchCalls += 1;
    return HttpResponse.json({ ...queueFixture.find((t) => t.id === 3)!, state: "In Progress" });
  }));
  render(<App />);
  await screen.findByText("CEO laptop");
  await userEvent.keyboard("j");
  await userEvent.keyboard("j");
  await userEvent.keyboard("j");
  expect(rowById("3")).toHaveClass("selected");
  await userEvent.keyboard("2"); // On Hold -> On Hold is not an allowed transition
  expect(rowById("3")).toHaveClass("shake");
  expect(patchCalls).toBe(0);
  await userEvent.keyboard("1"); // On Hold -> In Progress is allowed
  await waitFor(() => expect(patchCalls).toBe(1));
});

test("3 collapses the selected row for 200ms before resolving it", async () => {
  let patchCalls = 0;
  server.use(http.patch("/api/tickets/1", () => {
    patchCalls += 1;
    return HttpResponse.json({ ...queueFixture.find((t) => t.id === 1)!, state: "Resolved" });
  }));
  render(<App />);
  await screen.findByText("CEO laptop");
  await userEvent.keyboard("j");
  await userEvent.keyboard("j");
  expect(rowById("1")).toHaveClass("selected");
  await userEvent.keyboard("3");
  expect(rowById("1")).toHaveClass("collapsing");
  expect(patchCalls).toBe(0);
  await waitFor(() => expect(patchCalls).toBe(1));
});

test("Escape closes an open drawer, then clears the selection", async () => {
  render(<App />);
  await screen.findByText("CEO laptop");
  await userEvent.keyboard("j");
  await userEvent.keyboard("{Enter}");
  const drawer = await screen.findByRole("dialog", { name: "Ticket detail" });
  await within(drawer).findByText("INC-1002");
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "Ticket detail" })).not.toBeInTheDocument();
  expect(rowById("2")).toHaveClass("selected");
  await userEvent.keyboard("{Escape}");
  expect(rowById("2")).not.toHaveClass("selected");
});
