import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";
import { NowProvider } from "../hooks/useNow";
import { ToastProvider } from "../components/Toasts";

export function renderWithProviders(ui: ReactElement, options?: RenderOptions) {
  return render(<NowProvider offsetMs={0}><ToastProvider>{ui}</ToastProvider></NowProvider>, options);
}
