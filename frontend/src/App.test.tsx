import { render, screen } from "@testing-library/react";
import { App } from "./App";

test("boots meta and tickets and renders the queue", async () => {
  render(<App />);
  expect(await screen.findByText("CEO laptop")).toBeInTheDocument();
  expect(screen.getByText("Concierge")).toBeInTheDocument();
});
