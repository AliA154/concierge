import { screen } from "@testing-library/react";
import { renderWithProviders } from "../test/render";
import { metrics } from "../test/fixtures";
import { MetricsTiles } from "./MetricsTiles";

test("renders six tiles with values and contexts", () => {
  renderWithProviders(<MetricsTiles metrics={{ ...metrics, breaching: 2 }} />);
  expect(screen.getByText("Open")).toBeInTheDocument();
  expect(screen.getByText("1 VIP")).toBeInTheDocument();
  expect(screen.getByText("needs eyes now")).toBeInTheDocument();
  expect(screen.getByText("92%")).toBeInTheDocument();
  expect(screen.getByText("41.5m")).toBeInTheDocument();
  expect(screen.getByText("4 resolved")).toBeInTheDocument();
});
