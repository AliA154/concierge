import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/render";
import { meta, metrics, NOW_ISO } from "../test/fixtures";
import { queueFixture, resolvedFixture } from "../test/handlers";
import { emptyStore, replaceAll } from "../lib/store";
import { Queue, type QueueFilter } from "./Queue";
import { useState } from "react";

function Harness({ initial = "all" }: { initial?: QueueFilter }) {
  const [filter, setFilter] = useState<QueueFilter>(initial);
  const [search, setSearch] = useState("");
  const store = replaceAll(emptyStore(), { now: NOW_ISO, queue: queueFixture, resolved: resolvedFixture, metrics });
  return <Queue store={store} meta={meta} filter={filter} search={search} onFilter={setFilter} onSearch={setSearch} selectedId={null} onSelect={vi.fn()} onOpen={vi.fn()} onTake={vi.fn()} onQuickState={vi.fn()} shakeId={null} />;
}

test("renders open rows in order, VIP star, assignee, and resolved section", () => {
  renderWithProviders(<Harness />);
  const rows = screen.getAllByTestId("queue-row");
  expect(rows.map((r) => r.dataset["id"])).toEqual(["2", "1", "3"]);
  expect(within(rows[0]!).getByTitle("VIP — SLA target halved")).toBeInTheDocument();
  expect(within(rows[2]!).getByText("MB")).toBeInTheDocument();
  expect(screen.getByText("Printer jam")).toBeInTheDocument();
  expect(screen.getByText(/Met in 22m/)).toBeInTheDocument();
});

test("filters and counts", async () => {
  renderWithProviders(<Harness />);
  expect(screen.getByRole("button", { name: /VIP 1/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Unassigned 2/ })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /Unassigned/ }));
  expect(screen.getAllByTestId("queue-row").map((r) => r.dataset["id"])).toEqual(["2", "1"]);
});

test("search matches subject, requester, or number and applies to resolved", async () => {
  renderWithProviders(<Harness />);
  await userEvent.type(screen.getByLabelText("Search tickets"), "printer");
  expect(screen.queryAllByTestId("queue-row")).toHaveLength(0);
  expect(screen.getByText("No open tickets match this view.")).toBeVisible();
  expect(screen.getByText("Printer jam")).toBeInTheDocument();
});

test("quick actions call handlers", async () => {
  const onTake = vi.fn(); const onQuickState = vi.fn();
  const store = replaceAll(emptyStore(), { now: NOW_ISO, queue: queueFixture, resolved: [], metrics });
  renderWithProviders(<Queue store={store} meta={meta} filter="all" search="" onFilter={vi.fn()} onSearch={vi.fn()} selectedId={null} onSelect={vi.fn()} onOpen={vi.fn()} onTake={onTake} onQuickState={onQuickState} shakeId={null} />);
  const first = screen.getAllByTestId("queue-row")[0]!;
  await userEvent.click(within(first).getByRole("button", { name: "Take" }));
  expect(onTake).toHaveBeenCalledWith(2);
  await userEvent.click(within(first).getByRole("button", { name: "Start" }));
  expect(onQuickState).toHaveBeenCalledWith(2, "In Progress");
});
