import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { renderWithProviders } from "../test/render";
import { meta, metrics, NOW_ISO } from "../test/fixtures";
import { queueFixture, resolvedFixture, server } from "../test/handlers";
import { emptyStore, replaceAll } from "../lib/store";
import { Drawer } from "./Drawer";

const store = replaceAll(emptyStore(), { now: NOW_ISO, queue: queueFixture, resolved: resolvedFixture, metrics });
const props = { store, meta, actingAgent: "Priya Natarajan", onClose: vi.fn(), onChangeState: vi.fn(), onAssign: vi.fn(), onReopen: vi.fn() };

test("shows identity, transitions from meta, and the timeline", async () => {
  renderWithProviders(<Drawer id={1} {...props} />);
  expect(screen.getByText("INC-1001")).toBeInTheDocument();
  expect(await screen.findByText("Checked the tunnel")).toBeInTheDocument();
  const controls = screen.getByText("State").parentElement!;
  expect(within(controls).getByRole("button", { name: "In Progress" })).toBeInTheDocument();
  expect(within(controls).queryByRole("button", { name: "Reopen" })).not.toBeInTheDocument();
  await userEvent.click(within(controls).getByRole("button", { name: "On Hold" }));
  expect(props.onChangeState).toHaveBeenCalledWith(1, "On Hold");
  await userEvent.selectOptions(screen.getByLabelText("Assignee"), "Marcus Bell");
  expect(props.onAssign).toHaveBeenCalledWith(1, "Marcus Bell");
});

test("resolved ticket offers Reopen; closed ticket locks the composer", async () => {
  renderWithProviders(<Drawer id={4} {...props} />);
  await userEvent.click(await screen.findByRole("button", { name: "Reopen" }));
  expect(props.onReopen).toHaveBeenCalledWith(4);
  const closedStore = replaceAll(emptyStore(), { now: NOW_ISO, queue: [], resolved: [{ ...resolvedFixture[0]!, state: "Closed" }], metrics });
  renderWithProviders(<Drawer id={4} {...props} store={closedStore} />);
  expect(screen.getAllByLabelText("Work note").at(-1)).toBeDisabled();
});

test("note posts optimistically and restores the draft on failure", async () => {
  server.use(http.post("/api/tickets/1/notes", () => HttpResponse.json({ error: { code: 400, message: "note is required" } }, { status: 400 })));
  renderWithProviders(<Drawer id={1} {...props} />);
  await screen.findByText("Checked the tunnel");
  const box = screen.getByLabelText("Work note");
  await userEvent.type(box, "rebooted the gateway");
  await userEvent.click(screen.getByRole("button", { name: "Add note" }));
  await waitFor(() => expect(box).toHaveValue("rebooted the gateway"));
  expect(screen.queryByText("rebooted the gateway", { selector: ".tl-detail" })).not.toBeInTheDocument();
});
