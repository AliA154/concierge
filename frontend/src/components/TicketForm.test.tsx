import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/render";
import { meta } from "../test/fixtures";
import { TicketForm } from "./TicketForm";
import { describe, test, expect, vi } from "vitest";

describe("TicketForm", () => {
  test("priority preview follows the matrix and VIP halves the SLA", async () => {
    renderWithProviders(<TicketForm meta={meta} onCreate={vi.fn().mockResolvedValue({})} />);
    expect(screen.getByText("Medium", { selector: ".pp-badge" })).toBeInTheDocument();
    expect(screen.getByText("SLA 240m")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Impact"), "High");
    await userEvent.selectOptions(screen.getByLabelText("Urgency"), "High");
    expect(screen.getByText("Critical", { selector: ".pp-badge" })).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/VIP requester/));
    expect(screen.getByText("SLA 15m")).toBeInTheDocument();
  });

  test("submits the body, resets, and shows a persistent error on failure", async () => {
    const onCreate = vi.fn().mockRejectedValueOnce(new Error("subject is required (1–200 characters)")).mockResolvedValue({});
    renderWithProviders(<TicketForm meta={meta} onCreate={onCreate} />);
    await userEvent.type(screen.getByLabelText("Requester"), "Dana");
    await userEvent.click(screen.getByRole("button", { name: "Create ticket" }));
    expect(screen.getByRole("alert")).toHaveTextContent("subject is required");
    await userEvent.type(screen.getByLabelText("Subject"), "VPN down");
    await userEvent.click(screen.getByRole("button", { name: "Create ticket" }));
    expect(onCreate).toHaveBeenLastCalledWith({ subject: "VPN down", requester: "Dana", ticket_type: "Incident", impact: "Medium", urgency: "Medium", is_vip: false });
    expect(screen.getByLabelText("Subject")).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
