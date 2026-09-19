import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/dom";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./handlers";

// The shortcuts overlay stays mounted and toggles the native `hidden`
// attribute; role queries need to see it closed so tests can assert on
// visibility rather than presence.
configure({ defaultHidden: true });

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
