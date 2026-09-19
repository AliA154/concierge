import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { server } from "./handlers";

// jsdom has no scroll layout, so scrollIntoView is missing; stub a baseline
// no-op so row-scroll callers do not throw. Tests asserting on it replace
// this with their own vi.fn() to capture calls.
Element.prototype.scrollIntoView = vi.fn();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
