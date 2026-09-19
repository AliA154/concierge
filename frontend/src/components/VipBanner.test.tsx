import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/render";
import { makeTicket, metrics, NOW_ISO } from "../test/fixtures";
import { emptyStore, replaceAll } from "../lib/store";
import { VipBanner } from "./VipBanner";

// created 60 minutes before NOW_ISO against a 5-minute SLA target: well past breach.
const breachedVip = makeTicket({
  id: 9,
  number: "INC-9001",
  is_vip: true,
  sla_target_min: 5,
  created_at: "2026-09-18T11:00:00+00:00",
});

test("renders nothing when no VIP ticket is breached", () => {
  const store = replaceAll(emptyStore(), { now: NOW_ISO, queue: [makeTicket({ id: 1 })], resolved: [], metrics });
  renderWithProviders(<VipBanner store={store} onOpen={vi.fn()} />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("names the breached VIP ticket and calls onOpen with its id on click", async () => {
  const onOpen = vi.fn();
  const store = replaceAll(emptyStore(), { now: NOW_ISO, queue: [breachedVip], resolved: [], metrics });
  renderWithProviders(<VipBanner store={store} onOpen={onOpen} />);
  const banner = screen.getByRole("button", { name: /INC-9001/ });
  expect(banner).toBeInTheDocument();

  await userEvent.click(banner);

  expect(onOpen).toHaveBeenCalledWith(9);
});
