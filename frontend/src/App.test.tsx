import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { App } from "./App";
import { server } from "./test/handlers";

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
