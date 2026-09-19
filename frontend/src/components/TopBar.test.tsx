import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/render";
import { meta } from "../test/fixtures";
import { TopBar } from "./TopBar";

test("shows agents, current chip, reconnect pill, and calls onAgentChange", async () => {
  const onAgentChange = vi.fn();
  renderWithProviders(<TopBar meta={meta} offline={true} actingAgent="Marcus Bell" onAgentChange={onAgentChange} />);
  expect(screen.getByText("Reconnecting…")).toBeVisible();
  expect(screen.getByText("MB")).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText("Acting as agent"), "Priya Natarajan");
  expect(onAgentChange).toHaveBeenCalledWith("Priya Natarajan");
  expect(screen.getByText(/\d\d:\d\d:\d\d/)).toBeInTheDocument();
});
