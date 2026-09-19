# Concierge React + TypeScript Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `static/app.js` + `templates/index.html` with a Vite + React 18 + TypeScript app in `frontend/`, served by Flask at `/`, with full parity and 80%+ frontend test coverage in CI.

**Architecture:** One typed store (`useTickets`) polls `/api/tickets` every 15 s and applies optimistic mutations with snapshot/revert; a `NowProvider` ticks once per second and only live-time leaf components subscribe to it. Flask is untouched except for serving `frontend/dist`. The existing `style.css` is reused verbatim and every component keeps today's class names.

**Tech Stack:** React 18, TypeScript 5 (strict), Vite 5, Vitest 2 + jsdom + React Testing Library + MSW 2, ESLint 9 (typescript-eslint, react-hooks), Flask 3 (existing), GitHub Actions, Render.

**Spec:** `docs/superpowers/specs/2026-09-18-react-frontend-design.md`

## Global Constraints

- Branch `react-frontend`; conventional commits; never push to `main`; PR approved by Ali before merge (live URL on his resume).
- `tsconfig`: `"strict": true`, `"noUncheckedIndexedAccess": true`. No `any`.
- Files 40–150 lines; split at 200.
- Keep every CSS class name from `static/style.css`; the stylesheet moves to `frontend/src/styles.css` unchanged.
- API contract unchanged (see spec "Server contract"). Mutations send `X-Agent`.
- Immutable state updates only (new objects, never mutate store values in place).
- Coverage threshold 80% lines and branches (`vitest.config` in `vite.config.ts`).
- Run frontend commands from `frontend/`; run pytest from repo root with `.venv/bin/python -m pytest -q` (or `pytest -q` if the venv is active).
- Node 22, npm. Python 3.11/3.12.

---

## File Map

```
frontend/package.json, vite.config.ts, tsconfig.json, tsconfig.node.json, eslint.config.js, index.html
frontend/src/main.tsx                    mount App inside providers
frontend/src/App.tsx                     layout: TopBar, VipBanner, MetricsTiles, TicketForm, Queue, footer, Drawer, Toasts, ShortcutsOverlay
frontend/src/styles.css                  moved from static/style.css
frontend/src/api/types.ts                Ticket, Event, Meta, Metrics, TicketsResponse, TicketDetailResponse, ApiErrorBody
frontend/src/api/client.ts               api<T>(path, opts) + ApiError
frontend/src/lib/format.ts               fmtClock, fmtAge, fmtRelative, fmtDeskTime, clamp01
frontend/src/lib/sla.ts                  isOpen, liveSla, queueSortKey, compareKeys, QUICK_ACTION
frontend/src/lib/store.ts                Store type, emptyStore, applyTicket, replaceAll, applyLocalTransition
frontend/src/hooks/useNow.tsx            NowProvider + useNow (1 s tick with server offset)
frontend/src/hooks/useActingAgent.ts     localStorage-backed acting agent
frontend/src/hooks/useMeta.ts            fetch /api/meta with 3 s retry
frontend/src/hooks/useTickets.ts         store + poll + mutations
frontend/src/hooks/useTween.ts           300 ms count-up
frontend/src/hooks/useFlip.ts            FLIP reorder
frontend/src/hooks/useShortcuts.ts       keyboard map
frontend/src/hooks/useReducedMotion.ts   matchMedia helper
frontend/src/components/Toasts.tsx       ToastProvider, useToast
frontend/src/components/TopBar.tsx, AgentPicker.tsx
frontend/src/components/MetricsTiles.tsx, Tile.tsx
frontend/src/components/VipBanner.tsx
frontend/src/components/TicketForm.tsx, PriorityPreview.tsx
frontend/src/components/Queue.tsx, QueueToolbar.tsx, QueueRow.tsx, SlaInstrument.tsx, ResolvedList.tsx, DoneRow.tsx, EmptyState.tsx, Avatar.tsx
frontend/src/components/Drawer.tsx, DrawerIdentity.tsx, SlaRing.tsx, DrawerControls.tsx, Timeline.tsx, NoteComposer.tsx
frontend/src/components/ShortcutsOverlay.tsx
frontend/src/test/setup.ts, handlers.ts, fixtures.ts, render.tsx
concierge/__init__.py, concierge/routes.py   serve dist
tests/test_api.py                        index route tests
.github/workflows/ci.yml, render.yaml, .gitignore, README.md
```

---

### Task 1: Scaffold the frontend, serve it from Flask, wire CI

**Files:**
- Create: `frontend/package.json`, `frontend/vite.config.ts`, `frontend/tsconfig.json`, `frontend/tsconfig.node.json`, `frontend/eslint.config.js`, `frontend/index.html`, `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/vite-env.d.ts`, `frontend/src/test/setup.ts`, `frontend/src/App.test.tsx`
- Move: `static/style.css` → `frontend/src/styles.css` (git mv; keep `static/` for now, it is deleted in Task 12)
- Modify: `concierge/__init__.py`, `concierge/routes.py:99-101`, `tests/test_api.py`, `.github/workflows/ci.yml`, `render.yaml`, `.gitignore`

**Interfaces:**
- Produces: `frontend/dist/index.html` + `frontend/dist/assets/*` from `npm run build`; Flask `GET /` serves `dist/index.html`, `GET /assets/<path>` serves hashed assets, 503 when dist is missing.

- [ ] **Step 1: Write the failing Flask tests**

Append to `tests/test_api.py`:

```python
from pathlib import Path


def test_index_serves_built_frontend(client, tmp_path, monkeypatch):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>Concierge</title><div id=root></div>")
    (dist / "assets" / "app.js").write_text("console.log('hi')")
    monkeypatch.setitem(client.application.config, "FRONTEND_DIST", str(dist))
    res = client.get("/")
    assert res.status_code == 200
    assert b'id=root' in res.data
    asset = client.get("/assets/app.js")
    assert asset.status_code == 200
    assert asset.headers["Cache-Control"].startswith("public, max-age=")


def test_index_503_without_build(client, tmp_path, monkeypatch):
    monkeypatch.setitem(client.application.config, "FRONTEND_DIST", str(tmp_path / "missing"))
    res = client.get("/")
    assert res.status_code == 503
    assert b"npm run build" in res.data
```

- [ ] **Step 2: Run to verify they fail**

Run: `pytest tests/test_api.py -q -k "index"`
Expected: FAIL (KeyError on FRONTEND_DIST or 200 from the old template).

- [ ] **Step 3: Serve dist from Flask**

In `concierge/__init__.py`, inside `create_app`, after the `app = Flask(...)` call add a config default (keep existing `template_folder`/`static_folder` args for now; Task 12 removes them):

```python
    app.config.setdefault("FRONTEND_DIST", str(ROOT / "frontend" / "dist"))
```

In `concierge/routes.py` replace the `index` view (lines 99–101) with:

```python
@bp.get("/")
def index() -> Response | tuple[str, int]:
    dist = Path(current_app.config["FRONTEND_DIST"])
    index_file = dist / "index.html"
    if not index_file.is_file():
        return (
            "Frontend not built. Run `npm --prefix frontend ci && npm --prefix frontend run build`.",
            503,
        )
    return send_from_directory(dist, "index.html", max_age=0)


@bp.get("/assets/<path:filename>")
def frontend_asset(filename: str) -> Response:
    # Vite hashes every asset filename, so a year-long cache is safe.
    dist = Path(current_app.config["FRONTEND_DIST"])
    return send_from_directory(dist / "assets", filename, max_age=60 * 60 * 24 * 365)
```

Add to the imports at the top of `routes.py`: `from pathlib import Path` and extend the flask import to `from flask import Blueprint, Response, current_app, jsonify, request, send_from_directory, url_for` (drop `render_template`).

- [ ] **Step 4: Run the Flask tests**

Run: `pytest -q`
Expected: all pass, including the two new tests.

- [ ] **Step 5: Create the Vite project files**

`frontend/package.json`:

```json
{
  "name": "concierge-frontend",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint src",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@eslint/js": "^9.12.0",
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.1",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^18.3.11",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.2",
    "@vitest/coverage-v8": "^2.1.2",
    "eslint": "^9.12.0",
    "eslint-plugin-react-hooks": "^5.0.0",
    "jsdom": "^25.0.1",
    "msw": "^2.4.9",
    "typescript": "^5.6.2",
    "typescript-eslint": "^8.8.0",
    "vite": "^5.4.8",
    "vitest": "^2.1.2"
  }
}
```

`frontend/vite.config.ts`:

```ts
/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:5001" } },
  build: { outDir: "dist", emptyOutDir: true },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/main.tsx", "src/test/**", "src/vite-env.d.ts", "src/api/types.ts"],
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
    },
  },
});
```

`frontend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src"]
}
```

`frontend/tsconfig.node.json`:

```json
{ "compilerOptions": { "composite": true, "module": "ESNext", "moduleResolution": "Bundler", "strict": true, "skipLibCheck": true }, "include": ["vite.config.ts"] }
```

`frontend/eslint.config.js`:

```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist", "coverage"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.recommended.rules, "@typescript-eslint/no-explicit-any": "error" },
  },
);
```

`frontend/index.html` (the `<head>` is today's template head; the body is one mount point):

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Concierge</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M8 1l7 7-7 7-7-7z' fill='%234c8bf5'/%3E%3C/svg%3E">
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

`frontend/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
```

`frontend/src/main.tsx`:

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root missing");
createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

`frontend/src/App.tsx` (placeholder; replaced in Task 4 onward):

```tsx
export function App() {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-glyph" aria-hidden="true">&#9670;</span>
        <span className="brand-name">Concierge</span>
        <span className="tagline">VIP-aware service desk</span>
      </div>
    </header>
  );
}
```

`frontend/src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./handlers";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

`frontend/src/test/handlers.ts` (minimal now; Task 5 fills it):

```ts
import { setupServer } from "msw/node";

export const server = setupServer();
```

`frontend/src/App.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { App } from "./App";

test("renders the brand", () => {
  render(<App />);
  expect(screen.getByText("Concierge")).toBeInTheDocument();
});
```

Move the stylesheet: `git mv static/style.css frontend/src/styles.css`, then create an empty placeholder `static/style.css`? No: `templates/index.html` still references it until Task 12. Instead copy: `cp static/style.css frontend/src/styles.css` (delete `static/` in Task 12).

- [ ] **Step 6: Install, lint, type-check, test, build**

Run from `frontend/`: `npm install && npm run lint && npm run typecheck && npm test && npm run build`
Expected: lint clean, 1 test passing, `dist/index.html` and `dist/assets/*.js` exist.

- [ ] **Step 7: Serve it**

Run from repo root: `SEED_ON_START=1 .venv/bin/python app.py` then `curl -s localhost:5001/ | head -3`
Expected: the built `index.html` (contains `id="root"` and a `/assets/` script tag).

- [ ] **Step 8: Ignore build artifacts, wire CI and Render**

Append to `.gitignore`:

```
frontend/node_modules/
frontend/dist/
frontend/coverage/
```

Replace `.github/workflows/ci.yml` with:

```yaml
name: CI

on:
  push:
  pull_request:

jobs:
  frontend:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test -- --coverage
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: frontend-dist
          path: frontend/dist

  backend:
    runs-on: ubuntu-latest
    needs: frontend
    strategy:
      matrix:
        python-version: ["3.11", "3.12"]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          name: frontend-dist
          path: frontend/dist
      - uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python-version }}
      - name: Install dependencies
        run: pip install -r requirements.txt -r requirements-dev.txt
      - name: Lint
        run: ruff check .
      - name: Test
        run: pytest -q
```

Replace `render.yaml` with:

```yaml
services:
  - type: web
    name: concierge
    runtime: python
    plan: free
    buildCommand: pip install -r requirements.txt && npm --prefix frontend ci && npm --prefix frontend run build
    startCommand: gunicorn app:app --bind 0.0.0.0:$PORT
```

- [ ] **Step 9: Commit**

```bash
git add -A frontend .gitignore .github/workflows/ci.yml render.yaml concierge tests
git commit -m "feat(frontend): scaffold Vite React TypeScript app served by Flask"
```

---

### Task 2: API types and client

**Files:**
- Create: `frontend/src/api/types.ts`, `frontend/src/api/client.ts`
- Test: `frontend/src/api/client.test.ts`

**Interfaces:**
- Produces: all types below; `api<T>(path: string, opts?: { method?: "GET"|"POST"|"PATCH"; body?: unknown; agent?: string }): Promise<T>`; `class ApiError extends Error { code: number }`.

- [ ] **Step 1: Write the types**

`frontend/src/api/types.ts`:

```ts
export type TicketType = "Incident" | "Request" | "Problem" | "Change";
export type State = "New" | "In Progress" | "On Hold" | "Resolved" | "Closed";
export type Priority = "Critical" | "High" | "Medium" | "Low";
export type Level = "High" | "Medium" | "Low";
export type SlaStatus = "ok" | "at_risk" | "breached" | "paused" | "met" | "missed";

export interface Agent { name: string; initials: string; color: string; }

export interface Meta {
  types: TicketType[];
  states: State[];
  priorities: Priority[];
  impacts: Level[];
  urgencies: Level[];
  priority_matrix: Record<string, Priority>;
  sla_targets: Record<Priority, number>;
  transitions: Record<State, State[]>;
  agents: Agent[];
}

export interface Ticket {
  id: number;
  number: string;
  subject: string;
  requester: string;
  ticket_type: TicketType;
  impact: Level;
  urgency: Level;
  priority: Priority;
  state: State;
  is_vip: boolean;
  assigned_to: string | null;
  created_at: string;
  resolved_at: string | null;
  closed_at: string | null;
  on_hold_since: string | null;
  held_minutes: number;
  reopened_count: number;
  sla_target_min: number;
  sla_elapsed_min: number;
  sla_remaining_min: number | null;
  sla_status: SlaStatus;
  sla_met: boolean | null;
}

export type EventType = "created" | "state_change" | "assigned" | "work_note" | "reopened";

export interface TicketEvent {
  id: number | string;
  actor: string;
  event_type: EventType;
  detail: string;
  created_at: string;
  pending?: boolean;
}

export interface Metrics {
  open: number;
  vip_open: number;
  unassigned: number;
  at_risk: number;
  breaching: number;
  sla_met_pct: number;
  mttr_min: number;
  resolved: number;
}

export interface TicketsResponse { now: string; queue: Ticket[]; resolved: Ticket[]; metrics: Metrics; }
export interface TicketDetailResponse { now: string; ticket: Ticket; events: TicketEvent[]; }
export interface ApiErrorBody { error: { code: number; message: string } }
export interface CreateTicketBody {
  subject: string; requester: string; ticket_type: TicketType; impact: Level; urgency: Level; is_vip: boolean;
}
```

Check the exact metrics keys against `concierge/sla.py::build_metrics` before committing; the names above are the ones `static/app.js` reads (`open, vip_open, unassigned, at_risk, breaching, sla_met_pct, mttr_min, resolved`).

- [ ] **Step 2: Write the failing client test**

`frontend/src/api/client.test.ts`:

```ts
import { http, HttpResponse } from "msw";
import { server } from "../test/handlers";
import { api, ApiError } from "./client";

test("GET returns parsed JSON", async () => {
  server.use(http.get("/api/meta", () => HttpResponse.json({ ok: 1 })));
  await expect(api<{ ok: number }>("/api/meta")).resolves.toEqual({ ok: 1 });
});

test("mutations send JSON body and X-Agent header", async () => {
  let seenAgent = "";
  let seenBody: unknown = null;
  server.use(
    http.post("/api/tickets", async ({ request }) => {
      seenAgent = request.headers.get("X-Agent") ?? "";
      seenBody = await request.json();
      return HttpResponse.json({ id: 1 }, { status: 201 });
    }),
  );
  await api("/api/tickets", { method: "POST", body: { subject: "x" }, agent: "Priya Natarajan" });
  expect(seenAgent).toBe("Priya Natarajan");
  expect(seenBody).toEqual({ subject: "x" });
});

test("error envelope becomes ApiError with the server message", async () => {
  server.use(http.patch("/api/tickets/9", () => HttpResponse.json({ error: { code: 400, message: "cannot move" } }, { status: 400 })));
  await expect(api("/api/tickets/9", { method: "PATCH", body: {} })).rejects.toMatchObject({ code: 400, message: "cannot move" });
  await expect(api("/api/tickets/9", { method: "PATCH", body: {} })).rejects.toBeInstanceOf(ApiError);
});

test("non-JSON failure gets a generic message", async () => {
  server.use(http.get("/api/tickets", () => new HttpResponse("<html>502</html>", { status: 502 })));
  await expect(api("/api/tickets")).rejects.toMatchObject({ message: "Request failed (502)" });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/api`
Expected: FAIL, cannot find module `./client`.

- [ ] **Step 4: Implement the client**

`frontend/src/api/client.ts`:

```ts
import type { ApiErrorBody } from "./types";

export class ApiError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

export interface ApiOptions {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  agent?: string;
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === "object" && value !== null && "error" in value;
}

export async function api<T>(path: string, { method = "GET", body, agent = "" }: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
    headers["X-Agent"] = agent; // cosmetic actor attribution; server falls back to "System"
  }
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message = isErrorBody(data) ? data.error.message : `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/api`
Expected: 4 passing.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api
git commit -m "feat(frontend): typed API client and server types"
```

---

### Task 3: Pure SLA math and formatters

**Files:**
- Create: `frontend/src/lib/format.ts`, `frontend/src/lib/sla.ts`
- Test: `frontend/src/lib/format.test.ts`, `frontend/src/lib/sla.test.ts`, `frontend/src/test/fixtures.ts`

**Interfaces:**
- Produces: `fmtClock(min: number): string`, `fmtAge(iso: string, nowMs: number): string`, `fmtRelative(iso, nowMs)`, `fmtDeskTime(nowMs)`, `clamp01(x)`; `isOpen(t: Ticket): boolean`, `liveSla(t: Ticket, nowMs: number): LiveSla`, `queueSortKey(t, priorities: Priority[]): [number, number, string]`, `compareKeys(a, b): number`, `QUICK_ACTION: Partial<Record<State, {label: string; state: State}>>`, `makeTicket(overrides): Ticket` fixture.

- [ ] **Step 1: Fixtures**

`frontend/src/test/fixtures.ts`:

```ts
import type { Meta, Metrics, Ticket, TicketEvent } from "../api/types";

export const NOW_ISO = "2026-09-18T12:00:00+00:00";
export const NOW_MS = Date.parse(NOW_ISO);

export const meta: Meta = {
  types: ["Incident", "Request", "Problem", "Change"],
  states: ["New", "In Progress", "On Hold", "Resolved", "Closed"],
  priorities: ["Critical", "High", "Medium", "Low"],
  impacts: ["High", "Medium", "Low"],
  urgencies: ["High", "Medium", "Low"],
  priority_matrix: {
    "High|High": "Critical", "High|Medium": "High", "High|Low": "Medium",
    "Medium|High": "High", "Medium|Medium": "Medium", "Medium|Low": "Low",
    "Low|High": "Medium", "Low|Medium": "Low", "Low|Low": "Low",
  },
  sla_targets: { Critical: 30, High: 60, Medium: 240, Low: 480 },
  transitions: {
    New: ["In Progress", "On Hold", "Resolved"],
    "In Progress": ["On Hold", "Resolved"],
    "On Hold": ["In Progress", "Resolved"],
    Resolved: ["Closed"],
    Closed: [],
  },
  agents: [
    { name: "Priya Natarajan", initials: "PN", color: "#7c5cff" },
    { name: "Marcus Bell", initials: "MB", color: "#2fbf71" },
  ],
};

export function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 1, number: "INC-1001", subject: "VPN down", requester: "Dana K", ticket_type: "Incident",
    impact: "Medium", urgency: "Medium", priority: "Medium", state: "New", is_vip: false,
    assigned_to: null, created_at: "2026-09-18T11:00:00+00:00", resolved_at: null, closed_at: null,
    on_hold_since: null, held_minutes: 0, reopened_count: 0, sla_target_min: 240, sla_elapsed_min: 60,
    sla_remaining_min: 180, sla_status: "ok", sla_met: null, ...overrides,
  };
}

export const metrics: Metrics = { open: 3, vip_open: 1, unassigned: 2, at_risk: 1, breaching: 0, sla_met_pct: 92, mttr_min: 41.5, resolved: 4 };

export const events: TicketEvent[] = [
  { id: 2, actor: "Priya Natarajan", event_type: "work_note", detail: "Checked the tunnel", created_at: "2026-09-18T11:30:00+00:00" },
  { id: 1, actor: "System", event_type: "created", detail: "Ticket created — Medium Incident", created_at: "2026-09-18T11:00:00+00:00" },
];
```

- [ ] **Step 2: Failing format tests**

`frontend/src/lib/format.test.ts`:

```ts
import { clamp01, fmtAge, fmtClock, fmtDeskTime, fmtRelative } from "./format";
import { NOW_MS } from "../test/fixtures";

test.each([
  [0, "00:00"], [1.5, "01:30"], [-3, "00:00"], [90.25, "90:15"],
])("fmtClock(%s) = %s", (min, out) => expect(fmtClock(min)).toBe(out));

test("fmtAge buckets minutes, hours, days", () => {
  expect(fmtAge("2026-09-18T11:45:00+00:00", NOW_MS)).toBe("15m");
  expect(fmtAge("2026-09-18T09:00:00+00:00", NOW_MS)).toBe("3h");
  expect(fmtAge("2026-09-15T12:00:00+00:00", NOW_MS)).toBe("3d");
  expect(fmtAge("2026-09-18T12:05:00+00:00", NOW_MS)).toBe("0m");
});

test("fmtRelative", () => {
  expect(fmtRelative("2026-09-18T11:59:40+00:00", NOW_MS)).toBe("just now");
  expect(fmtRelative("2026-09-18T11:30:00+00:00", NOW_MS)).toBe("30m ago");
});

test("fmtDeskTime is UTC HH:MM:SS", () => expect(fmtDeskTime(NOW_MS)).toBe("12:00:00"));
test("clamp01", () => { expect(clamp01(-1)).toBe(0); expect(clamp01(0.4)).toBe(0.4); expect(clamp01(9)).toBe(1); });
```

- [ ] **Step 3: Failing sla tests**

`frontend/src/lib/sla.test.ts`:

```ts
import { compareKeys, isOpen, liveSla, queueSortKey, QUICK_ACTION } from "./sla";
import { makeTicket, meta, NOW_MS } from "../test/fixtures";

const min = (n: number) => n * 60_000;

test("isOpen", () => {
  expect(isOpen(makeTicket({ state: "On Hold" }))).toBe(true);
  expect(isOpen(makeTicket({ state: "Resolved" }))).toBe(false);
});

test("ok before 75% of target", () => {
  const t = makeTicket({ created_at: new Date(NOW_MS - min(60)).toISOString(), sla_target_min: 240 });
  const s = liveSla(t, NOW_MS);
  expect(s.status).toBe("ok");
  expect(s.remainingMin).toBeCloseTo(180, 5);
});

test("at_risk at exactly 75%", () => {
  const t = makeTicket({ created_at: new Date(NOW_MS - min(180)).toISOString(), sla_target_min: 240 });
  expect(liveSla(t, NOW_MS).status).toBe("at_risk");
});

test("breached past target, even while On Hold", () => {
  const t = makeTicket({ state: "On Hold", created_at: new Date(NOW_MS - min(300)).toISOString(), on_hold_since: new Date(NOW_MS - min(5)).toISOString(), sla_target_min: 240 });
  expect(liveSla(t, NOW_MS).status).toBe("breached");
});

test("paused subtracts held time and the open hold", () => {
  const t = makeTicket({ state: "On Hold", created_at: new Date(NOW_MS - min(100)).toISOString(), held_minutes: 30, on_hold_since: new Date(NOW_MS - min(10)).toISOString(), sla_target_min: 240 });
  const s = liveSla(t, NOW_MS);
  expect(s.status).toBe("paused");
  expect(s.elapsedMin).toBeCloseTo(60, 5);
});

test("done tickets echo server values", () => {
  const t = makeTicket({ state: "Resolved", sla_status: "met", sla_elapsed_min: 42 });
  expect(liveSla(t, NOW_MS)).toEqual({ elapsedMin: 42, remainingMin: null, status: "met" });
});

test("queue sort: VIP first, then priority rank, then created_at", () => {
  const vipLow = makeTicket({ is_vip: true, priority: "Low", created_at: "2026-09-18T11:00:00+00:00" });
  const crit = makeTicket({ priority: "Critical", created_at: "2026-09-18T10:00:00+00:00" });
  expect(compareKeys(queueSortKey(vipLow, meta.priorities), queueSortKey(crit, meta.priorities))).toBeLessThan(0);
  const older = makeTicket({ priority: "High", created_at: "2026-09-18T09:00:00+00:00" });
  const newer = makeTicket({ priority: "High", created_at: "2026-09-18T10:00:00+00:00" });
  expect(compareKeys(queueSortKey(older, meta.priorities), queueSortKey(newer, meta.priorities))).toBeLessThan(0);
});

test("quick actions per state", () => {
  expect(QUICK_ACTION["New"]).toEqual({ label: "Start", state: "In Progress" });
  expect(QUICK_ACTION["Resolved"]).toBeUndefined();
});
```

- [ ] **Step 4: Run to verify failures**

Run: `npx vitest run src/lib`
Expected: FAIL, modules not found.

- [ ] **Step 5: Implement format.ts**

```ts
export function fmtClock(minutes: number): string {
  const totalSec = Math.max(0, Math.round(minutes * 60));
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function fmtAge(iso: string, nowMs: number): string {
  const mins = Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function fmtRelative(iso: string, nowMs: number): string {
  const mins = Math.floor((nowMs - Date.parse(iso)) / 60000);
  return mins < 1 ? "just now" : `${fmtAge(iso, nowMs)} ago`;
}

export function fmtDeskTime(nowMs: number): string {
  const d = new Date(nowMs);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
```

- [ ] **Step 6: Implement sla.ts**

```ts
import type { Priority, SlaStatus, State, Ticket } from "../api/types";

export const OPEN_STATES: readonly State[] = ["New", "In Progress", "On Hold"];
export const isOpen = (t: Ticket): boolean => OPEN_STATES.includes(t.state);

export interface LiveSla { elapsedMin: number; remainingMin: number | null; status: SlaStatus; }

// Client-side mirror of the backend ramp, evaluated every second so clocks
// never freeze between polls. Breach is sticky even On Hold.
export function liveSla(t: Ticket, nowMs: number): LiveSla {
  if (!isOpen(t)) return { elapsedMin: t.sla_elapsed_min, remainingMin: null, status: t.sla_status };
  let elapsedMin = (nowMs - Date.parse(t.created_at)) / 60000 - t.held_minutes;
  if (t.on_hold_since) elapsedMin -= (nowMs - Date.parse(t.on_hold_since)) / 60000;
  const remainingMin = t.sla_target_min - elapsedMin;
  let status: SlaStatus;
  if (elapsedMin > t.sla_target_min) status = "breached";
  else if (t.state === "On Hold") status = "paused";
  else if (elapsedMin / t.sla_target_min >= 0.75) status = "at_risk";
  else status = "ok";
  return { elapsedMin, remainingMin, status };
}

export type SortKey = [number, number, string];

export function queueSortKey(t: Ticket, priorities: readonly Priority[]): SortKey {
  const rank = priorities.indexOf(t.priority);
  return [t.is_vip ? 0 : 1, rank === -1 ? 99 : rank, t.created_at];
}

export function compareKeys(a: SortKey, b: SortKey): number {
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

export const QUICK_ACTION: Partial<Record<State, { label: string; state: State }>> = {
  New: { label: "Start", state: "In Progress" },
  "In Progress": { label: "Resolve", state: "Resolved" },
  "On Hold": { label: "Resume", state: "In Progress" },
};
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run src/lib`
Expected: all passing.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib frontend/src/test/fixtures.ts
git commit -m "feat(frontend): SLA math and formatters with tests"
```

---

### Task 4: Store helpers, NowProvider, acting agent, meta, TopBar

**Files:**
- Create: `frontend/src/lib/store.ts`, `frontend/src/hooks/useNow.tsx`, `frontend/src/hooks/useActingAgent.ts`, `frontend/src/hooks/useMeta.ts`, `frontend/src/hooks/useReducedMotion.ts`, `frontend/src/components/Avatar.tsx`, `frontend/src/components/AgentPicker.tsx`, `frontend/src/components/TopBar.tsx`, `frontend/src/test/render.tsx`
- Test: `frontend/src/lib/store.test.ts`, `frontend/src/hooks/useMeta.test.tsx`, `frontend/src/components/TopBar.test.tsx`
- Modify: `frontend/src/test/handlers.ts`

**Interfaces:**
- Produces:
  - `Store { tickets: ReadonlyMap<number, Ticket>; queueIds: number[]; resolvedIds: number[]; metrics: Metrics | null; loaded: boolean; offline: boolean; clockOffsetMs: number }`, `emptyStore(): Store`, `replaceAll(store, res: TicketsResponse): Store`, `applyTicket(store, t, priorities): Store`, `applyLocalTransition(t, next, nowMs, actingAgent, agentNames): Ticket`.
  - `NowProvider({ offsetMs, children })`, `useNow(): number` (server-adjusted ms, ticks each second).
  - `useActingAgent(meta: Meta | null): [name: string, set: (n: string) => void]`.
  - `useMeta(): Meta | null`.
  - `useReducedMotion(): boolean`.
  - `Avatar({ agent, unassignedTitle? })`, `AgentPicker({ meta, value, onChange })`, `TopBar({ meta, offline, actingAgent, onAgentChange })`.
  - `renderWithProviders(ui, { nowMs? })` test helper.

- [ ] **Step 1: Failing store tests**

`frontend/src/lib/store.test.ts`:

```ts
import { applyLocalTransition, applyTicket, emptyStore, replaceAll } from "./store";
import { makeTicket, meta, metrics, NOW_ISO, NOW_MS } from "../test/fixtures";

test("replaceAll loads queue and resolved ids in server order and stores the clock offset", () => {
  const a = makeTicket({ id: 1 }); const b = makeTicket({ id: 2, is_vip: true }); const r = makeTicket({ id: 3, state: "Resolved" });
  const s = replaceAll(emptyStore(), { now: NOW_ISO, queue: [b, a], resolved: [r], metrics });
  expect(s.queueIds).toEqual([2, 1]);
  expect(s.resolvedIds).toEqual([3]);
  expect(s.loaded).toBe(true);
  expect(s.offline).toBe(false);
  expect(Math.abs(s.clockOffsetMs - (NOW_MS - Date.now()))).toBeLessThan(2000);
});

test("applyTicket inserts an open ticket in sort position and moves done tickets to resolved", () => {
  const low = makeTicket({ id: 1, priority: "Low" });
  const s0 = replaceAll(emptyStore(), { now: NOW_ISO, queue: [low], resolved: [], metrics });
  const crit = makeTicket({ id: 2, priority: "Critical" });
  const s1 = applyTicket(s0, crit, meta.priorities);
  expect(s1.queueIds).toEqual([2, 1]);
  const s2 = applyTicket(s1, { ...crit, state: "Resolved" }, meta.priorities);
  expect(s2.queueIds).toEqual([1]);
  expect(s2.resolvedIds).toEqual([2]);
  expect(s0.queueIds).toEqual([1]); // immutability
});

test("applyLocalTransition mirrors hold accounting, resolve freeze, and auto-assign", () => {
  const held = makeTicket({ state: "On Hold", on_hold_since: new Date(NOW_MS - 10 * 60000).toISOString(), held_minutes: 5 });
  const resumed = applyLocalTransition(held, "In Progress", NOW_MS, "Priya Natarajan", ["Priya Natarajan"]);
  expect(resumed.held_minutes).toBeCloseTo(15, 3);
  expect(resumed.on_hold_since).toBeNull();
  expect(resumed.assigned_to).toBe("Priya Natarajan");
  const resolved = applyLocalTransition(makeTicket({ created_at: new Date(NOW_MS - 30 * 60000).toISOString(), sla_target_min: 60 }), "Resolved", NOW_MS, "", []);
  expect(resolved.sla_met).toBe(true);
  expect(resolved.sla_status).toBe("met");
  expect(resolved.resolved_at).not.toBeNull();
  expect(held.state).toBe("On Hold"); // input untouched
});
```

- [ ] **Step 2: Implement store.ts**

```ts
import type { Metrics, Priority, State, Ticket, TicketsResponse } from "../api/types";
import { compareKeys, isOpen, queueSortKey } from "./sla";

export interface Store {
  tickets: ReadonlyMap<number, Ticket>;
  queueIds: number[];
  resolvedIds: number[];
  metrics: Metrics | null;
  loaded: boolean;
  offline: boolean;
  clockOffsetMs: number;
}

export function emptyStore(): Store {
  return { tickets: new Map(), queueIds: [], resolvedIds: [], metrics: null, loaded: false, offline: false, clockOffsetMs: 0 };
}

export function replaceAll(store: Store, res: TicketsResponse): Store {
  const tickets = new Map<number, Ticket>();
  for (const t of [...res.queue, ...res.resolved]) tickets.set(t.id, t);
  return {
    ...store,
    tickets,
    queueIds: res.queue.map((t) => t.id),
    resolvedIds: res.resolved.map((t) => t.id),
    metrics: res.metrics,
    loaded: true,
    offline: false,
    clockOffsetMs: Date.parse(res.now) - Date.now(),
  };
}

// Put a ticket in the right membership list after a local mutation. Open
// tickets slot by sort key until the next poll restores server order.
export function applyTicket(store: Store, t: Ticket, priorities: readonly Priority[]): Store {
  const tickets = new Map(store.tickets);
  tickets.set(t.id, t);
  const queueIds = store.queueIds.filter((id) => id !== t.id);
  const resolvedIds = store.resolvedIds.filter((id) => id !== t.id);
  if (isOpen(t)) {
    const key = queueSortKey(t, priorities);
    const idx = queueIds.findIndex((id) => {
      const other = tickets.get(id);
      return other !== undefined && compareKeys(key, queueSortKey(other, priorities)) < 0;
    });
    if (idx === -1) queueIds.push(t.id);
    else queueIds.splice(idx, 0, t.id);
  } else {
    resolvedIds.unshift(t.id);
  }
  return { ...store, tickets, queueIds, resolvedIds };
}

// Local mirror of the backend transition side effects so the UI is truthful
// in the gap before the PATCH response reconciles it.
export function applyLocalTransition(t: Ticket, next: State, nowMs: number, actingAgent: string, agentNames: readonly string[]): Ticket {
  const iso = new Date(nowMs).toISOString();
  let out: Ticket = { ...t };
  if (out.on_hold_since) {
    out = { ...out, held_minutes: out.held_minutes + (nowMs - Date.parse(out.on_hold_since)) / 60000, on_hold_since: null };
  }
  if (next === "On Hold") out = { ...out, on_hold_since: iso };
  if (next === "Resolved") {
    const elapsed = (nowMs - Date.parse(out.created_at)) / 60000 - out.held_minutes;
    const met = out.sla_met === null ? elapsed <= out.sla_target_min : out.sla_met;
    out = { ...out, resolved_at: iso, sla_elapsed_min: Math.round(elapsed * 10) / 10, sla_remaining_min: null, sla_met: met, sla_status: met ? "met" : "missed" };
  }
  if (next === "Closed") out = { ...out, closed_at: iso };
  if (next === "In Progress" && !out.assigned_to && agentNames.includes(actingAgent)) {
    out = { ...out, assigned_to: actingAgent };
  }
  return { ...out, state: next };
}
```

- [ ] **Step 3: Run store tests**

Run: `npx vitest run src/lib/store`
Expected: 3 passing.

- [ ] **Step 4: NowProvider, reduced motion, acting agent**

`frontend/src/hooks/useNow.tsx`:

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const NowContext = createContext<number>(Date.now());

export function NowProvider({ offsetMs, children }: { offsetMs: number; children: ReactNode }) {
  const [nowMs, setNowMs] = useState(() => Date.now() + offsetMs);
  useEffect(() => {
    setNowMs(Date.now() + offsetMs);
    const id = setInterval(() => setNowMs(Date.now() + offsetMs), 1000);
    return () => clearInterval(id);
  }, [offsetMs]);
  return <NowContext.Provider value={nowMs}>{children}</NowContext.Provider>;
}

// Server-adjusted wall clock. Every time-derived value in the UI uses this.
export const useNow = (): number => useContext(NowContext);
```

`frontend/src/hooks/useReducedMotion.ts`:

```ts
import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(QUERY);
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
```

`frontend/src/hooks/useActingAgent.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import type { Meta } from "../api/types";

export const AGENT_STORAGE_KEY = "concierge.actingAgent";

function stored(): string {
  try { return localStorage.getItem(AGENT_STORAGE_KEY) ?? ""; } catch { return ""; }
}

export function useActingAgent(meta: Meta | null): [string, (name: string) => void] {
  const [name, setName] = useState(stored);
  useEffect(() => {
    if (!meta) return;
    const known = meta.agents.some((a) => a.name === name);
    if (!known) setName(meta.agents[0]?.name ?? "");
  }, [meta, name]);
  const set = useCallback((next: string) => {
    setName(next);
    try { localStorage.setItem(AGENT_STORAGE_KEY, next); } catch { /* private mode */ }
  }, []);
  return [name, set];
}
```

- [ ] **Step 5: MSW handlers and render helper**

Replace `frontend/src/test/handlers.ts`:

```ts
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { events, makeTicket, meta, metrics, NOW_ISO } from "./fixtures";

export const queueFixture = [
  makeTicket({ id: 2, number: "INC-1002", subject: "CEO laptop", requester: "Sam V", is_vip: true, priority: "High", sla_target_min: 30, created_at: "2026-09-18T11:50:00+00:00" }),
  makeTicket({ id: 1 }),
  makeTicket({ id: 3, number: "REQ-1003", subject: "Monitor request", ticket_type: "Request", state: "On Hold", on_hold_since: "2026-09-18T11:55:00+00:00", assigned_to: "Marcus Bell" }),
];
export const resolvedFixture = [makeTicket({ id: 4, number: "INC-0999", subject: "Printer jam", state: "Resolved", sla_status: "met", sla_elapsed_min: 22, sla_met: true, resolved_at: "2026-09-18T10:00:00+00:00" })];

export const handlers = [
  http.get("/api/meta", () => HttpResponse.json(meta)),
  http.get("/api/tickets", () => HttpResponse.json({ now: NOW_ISO, queue: queueFixture, resolved: resolvedFixture, metrics })),
  http.get("/api/tickets/:id", ({ params }) => {
    const id = Number(params["id"]);
    const t = [...queueFixture, ...resolvedFixture].find((x) => x.id === id);
    return t ? HttpResponse.json({ now: NOW_ISO, ticket: t, events }) : HttpResponse.json({ error: { code: 404, message: "not found" } }, { status: 404 });
  }),
];

export const server = setupServer(...handlers);
```

`frontend/src/test/render.tsx`:

```tsx
import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";
import { NowProvider } from "../hooks/useNow";
import { ToastProvider } from "../components/Toasts";

export function renderWithProviders(ui: ReactElement, options?: RenderOptions) {
  return render(<NowProvider offsetMs={0}><ToastProvider>{ui}</ToastProvider></NowProvider>, options);
}
```

(`ToastProvider` is created in Task 6; until then create `frontend/src/components/Toasts.tsx` with the full implementation from Task 6 Step 2 now, since TopBar tests need the provider tree. Do that here and skip the file creation in Task 6.)

- [ ] **Step 6: Failing useMeta test**

`frontend/src/hooks/useMeta.test.tsx`:

```tsx
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../test/handlers";
import { meta } from "../test/fixtures";
import { useMeta } from "./useMeta";

test("loads meta", async () => {
  const { result } = renderHook(() => useMeta());
  await waitFor(() => expect(result.current?.agents).toHaveLength(2));
});

test("retries after a failure", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let calls = 0;
  server.use(http.get("/api/meta", () => (++calls === 1 ? HttpResponse.error() : HttpResponse.json(meta))));
  const { result } = renderHook(() => useMeta());
  await vi.advanceTimersByTimeAsync(3500);
  await waitFor(() => expect(result.current).not.toBeNull());
  expect(calls).toBe(2);
  vi.useRealTimers();
});
```

- [ ] **Step 7: Implement useMeta**

```ts
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Meta } from "../api/types";

export const META_RETRY_MS = 3000;

// Nothing renders without meta, so retry quietly until it lands.
export function useMeta(): Meta | null {
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const m = await api<Meta>("/api/meta");
        if (!cancelled) setMeta(m);
      } catch {
        if (!cancelled) timer = setTimeout(load, META_RETRY_MS);
      }
    };
    void load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);
  return meta;
}
```

- [ ] **Step 8: Failing TopBar test**

`frontend/src/components/TopBar.test.tsx`:

```tsx
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
```

- [ ] **Step 9: Implement Avatar, AgentPicker, TopBar**

`frontend/src/components/Avatar.tsx`:

```tsx
import type { Agent } from "../api/types";

export function Avatar({ agent, title }: { agent: Agent | null; title?: string }) {
  if (!agent) return <span className="avatar unassigned" title={title ?? "Unassigned"}>&middot;</span>;
  return <span className="avatar" style={{ background: agent.color }} title={title ?? agent.name}>{agent.initials}</span>;
}

export const agentByName = (agents: readonly Agent[], name: string | null): Agent | null =>
  agents.find((a) => a.name === name) ?? null;
```

`frontend/src/components/AgentPicker.tsx`:

```tsx
import type { Meta } from "../api/types";
import { agentByName } from "./Avatar";

interface Props { meta: Meta; value: string; onChange: (name: string) => void; }

export function AgentPicker({ meta, value, onChange }: Props) {
  const agent = agentByName(meta.agents, value);
  return (
    <label className="agent-picker" title="Cosmetic identity — sent as X-Agent on every action">
      <span className="agent-picker-label">Acting as</span>
      <span className="avatar" aria-hidden="true" style={{ background: agent?.color ?? "" }}>{agent?.initials ?? "?"}</span>
      <select aria-label="Acting as agent" value={value} onChange={(e) => onChange(e.target.value)}>
        {meta.agents.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
      </select>
    </label>
  );
}
```

`frontend/src/components/TopBar.tsx`:

```tsx
import type { Meta } from "../api/types";
import { fmtDeskTime } from "../lib/format";
import { useNow } from "../hooks/useNow";
import { AgentPicker } from "./AgentPicker";

interface Props { meta: Meta | null; offline: boolean; actingAgent: string; onAgentChange: (name: string) => void; }

export function TopBar({ meta, offline, actingAgent, onAgentChange }: Props) {
  const nowMs = useNow();
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-glyph" aria-hidden="true">&#9670;</span>
        <span className="brand-name">Concierge</span>
        <span className="tagline">VIP-aware service desk</span>
      </div>
      <div className="topbar-right">
        <span className="reconnect-pill" hidden={!offline}>Reconnecting…</span>
        <span className="topbar-hint">Press <kbd>?</kbd> for shortcuts</span>
        <span className="desk-time">Desk time <span className="num">{fmtDeskTime(nowMs)}</span> UTC</span>
        {meta && <AgentPicker meta={meta} value={actingAgent} onChange={onAgentChange} />}
      </div>
    </header>
  );
}
```

- [ ] **Step 10: Run all frontend tests, lint, typecheck**

Run: `npm run lint && npm run typecheck && npx vitest run`
Expected: all passing.

- [ ] **Step 11: Commit**

```bash
git add frontend/src
git commit -m "feat(frontend): store helpers, now provider, acting agent, meta hook, top bar"
```

---

### Task 5: useTickets read path and the queue

**Files:**
- Create: `frontend/src/hooks/useTickets.ts`, `frontend/src/components/Queue.tsx`, `QueueToolbar.tsx`, `QueueRow.tsx`, `SlaInstrument.tsx`, `ResolvedList.tsx`, `DoneRow.tsx`, `EmptyState.tsx`
- Test: `frontend/src/hooks/useTickets.test.tsx`, `frontend/src/components/Queue.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Produces: `useTickets(opts: { actingAgent: string; priorities: readonly Priority[]; agentNames: readonly string[]; transitions: Meta["transitions"] | null; toast: ToastFn })` returning `{ store, refresh(): Promise<void>, createTicket(body): Promise<Ticket>, changeState(id, next): Promise<void>, assignTicket(id, name | null): Promise<void>, reopenTicket(id): Promise<Ticket | null>, resetDemo(): Promise<string> }` (mutations implemented in Task 6; this task ships `store`, `refresh`, and the polling).
- `POLL_MS = 15000`.
- `Queue({ store, meta, filter, search, onFilter, onSearch, selectedId, onSelect, onOpen, onTake, onQuickState })`, `QueueFilter = "all" | "vip" | "at_risk" | "unassigned"`, `visibleQueueIds(store, filter, search, nowMs): number[]`, `filterCounts(store, nowMs)`.

- [ ] **Step 1: Failing useTickets read tests**

`frontend/src/hooks/useTickets.test.tsx`:

```tsx
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../test/handlers";
import { meta } from "../test/fixtures";
import { POLL_MS, useTickets } from "./useTickets";

const opts = { actingAgent: "Priya Natarajan", priorities: meta.priorities, agentNames: meta.agents.map((a) => a.name), transitions: meta.transitions, toast: vi.fn() };

test("first poll loads the store in server order", async () => {
  const { result } = renderHook(() => useTickets(opts));
  await waitFor(() => expect(result.current.store.loaded).toBe(true));
  expect(result.current.store.queueIds).toEqual([2, 1, 3]);
  expect(result.current.store.resolvedIds).toEqual([4]);
  expect(result.current.store.metrics?.open).toBe(3);
});

test("a failed poll keeps data and flags offline; next success clears it", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { result } = renderHook(() => useTickets(opts));
  await waitFor(() => expect(result.current.store.loaded).toBe(true));
  server.use(http.get("/api/tickets", () => HttpResponse.error(), { once: true }));
  await vi.advanceTimersByTimeAsync(POLL_MS + 50);
  await waitFor(() => expect(result.current.store.offline).toBe(true));
  expect(result.current.store.queueIds).toEqual([2, 1, 3]);
  await vi.advanceTimersByTimeAsync(POLL_MS + 50);
  await waitFor(() => expect(result.current.store.offline).toBe(false));
  vi.useRealTimers();
});
```

- [ ] **Step 2: Implement the read path of useTickets**

`frontend/src/hooks/useTickets.ts` (mutations added in Task 6; leave the exported names in place as stubs that throw `new Error("not implemented")` so Task 6 replaces them):

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { CreateTicketBody, Meta, Priority, State, Ticket, TicketsResponse } from "../api/types";
import { emptyStore, replaceAll, type Store } from "../lib/store";
import type { ToastFn } from "../components/Toasts";

export const POLL_MS = 15000;

export interface UseTicketsOptions {
  actingAgent: string;
  priorities: readonly Priority[];
  agentNames: readonly string[];
  transitions: Meta["transitions"] | null;
  toast: ToastFn;
}

export interface TicketActions {
  store: Store;
  refresh: () => Promise<void>;
  createTicket: (body: CreateTicketBody) => Promise<Ticket>;
  changeState: (id: number, next: State) => Promise<void>;
  assignTicket: (id: number, name: string | null) => Promise<void>;
  reopenTicket: (id: number) => Promise<Ticket | null>;
  resetDemo: () => Promise<string>;
}

export function useTickets(opts: UseTicketsOptions): TicketActions {
  const [store, setStore] = useState<Store>(emptyStore);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const refresh = useCallback(async () => {
    try {
      const res = await api<TicketsResponse>("/api/tickets");
      setStore((s) => replaceAll(s, res));
    } catch {
      setStore((s) => ({ ...s, offline: true })); // keep last known state on screen
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const notImplemented = async (): Promise<never> => { throw new Error("not implemented"); };

  return { store, refresh, createTicket: notImplemented, changeState: notImplemented, assignTicket: notImplemented, reopenTicket: notImplemented, resetDemo: notImplemented };
}
```

- [ ] **Step 3: Run the hook tests**

Run: `npx vitest run src/hooks/useTickets`
Expected: 2 passing.

- [ ] **Step 4: Failing Queue tests**

`frontend/src/components/Queue.test.tsx`:

```tsx
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
  return <Queue store={store} meta={meta} filter={filter} search={search} onFilter={setFilter} onSearch={setSearch} selectedId={null} onSelect={vi.fn()} onOpen={vi.fn()} onTake={vi.fn()} onQuickState={vi.fn()} />;
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
  renderWithProviders(<Queue store={store} meta={meta} filter="all" search="" onFilter={vi.fn()} onSearch={vi.fn()} selectedId={null} onSelect={vi.fn()} onOpen={vi.fn()} onTake={onTake} onQuickState={onQuickState} />);
  const first = screen.getAllByTestId("queue-row")[0]!;
  await userEvent.click(within(first).getByRole("button", { name: "Take" }));
  expect(onTake).toHaveBeenCalledWith(2);
  await userEvent.click(within(first).getByRole("button", { name: "Start" }));
  expect(onQuickState).toHaveBeenCalledWith(2, "In Progress");
});
```

- [ ] **Step 5: Implement the queue components**

`frontend/src/components/EmptyState.tsx`:

```tsx
export function QueueClear() {
  return (
    <div className="empty-state">
      <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">
        <circle cx="24" cy="24" r="22" fill="none" stroke="var(--ok)" strokeWidth="2" />
        <path d="M15 24.5l6 6 12-13" fill="none" stroke="var(--ok)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p className="empty-title">Queue clear</p>
      <p className="empty-sub">New tickets appear here, sorted VIP first.</p>
    </div>
  );
}

export function NoMatch() {
  return <div className="empty-state slim"><p className="empty-sub">No open tickets match this view.</p></div>;
}
```

`frontend/src/components/SlaInstrument.tsx`:

```tsx
import type { Ticket } from "../api/types";
import { useNow } from "../hooks/useNow";
import { clamp01, fmtClock } from "../lib/format";
import { liveSla } from "../lib/sla";

// One row's SLA clock + bar. Subscribes to the 1 s tick itself so the row
// around it can stay memoized. On Hold rows keep a frozen instrument.
export function SlaInstrument({ ticket }: { ticket: Ticket }) {
  const nowMs = useNow();
  const sla = liveSla(ticket, nowMs);
  let text: string;
  let width: string;
  if (sla.status === "breached") {
    text = `BREACHED +${fmtClock(-(sla.remainingMin ?? 0))}`;
    width = "100%";
  } else if (sla.status === "paused") {
    text = `Paused · ${Math.round(sla.elapsedMin)}m used of ${ticket.sla_target_min}m`;
    width = `${clamp01((sla.remainingMin ?? 0) / ticket.sla_target_min) * 100}%`;
  } else {
    text = fmtClock(sla.remainingMin ?? 0);
    width = `${clamp01((sla.remainingMin ?? 0) / ticket.sla_target_min) * 100}%`;
  }
  return (
    <span className="cell sla">
      <span className="clock num">{text}</span>
      <span className="bar"><i style={{ width }} /></span>
    </span>
  );
}

export function slaRowClass(ticket: Ticket, nowMs: number): string {
  const s = liveSla(ticket, nowMs).status;
  return s === "breached" ? "sla-breached" : s === "paused" ? "sla-paused" : s === "at_risk" ? "sla-at-risk" : "";
}
```

`frontend/src/components/QueueRow.tsx`:

```tsx
import { memo } from "react";
import type { Meta, State, Ticket } from "../api/types";
import { useNow } from "../hooks/useNow";
import { fmtAge } from "../lib/format";
import { QUICK_ACTION } from "../lib/sla";
import { Avatar, agentByName } from "./Avatar";
import { SlaInstrument, slaRowClass } from "./SlaInstrument";

interface Props {
  ticket: Ticket; meta: Meta; selected: boolean;
  onSelect: (id: number) => void; onOpen: (id: number) => void;
  onTake: (id: number) => void; onQuickState: (id: number, next: State) => void;
}

function Age({ iso }: { iso: string }) {
  const nowMs = useNow();
  return <span className="cell age num">{fmtAge(iso, nowMs)}</span>;
}

function RowClass({ ticket, children, selected }: { ticket: Ticket; selected: boolean; children: React.ReactNode }) {
  const nowMs = useNow();
  const cls = ["row", ticket.is_vip ? "is-vip" : "", !ticket.is_vip && ticket.priority === "Critical" ? "is-crit" : "", selected ? "selected" : "", slaRowClass(ticket, nowMs)].filter(Boolean).join(" ");
  return <div className={cls} data-id={ticket.id} data-testid="queue-row">{children}</div>;
}

export const QueueRow = memo(function QueueRow({ ticket: t, meta, selected, onSelect, onOpen, onTake, onQuickState }: Props) {
  const quick = QUICK_ACTION[t.state];
  const glyphTitle = `${t.priority} — Impact ${t.impact} / Urgency ${t.urgency}`;
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div onClick={() => { onSelect(t.id); onOpen(t.id); }}>
      <RowClass ticket={t} selected={selected}>
        <span className="cell number num">{t.number}</span>
        <span className="cell glyph"><i className={`pglyph p-${t.priority.toLowerCase()}`} title={glyphTitle} /></span>
        <span className="cell subject">
          <span className="subject-text" title={t.subject}>{t.subject}</span>
          <span className="requester">{t.requester}</span>
          {t.reopened_count > 0 && <span className="tag-reopened">Reopened ×{t.reopened_count}</span>}
          <span className="row-actions">
            {!t.assigned_to && <button type="button" className="ghost" onClick={(e) => { stop(e); onTake(t.id); }}>Take</button>}
            {quick && <button type="button" className="ghost" onClick={(e) => { stop(e); onQuickState(t.id, quick.state); }}>{quick.label}</button>}
          </span>
        </span>
        <span className="cell"><span className="type-tag">{t.ticket_type}</span></span>
        <span className="cell assignee"><Avatar agent={agentByName(meta.agents, t.assigned_to)} /></span>
        <span className="cell vip">{t.is_vip && <span className="vip-star" title="VIP — SLA target halved">&#9733;</span>}</span>
        <Age iso={t.created_at} />
        <SlaInstrument ticket={t} />
      </RowClass>
    </div>
  );
});
```

Note: the wrapper `div` with the click handler must not carry the `.row` class; if the stylesheet's `.queue > .row` selectors break layout, move the `onClick` onto the `RowClass` div instead and drop the wrapper. Verify visually in Step 8.

`frontend/src/components/DoneRow.tsx`:

```tsx
import type { Meta, Ticket } from "../api/types";
import { useNow } from "../hooks/useNow";
import { fmtAge } from "../lib/format";
import { Avatar, agentByName } from "./Avatar";

const Lock = () => (
  <svg className="lock" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
    <rect x="2" y="5" width="8" height="6" rx="1" fill="currentColor" />
    <path d="M4 5V3.5a2 2 0 0 1 4 0V5" fill="none" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

export function DoneRow({ ticket: t, meta, onOpen }: { ticket: Ticket; meta: Meta; onOpen: (id: number) => void }) {
  const nowMs = useNow();
  const mins = Math.round(t.sla_elapsed_min);
  const lock = t.state === "Closed" ? <Lock /> : null;
  return (
    <div className={`row done ${t.is_vip ? "is-vip" : ""}`} data-id={t.id} onClick={() => onOpen(t.id)}>
      <span className="cell number num">{t.number}</span>
      <span className="cell glyph"><i className={`pglyph p-${t.priority.toLowerCase()}`} title={t.priority} /></span>
      <span className="cell subject">
        <span className="subject-text" title={t.subject}>{t.subject}</span>
        <span className="requester">{t.requester}</span>
        {t.reopened_count > 0 && <span className="tag-reopened">Reopened ×{t.reopened_count}</span>}
      </span>
      <span className="cell"><span className="type-tag">{t.ticket_type}</span></span>
      <span className="cell assignee"><Avatar agent={agentByName(meta.agents, t.assigned_to)} /></span>
      <span className="cell vip">{t.is_vip && <span className="vip-star">&#9733;</span>}</span>
      <span className="cell age num">{fmtAge(t.created_at, nowMs)}</span>
      <span className="cell sla">
        {t.sla_status === "met"
          ? <span className="outcome met">{lock}Met in {mins}m</span>
          : <span className="outcome missed">{lock}Missed · {mins}m</span>}
      </span>
    </div>
  );
}
```

`frontend/src/components/ResolvedList.tsx`:

```tsx
import type { Meta, Ticket } from "../api/types";
import { DoneRow } from "./DoneRow";

export function ResolvedList({ tickets, total, meta, onOpen }: { tickets: Ticket[]; total: number; meta: Meta; onOpen: (id: number) => void }) {
  if (tickets.length === 0) return null;
  return (
    <div>
      <h2 className="section-label">Resolved <span className="count num">{total}</span></h2>
      <div className="queue resolved-list">{tickets.map((t) => <DoneRow key={t.id} ticket={t} meta={meta} onOpen={onOpen} />)}</div>
    </div>
  );
}
```

`frontend/src/components/QueueToolbar.tsx`:

```tsx
export type QueueFilter = "all" | "vip" | "at_risk" | "unassigned";
export type FilterCounts = Record<QueueFilter, number>;

interface Props { filter: QueueFilter; counts: FilterCounts; search: string; onFilter: (f: QueueFilter) => void; onSearch: (q: string) => void; }

const LABELS: Record<QueueFilter, string> = { all: "All", vip: "VIP", at_risk: "At risk", unassigned: "Unassigned" };

export function QueueToolbar({ filter, counts, search, onFilter, onSearch }: Props) {
  return (
    <div className="queue-toolbar">
      <div className="segmented" role="group" aria-label="Queue filters">
        {(Object.keys(LABELS) as QueueFilter[]).map((key) => (
          <button key={key} type="button" className={filter === key ? "active" : ""} onClick={() => onFilter(key)}>
            {key === "vip" && <span className="star">&#9733; </span>}{LABELS[key]} <span className="count num">{counts[key]}</span>
          </button>
        ))}
      </div>
      <input id="search" type="search" placeholder="Search subject, requester, number…" aria-label="Search tickets" value={search} onChange={(e) => onSearch(e.target.value)} />
    </div>
  );
}
```

`frontend/src/components/Queue.tsx`:

```tsx
import type { Meta, State, Ticket } from "../api/types";
import { useNow } from "../hooks/useNow";
import { liveSla } from "../lib/sla";
import type { Store } from "../lib/store";
import { QueueClear, NoMatch } from "./EmptyState";
import { QueueRow } from "./QueueRow";
import { QueueToolbar, type FilterCounts, type QueueFilter } from "./QueueToolbar";
import { ResolvedList } from "./ResolvedList";

export type { QueueFilter } from "./QueueToolbar";

interface Props {
  store: Store; meta: Meta; filter: QueueFilter; search: string;
  onFilter: (f: QueueFilter) => void; onSearch: (q: string) => void;
  selectedId: number | null; onSelect: (id: number) => void; onOpen: (id: number) => void;
  onTake: (id: number) => void; onQuickState: (id: number, next: State) => void;
}

const matches = (t: Ticket, q: string) =>
  t.subject.toLowerCase().includes(q) || t.requester.toLowerCase().includes(q) || t.number.toLowerCase().includes(q);

export function visibleQueueIds(store: Store, filter: QueueFilter, search: string, nowMs: number): number[] {
  const q = search.trim().toLowerCase();
  return store.queueIds.filter((id) => {
    const t = store.tickets.get(id);
    if (!t) return false;
    if (filter === "vip" && !t.is_vip) return false;
    if (filter === "unassigned" && t.assigned_to) return false;
    if (filter === "at_risk") {
      const s = liveSla(t, nowMs).status; // breached stays in At risk
      if (s !== "at_risk" && s !== "breached") return false;
    }
    return !q || matches(t, q);
  });
}

export function filterCounts(store: Store, nowMs: number): FilterCounts {
  const open = store.queueIds.flatMap((id) => { const t = store.tickets.get(id); return t ? [t] : []; });
  return {
    all: open.length,
    vip: open.filter((t) => t.is_vip).length,
    at_risk: open.filter((t) => ["at_risk", "breached"].includes(liveSla(t, nowMs).status)).length,
    unassigned: open.filter((t) => !t.assigned_to).length,
  };
}

export function Queue({ store, meta, filter, search, onFilter, onSearch, selectedId, onSelect, onOpen, onTake, onQuickState }: Props) {
  const nowMs = useNow();
  const ids = visibleQueueIds(store, filter, search, nowMs);
  const q = search.trim().toLowerCase();
  const done = store.resolvedIds.flatMap((id) => { const t = store.tickets.get(id); return t && (!q || matches(t, q)) ? [t] : []; });
  return (
    <section className="panel queue-panel">
      <QueueToolbar filter={filter} counts={filterCounts(store, nowMs)} search={search} onFilter={onFilter} onSearch={onSearch} />
      <div className="queue" data-testid="queue">
        {ids.map((id) => { const t = store.tickets.get(id); return t ? <QueueRow key={id} ticket={t} meta={meta} selected={selectedId === id} onSelect={onSelect} onOpen={onOpen} onTake={onTake} onQuickState={onQuickState} /> : null; })}
      </div>
      {store.queueIds.length === 0 && <QueueClear />}
      {store.queueIds.length > 0 && ids.length === 0 && <NoMatch />}
      <ResolvedList tickets={done} total={store.resolvedIds.length} meta={meta} onOpen={onOpen} />
    </section>
  );
}
```

- [ ] **Step 6: Wire App for a read-only screen**

Replace `frontend/src/App.tsx`:

```tsx
import { useState } from "react";
import { useActingAgent } from "./hooks/useActingAgent";
import { useMeta } from "./hooks/useMeta";
import { NowProvider } from "./hooks/useNow";
import { useTickets } from "./hooks/useTickets";
import { Queue, type QueueFilter } from "./components/Queue";
import { ToastProvider, useToast } from "./components/Toasts";
import { TopBar } from "./components/TopBar";

function Desk() {
  const meta = useMeta();
  const [actingAgent, setActingAgent] = useActingAgent(meta);
  const toast = useToast();
  const { store } = useTickets({ actingAgent, priorities: meta?.priorities ?? [], agentNames: meta?.agents.map((a) => a.name) ?? [], transitions: meta?.transitions ?? null, toast });
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  return (
    <NowProvider offsetMs={store.clockOffsetMs}>
      <TopBar meta={meta} offline={store.offline} actingAgent={actingAgent} onAgentChange={setActingAgent} />
      <main className="wrap">
        <div className="columns">
          {meta && store.loaded && (
            <Queue store={store} meta={meta} filter={filter} search={search} onFilter={setFilter} onSearch={setSearch} selectedId={selectedId} onSelect={setSelectedId} onOpen={() => undefined} onTake={() => undefined} onQuickState={() => undefined} />
          )}
        </div>
      </main>
    </NowProvider>
  );
}

export function App() {
  return <ToastProvider><Desk /></ToastProvider>;
}
```

Update `frontend/src/App.test.tsx` to wait for data:

```tsx
import { render, screen } from "@testing-library/react";
import { App } from "./App";

test("boots meta and tickets and renders the queue", async () => {
  render(<App />);
  expect(await screen.findByText("CEO laptop")).toBeInTheDocument();
  expect(screen.getByText("Concierge")).toBeInTheDocument();
});
```

- [ ] **Step 7: Run everything**

Run: `npm run lint && npm run typecheck && npx vitest run`
Expected: all passing.

- [ ] **Step 8: Visual check**

Run `npm run dev` in `frontend/` and `SEED_ON_START=1 .venv/bin/python app.py` at the root; open http://localhost:5173. Expected: the queue looks like the old one (VIP rows first, clocks ticking, filters and search working). If `.queue > .row` styling broke because of the wrapper div in `QueueRow`, move `onClick` onto the `RowClass` div and delete the wrapper.

- [ ] **Step 9: Commit**

```bash
git add frontend/src
git commit -m "feat(frontend): ticket store polling and the live queue"
```

---

### Task 6: Toasts and optimistic mutations

**Files:**
- Modify: `frontend/src/hooks/useTickets.ts`, `frontend/src/App.tsx`
- Create (if not created in Task 4): `frontend/src/components/Toasts.tsx`
- Test: `frontend/src/components/Toasts.test.tsx`, extend `frontend/src/hooks/useTickets.test.tsx`

**Interfaces:**
- Produces: `ToastFn = (message: string, opts?: { type?: "info"|"ok"|"error"|"crit"; action?: string; onAction?: () => void; duration?: number }) => { dismiss: () => void }`, `ToastProvider`, `useToast(): ToastFn`, `<Toasts />` rendered by the provider. All `TicketActions` mutations implemented.

- [ ] **Step 1: Failing toast test**

`frontend/src/components/Toasts.test.tsx`:

```tsx
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider, useToast } from "./Toasts";

function Trigger() {
  const toast = useToast();
  return <>
    <button onClick={() => toast("saved", { type: "ok" })}>one</button>
    <button onClick={() => toast("undo me", { action: "Undo", onAction: () => toast("undone") })}>two</button>
  </>;
}

test("shows, caps at three, supports actions, and auto-dismisses", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  render(<ToastProvider><Trigger /></ToastProvider>);
  const one = screen.getByText("one");
  await userEvent.click(one); await userEvent.click(one); await userEvent.click(one); await userEvent.click(one);
  expect(screen.getAllByText("saved")).toHaveLength(3);
  await userEvent.click(screen.getByText("two"));
  await userEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(screen.getByText("undone")).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(4300); });
  expect(screen.queryByText("saved")).not.toBeInTheDocument();
  vi.useRealTimers();
});
```

- [ ] **Step 2: Implement Toasts.tsx**

```tsx
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

export type ToastType = "info" | "ok" | "error" | "crit";
export interface ToastOptions { type?: ToastType; action?: string; onAction?: () => void; duration?: number; }
export type ToastFn = (message: string, opts?: ToastOptions) => { dismiss: () => void };

interface ToastItem { id: number; message: string; type: ToastType; action?: string; onAction?: () => void; out: boolean; }

const ToastContext = createContext<ToastFn>(() => ({ dismiss: () => undefined }));
export const useToast = (): ToastFn => useContext(ToastContext);

const MAX_VISIBLE = 3;
const EXIT_MS = 200;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const remove = useCallback((id: number) => {
    setItems((list) => list.map((t) => (t.id === id ? { ...t, out: true } : t)));
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), EXIT_MS);
  }, []);

  const toast = useCallback<ToastFn>((message, { type = "info", action, onAction, duration = 4000 } = {}) => {
    const id = nextId.current++;
    setItems((list) => [...list, { id, message, type, action, onAction, out: false }].slice(-MAX_VISIBLE));
    const timer = setTimeout(() => remove(id), duration);
    return { dismiss: () => { clearTimeout(timer); remove(id); } };
  }, [remove]);

  const value = useMemo(() => toast, [toast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.type} ${t.out ? "out" : ""}`}>
            <span className="toast-msg">{t.message}</span>
            {t.action && <button type="button" className="toast-action" onClick={() => { remove(t.id); t.onAction?.(); }}>{t.action}</button>}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
```

- [ ] **Step 3: Failing mutation tests**

Append to `frontend/src/hooks/useTickets.test.tsx`:

```tsx
test("changeState applies optimistically then reconciles with the server ticket", async () => {
  server.use(http.patch("/api/tickets/1", async ({ request }) => {
    const body = (await request.json()) as { state: string };
    return HttpResponse.json({ ...queueFixture[1]!, state: body.state, assigned_to: "Priya Natarajan" });
  }));
  const { result } = renderHook(() => useTickets(opts));
  await waitFor(() => expect(result.current.store.loaded).toBe(true));
  await act(() => result.current.changeState(1, "In Progress"));
  expect(result.current.store.tickets.get(1)?.state).toBe("In Progress");
  expect(result.current.store.tickets.get(1)?.assigned_to).toBe("Priya Natarajan");
});

test("changeState reverts and toasts on a server error", async () => {
  const toast = vi.fn().mockReturnValue({ dismiss: vi.fn() });
  server.use(http.patch("/api/tickets/1", () => HttpResponse.json({ error: { code: 400, message: "cannot move New → Closed" } }, { status: 400 })));
  const { result } = renderHook(() => useTickets({ ...opts, toast }));
  await waitFor(() => expect(result.current.store.loaded).toBe(true));
  await act(() => result.current.changeState(1, "Resolved"));
  expect(result.current.store.tickets.get(1)?.state).toBe("New");
  expect(result.current.store.queueIds).toEqual([2, 1, 3]);
  expect(toast).toHaveBeenCalledWith("cannot move New → Closed", { type: "error" });
});

test("illegal transitions send nothing", async () => {
  let called = false;
  server.use(http.patch("/api/tickets/2", () => { called = true; return HttpResponse.json({}); }));
  const { result } = renderHook(() => useTickets(opts));
  await waitFor(() => expect(result.current.store.loaded).toBe(true));
  await act(() => result.current.changeState(4, "In Progress")); // Resolved -> In Progress is illegal
  expect(called).toBe(false);
});

test("createTicket inserts in sort position and resetDemo returns the message", async () => {
  server.use(
    http.post("/api/tickets", () => HttpResponse.json(makeTicket({ id: 9, number: "INC-1009", is_vip: true, priority: "Critical" }), { status: 201 })),
    http.post("/api/demo/reset", () => HttpResponse.json({ ok: true, message: "Demo data reset" })),
  );
  const { result } = renderHook(() => useTickets(opts));
  await waitFor(() => expect(result.current.store.loaded).toBe(true));
  await act(async () => { await result.current.createTicket({ subject: "x", requester: "y", ticket_type: "Incident", impact: "High", urgency: "High", is_vip: true }); });
  expect(result.current.store.queueIds[0]).toBe(9);
  await expect(act(() => result.current.resetDemo())).resolves.toBe("Demo data reset");
});
```

Add to the imports of that test file: `import { act } from "@testing-library/react"; import { makeTicket } from "../test/fixtures"; import { queueFixture } from "../test/handlers";`

- [ ] **Step 4: Implement the mutations**

Replace the `notImplemented` block in `useTickets.ts` with:

```ts
  const snapshotRef = useRef<Store | null>(null);

  const withRevert = useCallback(async (run: () => Promise<void>) => {
    snapshotRef.current = store;
    try {
      await run();
    } catch (err) {
      const snap = snapshotRef.current;
      if (snap) setStore(snap);
      optsRef.current.toast(err instanceof Error ? err.message : "Request failed", { type: "error" });
    }
  }, [store]);

  const reconcile = useCallback((t: Ticket) => {
    setStore((s) => applyTicket(s, t, optsRef.current.priorities));
    void refresh();
  }, [refresh]);

  const changeState = useCallback(async (id: number, next: State) => {
    const { transitions, actingAgent, agentNames, priorities, toast } = optsRef.current;
    const t = store.tickets.get(id);
    if (!t || !transitions || !(transitions[t.state] ?? []).includes(next)) return;
    const nowMs = Date.now() + store.clockOffsetMs;
    const local = applyLocalTransition(t, next, nowMs, actingAgent, agentNames);
    setStore((s) => applyTicket(s, local, priorities));
    const undo = next === "Resolved"
      ? toast(`${t.number} resolved`, { type: "ok", action: "Undo", onAction: () => void reopenTicket(id), duration: 6000 })
      : null;
    await withRevert(async () => {
      try {
        reconcile(await api<Ticket>(`/api/tickets/${id}`, { method: "PATCH", body: { state: next }, agent: actingAgent }));
      } catch (err) {
        undo?.dismiss();
        throw err;
      }
    });
  }, [store, withRevert, reconcile]); // eslint-disable-line react-hooks/exhaustive-deps

  const assignTicket = useCallback(async (id: number, name: string | null) => {
    const t = store.tickets.get(id);
    if (!t || t.assigned_to === name) return;
    setStore((s) => applyTicket(s, { ...t, assigned_to: name }, optsRef.current.priorities));
    await withRevert(async () => {
      reconcile(await api<Ticket>(`/api/tickets/${id}`, { method: "PATCH", body: { assigned_to: name }, agent: optsRef.current.actingAgent }));
    });
  }, [store, withRevert, reconcile]);

  const reopenTicket = useCallback(async (id: number): Promise<Ticket | null> => {
    try {
      const updated = await api<Ticket>(`/api/tickets/${id}/reopen`, { method: "POST", agent: optsRef.current.actingAgent });
      reconcile(updated);
      optsRef.current.toast(`${updated.number} reopened`, { type: "ok" });
      return updated;
    } catch (err) {
      optsRef.current.toast(err instanceof Error ? err.message : "Request failed", { type: "error" });
      return null;
    }
  }, [reconcile]);

  const createTicket = useCallback(async (body: CreateTicketBody): Promise<Ticket> => {
    const created = await api<Ticket>("/api/tickets", { method: "POST", body, agent: optsRef.current.actingAgent });
    reconcile(created);
    return created;
  }, [reconcile]);

  const resetDemo = useCallback(async (): Promise<string> => {
    const res = await api<{ ok: boolean; message: string }>("/api/demo/reset", { method: "POST", agent: optsRef.current.actingAgent });
    await refresh();
    return res.message;
  }, [refresh]);

  return { store, refresh, createTicket, changeState, assignTicket, reopenTicket, resetDemo };
```

Add `applyLocalTransition, applyTicket` to the `../lib/store` import. `reopenTicket` is referenced inside `changeState` before its declaration; declare `reopenTicket` above `changeState` in the file to satisfy TypeScript and remove the eslint-disable comment if the rule no longer fires.

- [ ] **Step 5: Wire quick actions in App**

In `App.tsx` destructure `{ store, changeState, assignTicket }` from `useTickets` and pass `onTake={(id) => void assignTicket(id, actingAgent)}` and `onQuickState={(id, next) => void changeState(id, next)}` to `Queue`.

- [ ] **Step 6: Run everything**

Run: `npm run lint && npm run typecheck && npx vitest run`
Expected: all passing.

- [ ] **Step 7: Commit**

```bash
git add frontend/src
git commit -m "feat(frontend): toasts and optimistic ticket mutations with revert"
```

---

### Task 7: Ticket form with priority preview

**Files:**
- Create: `frontend/src/components/TicketForm.tsx`, `frontend/src/components/PriorityPreview.tsx`
- Test: `frontend/src/components/TicketForm.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Produces: `TicketForm({ meta, onCreate: (body: CreateTicketBody) => Promise<unknown>, subjectRef?: React.RefObject<HTMLInputElement> })`, `PriorityPreview({ meta, impact, urgency, isVip })`.

- [ ] **Step 1: Failing tests**

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/render";
import { meta } from "../test/fixtures";
import { TicketForm } from "./TicketForm";

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
```

- [ ] **Step 2: Implement PriorityPreview**

```tsx
import type { Level, Meta } from "../api/types";

export function PriorityPreview({ meta, impact, urgency, isVip }: { meta: Meta; impact: Level; urgency: Level; isVip: boolean }) {
  const priority = meta.priority_matrix[`${impact}|${urgency}`] ?? "Medium";
  const target = meta.sla_targets[priority];
  return (
    <div className="priority-preview">
      <span className="pp-label">Priority</span>
      <span className={`pp-badge prio-${priority.toLowerCase()}`}>{priority}</span>
      <span className="pp-target num">SLA {isVip ? target / 2 : target}m</span>
    </div>
  );
}
```

- [ ] **Step 3: Implement TicketForm**

```tsx
import { useState, type FormEvent, type RefObject } from "react";
import type { CreateTicketBody, Level, Meta, TicketType } from "../api/types";
import { PriorityPreview } from "./PriorityPreview";

interface Props { meta: Meta; onCreate: (body: CreateTicketBody) => Promise<unknown>; subjectRef?: RefObject<HTMLInputElement>; }

export function TicketForm({ meta, onCreate, subjectRef }: Props) {
  const [subject, setSubject] = useState("");
  const [requester, setRequester] = useState("");
  const [ticketType, setTicketType] = useState<TicketType>("Incident");
  const [impact, setImpact] = useState<Level>("Medium");
  const [urgency, setUrgency] = useState<Level>("Medium");
  const [isVip, setIsVip] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onCreate({ subject: subject.trim(), requester: requester.trim(), ticket_type: ticketType, impact, urgency, is_vip: isVip });
      setError(null);
      setSubject(""); setRequester(""); setTicketType("Incident"); setImpact("Medium"); setUrgency("Medium"); setIsVip(false);
      subjectRef?.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed"); // stays until the next submit
    } finally {
      setBusy(false);
    }
  };

  const select = <T extends string>(label: string, value: T, values: readonly T[], set: (v: T) => void) => (
    <label className="field"><span>{label}</span>
      <select aria-label={label} value={value} onChange={(e) => set(e.target.value as T)}>{values.map((v) => <option key={v} value={v}>{v}</option>)}</select>
    </label>
  );

  return (
    <aside className="panel form-panel">
      <h2 className="panel-title">New ticket</h2>
      <form autoComplete="off" noValidate onSubmit={(e) => void submit(e)}>
        <label className="field"><span>Subject</span><input ref={subjectRef} aria-label="Subject" maxLength={200} placeholder="Short description" value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
        <label className="field"><span>Requester</span><input aria-label="Requester" maxLength={200} placeholder="Who is affected" value={requester} onChange={(e) => setRequester(e.target.value)} /></label>
        {select("Type", ticketType, meta.types, setTicketType)}
        <div className="field-row">
          {select("Impact", impact, meta.impacts, setImpact)}
          {select("Urgency", urgency, meta.urgencies, setUrgency)}
        </div>
        <PriorityPreview meta={meta} impact={impact} urgency={urgency} isVip={isVip} />
        <label className="vip-toggle">
          <input type="checkbox" checked={isVip} onChange={(e) => setIsVip(e.target.checked)} />
          <span className="vip-box" aria-hidden="true">&#9733;</span>
          <span>VIP requester</span>
          <span className="vip-note">SLA halved</span>
        </label>
        <button type="submit" className="btn-primary" disabled={busy}>Create ticket</button>
        {error && <div className="form-error" role="alert">{error}</div>}
      </form>
    </aside>
  );
}
```

- [ ] **Step 4: Wire into App**

In `Desk`, add `const subjectRef = useRef<HTMLInputElement>(null);` and render `<TicketForm meta={meta} onCreate={createTicket} subjectRef={subjectRef} />` as the first child of `.columns` (before `Queue`), guarded by `meta &&`.

- [ ] **Step 5: Run everything, then commit**

Run: `npm run lint && npm run typecheck && npx vitest run`
Expected: all passing.

```bash
git add frontend/src
git commit -m "feat(frontend): new ticket form with live priority preview"
```

---

### Task 8: Metrics tiles, tweens, VIP banner, title breach count

**Files:**
- Create: `frontend/src/hooks/useTween.ts`, `frontend/src/components/Tile.tsx`, `frontend/src/components/MetricsTiles.tsx`, `frontend/src/components/VipBanner.tsx`, `frontend/src/hooks/useBreachWatch.ts`
- Test: `frontend/src/components/MetricsTiles.test.tsx`, `frontend/src/hooks/useBreachWatch.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Produces: `useTween(value: number, ms = 300): number`, `Tile`, `MetricsTiles({ metrics })`, `VipBanner({ store, onOpen })`, `useBreachWatch(store, toast)` (toasts once per breach crossing and sets `document.title`).

- [ ] **Step 1: Failing tests**

`MetricsTiles.test.tsx`:

```tsx
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
```

`useBreachWatch.test.tsx`:

```tsx
import { renderHook } from "@testing-library/react";
import { emptyStore, replaceAll } from "../lib/store";
import { makeTicket, metrics, NOW_ISO } from "../test/fixtures";
import { useBreachWatch } from "./useBreachWatch";

test("toasts once when a ticket crosses into breach and updates the title", () => {
  const toast = vi.fn().mockReturnValue({ dismiss: vi.fn() });
  const ok = makeTicket({ id: 1, created_at: new Date(Date.now() - 10 * 60000).toISOString(), sla_target_min: 60 });
  let store = replaceAll(emptyStore(), { now: NOW_ISO, queue: [ok], resolved: [], metrics });
  store = { ...store, clockOffsetMs: 0 };
  const { rerender } = renderHook(({ s }) => useBreachWatch(s, toast), { initialProps: { s: store } });
  expect(toast).not.toHaveBeenCalled();
  const breached = { ...ok, created_at: new Date(Date.now() - 90 * 60000).toISOString() };
  const next = replaceAll(store, { now: new Date().toISOString(), queue: [breached], resolved: [], metrics });
  rerender({ s: next });
  rerender({ s: next });
  expect(toast).toHaveBeenCalledTimes(1);
  expect(toast).toHaveBeenCalledWith("INC-1001 breached SLA", { type: "crit", duration: 6000 });
  expect(document.title).toBe("(1⚠) Concierge");
});
```

- [ ] **Step 2: Implement useTween**

```ts
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./useReducedMotion";

// 300 ms count-up between values; instant under reduced motion.
export function useTween(value: number, ms = 300): number {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    if (reduced || !Number.isFinite(fromRef.current) || fromRef.current === value) {
      fromRef.current = value;
      setShown(value);
      return;
    }
    const from = fromRef.current;
    const started = performance.now();
    let raf = 0;
    const step = (ts: number) => {
      const p = Math.min(1, (ts - started) / ms);
      const eased = 1 - (1 - p) * (1 - p);
      setShown(from + (value - from) * eased);
      if (p < 1) raf = requestAnimationFrame(step);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms, reduced]);
  return shown;
}
```

- [ ] **Step 3: Implement Tile and MetricsTiles**

`Tile.tsx`:

```tsx
import type { ReactNode } from "react";
import { useTween } from "../hooks/useTween";

interface Props { name: string; label: string; value: number; format: (v: number) => string; context: string; className?: string; extra?: ReactNode; }

export function Tile({ name, label, value, format, context, className = "", extra }: Props) {
  const shown = useTween(value);
  return (
    <div className={`tile ${className}`} data-tile={name}>
      <div className="tile-label">{label}</div>
      <div className="tile-valuerow"><span className="tile-value num">{format(shown)}</span>{extra}</div>
      <div className="tile-context">{context}</div>
    </div>
  );
}
```

`MetricsTiles.tsx`:

```tsx
import type { Metrics } from "../api/types";
import { Tile } from "./Tile";

const DONUT_R = 10;
const DONUT_C = 2 * Math.PI * DONUT_R;
const int = (v: number) => String(Math.round(v));

export function MetricsTiles({ metrics: m }: { metrics: Metrics }) {
  const donutColor = m.sla_met_pct >= 90 ? "var(--ok)" : m.sla_met_pct >= 75 ? "var(--warn)" : "var(--crit)";
  return (
    <section className="metrics" aria-label="Desk metrics">
      <Tile name="open" label="Open" value={m.open} format={int} context={`${m.vip_open} VIP`} />
      <Tile name="unassigned" label="Unassigned" value={m.unassigned} format={int} context={`of ${m.open} open`} className={m.unassigned > 0 ? "warn" : ""} />
      <Tile name="at_risk" label="At risk" value={m.at_risk} format={int} context="≥75% SLA used" className={m.at_risk > 0 ? "warn" : ""} />
      <Tile name="breaching" label="Breaching" value={m.breaching} format={int} context={m.breaching > 0 ? "needs eyes now" : "none breaching"} className={m.breaching > 0 ? "alert" : ""} extra={<span className="pulse-dot" hidden={m.breaching === 0} />} />
      <Tile name="sla_met" label="SLA met" value={m.sla_met_pct} format={(v) => `${Math.round(v)}%`} context="target ≥ 90%" extra={
        <svg className="donut" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
          <circle className="donut-bg" cx="12" cy="12" r={DONUT_R} />
          <circle className="donut-fg" cx="12" cy="12" r={DONUT_R} strokeDasharray={`${(m.sla_met_pct / 100) * DONUT_C} ${DONUT_C}`} style={{ stroke: donutColor }} />
        </svg>} />
      <Tile name="mttr" label="MTTR" value={m.mttr_min} format={(v) => `${v.toFixed(1)}m`} context={`${m.resolved} resolved`} />
    </section>
  );
}
```

- [ ] **Step 4: Implement VipBanner and useBreachWatch**

`VipBanner.tsx`:

```tsx
import { useNow } from "../hooks/useNow";
import { liveSla } from "../lib/sla";
import type { Store } from "../lib/store";

export function VipBanner({ store, onOpen }: { store: Store; onOpen: (id: number) => void }) {
  const nowMs = useNow();
  const breached = store.queueIds.map((id) => store.tickets.get(id)).find((t) => t && t.is_vip && liveSla(t, nowMs).status === "breached");
  if (!breached) return null;
  return (
    <button type="button" className="vip-banner" onClick={() => onOpen(breached.id)}>
      &#9733; VIP ticket <span className="num">{breached.number}</span> has breached SLA
    </button>
  );
}
```

`useBreachWatch.ts`:

```ts
import { useEffect, useRef } from "react";
import { useNow } from "./useNow";
import { liveSla } from "../lib/sla";
import type { Store } from "../lib/store";
import type { ToastFn } from "../components/Toasts";

// Toast the moment a ticket crosses into breach (never on every poll), and
// keep the tab title's breach count current.
export function useBreachWatch(store: Store, toast: ToastFn): void {
  const nowMs = useNow();
  const lastStatus = useRef(new Map<number, string>());
  useEffect(() => {
    let breachCount = 0;
    const seen = new Map<number, string>();
    for (const id of store.queueIds) {
      const t = store.tickets.get(id);
      if (!t) continue;
      const status = liveSla(t, nowMs).status;
      if (status === "breached") breachCount += 1;
      const prev = lastStatus.current.get(id);
      if (prev !== undefined && prev !== "breached" && status === "breached") {
        toast(`${t.number} breached SLA`, { type: "crit", duration: 6000 });
      }
      seen.set(id, status);
    }
    lastStatus.current = seen;
    document.title = breachCount > 0 ? `(${breachCount}⚠) Concierge` : "Concierge";
  }, [store, nowMs, toast]);
}
```

Note the first observation of a ticket records its status without toasting, which is the "already breached tickets don't re-toast" behavior from `app.js`.

- [ ] **Step 5: Wire into App**

In `Desk` render, inside `<main className="wrap">` before `.columns`: `<VipBanner store={store} onOpen={openDrawer} />` and `{store.metrics && <MetricsTiles metrics={store.metrics} />}`; call `useBreachWatch(store, toast)` inside a child component that sits under `NowProvider` (create `function Watch({ store }: { store: Store }) { useBreachWatch(store, useToast()); return null; }` in `App.tsx` and render `<Watch store={store} />` inside the provider). `openDrawer` is a placeholder `() => undefined` until Task 9.

- [ ] **Step 6: Run everything, commit**

Run: `npm run lint && npm run typecheck && npx vitest run`

```bash
git add frontend/src
git commit -m "feat(frontend): metrics tiles, VIP breach banner, breach toasts and title"
```

---

### Task 9: Drawer with identity, SLA ring, controls, timeline, note composer

**Files:**
- Create: `frontend/src/components/Drawer.tsx`, `DrawerIdentity.tsx`, `SlaRing.tsx`, `DrawerControls.tsx`, `Timeline.tsx`, `NoteComposer.tsx`, `frontend/src/hooks/useTicketDetail.ts`
- Test: `frontend/src/components/Drawer.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Produces: `useTicketDetail(id: number | null, store: Store, actingAgent: string, toast: ToastFn)` → `{ ticket: Ticket | null; events: TicketEvent[]; refresh(): Promise<void>; addNote(text: string): Promise<boolean> }`; `Drawer({ id, store, meta, actingAgent, onClose, onChangeState, onAssign, onReopen })`.

- [ ] **Step 1: Failing drawer tests**

```tsx
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
```

- [ ] **Step 2: Implement useTicketDetail**

```ts
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { Ticket, TicketDetailResponse, TicketEvent } from "../api/types";
import type { Store } from "../lib/store";
import type { ToastFn } from "../components/Toasts";

export function useTicketDetail(id: number | null, store: Store, actingAgent: string, toast: ToastFn) {
  const [events, setEvents] = useState<TicketEvent[]>([]);
  const [fetched, setFetched] = useState<Ticket | null>(null);

  const refresh = useCallback(async () => {
    if (id === null) return;
    try {
      const data = await api<TicketDetailResponse>(`/api/tickets/${id}`);
      setFetched(data.ticket);
      setEvents(data.events);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Request failed", { type: "error" });
    }
  }, [id, toast]);

  useEffect(() => {
    setEvents([]);
    setFetched(null);
    void refresh();
  }, [refresh]);

  // The store copy is fresher after optimistic mutations; the fetched copy
  // fills the gap before the store has the ticket at all.
  const ticket = (id !== null && store.tickets.get(id)) || fetched;

  const addNote = useCallback(async (text: string): Promise<boolean> => {
    if (id === null) return false;
    const temp: TicketEvent = { id: `pending-${Date.now()}`, actor: actingAgent || "System", event_type: "work_note", detail: text, created_at: new Date().toISOString(), pending: true };
    setEvents((list) => [temp, ...list]);
    try {
      const saved = await api<TicketEvent>(`/api/tickets/${id}/notes`, { method: "POST", body: { note: text }, agent: actingAgent });
      setEvents((list) => list.map((ev) => (ev === temp ? saved : ev)));
      return true;
    } catch (err) {
      setEvents((list) => list.filter((ev) => ev !== temp));
      toast(err instanceof Error ? err.message : "Request failed", { type: "error" });
      return false;
    }
  }, [id, actingAgent, toast]);

  return { ticket, events, refresh, addNote };
}
```

- [ ] **Step 3: Implement the drawer pieces**

`DrawerIdentity.tsx`:

```tsx
import type { Meta, Ticket } from "../api/types";
import { Avatar, agentByName } from "./Avatar";

export function DrawerIdentity({ ticket: t, meta, onAssign }: { ticket: Ticket; meta: Meta; onAssign: (name: string | null) => void }) {
  const pCode = `P${Math.max(0, meta.priorities.indexOf(t.priority)) + 1}`;
  return (
    <div className="identity">
      <div className="identity-row">
        <span className="requester-name">{t.requester}</span>
        {t.is_vip && <span className="chip vip-chip">&#9733; VIP</span>}
        <span className="type-tag">{t.ticket_type}</span>
        <span className="chip">{t.state}</span>
        {t.reopened_count > 0 && <span className="tag-reopened">Reopened ×{t.reopened_count}</span>}
      </div>
      <div className="identity-line"><span className="pcode">{pCode}</span> · {t.priority} — Impact {t.impact} / Urgency {t.urgency}</div>
      <div className="identity-assign">
        <span className="label">Assignee</span>
        <Avatar agent={agentByName(meta.agents, t.assigned_to)} />
        <select aria-label="Assignee" value={t.assigned_to ?? ""} onChange={(e) => onAssign(e.target.value || null)}>
          <option value="">Unassigned</option>
          {meta.agents.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
        </select>
      </div>
    </div>
  );
}
```

`SlaRing.tsx`:

```tsx
import type { Ticket } from "../api/types";
import { useNow } from "../hooks/useNow";
import { clamp01, fmtClock } from "../lib/format";
import { isOpen, liveSla } from "../lib/sla";

const RING_R = 42;
const RING_C = 2 * Math.PI * RING_R;

export function SlaRing({ ticket: t }: { ticket: Ticket }) {
  const nowMs = useNow();
  const sla = liveSla(t, nowMs);
  const heldNow = t.held_minutes + (t.on_hold_since ? (nowMs - Date.parse(t.on_hold_since)) / 60000 : 0);
  let frac: number; let cls: string; let value: string; let sub: string;
  if (!isOpen(t)) { frac = 1; cls = sla.status === "met" ? "ring-ok" : "ring-crit"; value = `${Math.round(sla.elapsedMin)}m`; sub = sla.status === "met" ? "met" : "missed"; }
  else if (sla.status === "breached") { frac = 1; cls = "ring-crit"; value = `+${fmtClock(-(sla.remainingMin ?? 0))}`; sub = "breached"; }
  else if (sla.status === "paused") { frac = (sla.remainingMin ?? 0) / t.sla_target_min; cls = "ring-muted"; value = fmtClock(sla.remainingMin ?? 0); sub = "paused"; }
  else { frac = (sla.remainingMin ?? 0) / t.sla_target_min; cls = sla.status === "at_risk" ? "ring-warn" : "ring-ok"; value = fmtClock(sla.remainingMin ?? 0); sub = "remaining"; }
  return (
    <div className="drawer-sla-inner">
      <div className={`ring-wrap ${cls}`}>
        <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true">
          <circle className="ring-bg" cx="48" cy="48" r={RING_R} />
          <circle className="ring-fg" cx="48" cy="48" r={RING_R} strokeDasharray={`${clamp01(frac) * RING_C} ${RING_C}`} />
        </svg>
        <div className="ring-center"><span className="ring-value num">{value}</span><span className="ring-sub">{sub}</span></div>
      </div>
      <div className="sla-facts">
        <div><span className="k">Target</span><span className="num">{t.sla_target_min}m</span>{t.is_vip && <span className="k"> (VIP halved)</span>}</div>
        <div><span className="k">Elapsed</span><span className="num">{Math.max(0, Math.round(sla.elapsedMin))}m</span></div>
        {heldNow > 0.5 && <div><span className="k">Held</span><span className="num">{Math.round(heldNow)}m</span></div>}
      </div>
    </div>
  );
}
```

`DrawerControls.tsx`:

```tsx
import type { Meta, State, Ticket } from "../api/types";

export function DrawerControls({ ticket: t, meta, onChangeState, onReopen }: { ticket: Ticket; meta: Meta; onChangeState: (next: State) => void; onReopen: () => void }) {
  const next = meta.transitions[t.state] ?? [];
  return (
    <div>
      <div className="controls-label">State</div>
      {next.length === 0 && t.state !== "Resolved"
        ? <div className="terminal-note">Closed — terminal state</div>
        : <div className="controls-buttons">
            {next.map((s) => <button key={s} type="button" className="seg-btn" onClick={() => onChangeState(s)}>{s}</button>)}
            {t.state === "Resolved" && <button type="button" className="seg-btn reopen" onClick={onReopen}>Reopen</button>}
          </div>}
    </div>
  );
}
```

`Timeline.tsx`:

```tsx
import type { Meta, TicketEvent } from "../api/types";
import { useNow } from "../hooks/useNow";
import { fmtRelative } from "../lib/format";
import { agentByName } from "./Avatar";

function dotColor(ev: TicketEvent, meta: Meta): string {
  switch (ev.event_type) {
    case "created": return "var(--accent)";
    case "work_note": return "var(--text)";
    case "reopened": return "var(--warn)";
    case "assigned": return agentByName(meta.agents, ev.detail.startsWith("Assigned to ") ? ev.detail.slice(12) : null)?.color ?? "var(--muted)";
    default: return "var(--muted)";
  }
}

export function Timeline({ events, meta, loading }: { events: TicketEvent[]; meta: Meta; loading: boolean }) {
  const nowMs = useNow();
  return (
    <div>
      <div className="timeline-label">Timeline</div>
      {loading ? <p className="empty-sub">Loading timeline…</p> : (
        <div className="timeline">
          {events.map((ev) => (
            <div key={ev.id} className={`tl-item ${ev.pending ? "pending" : ""}`}>
              <span className="tl-dot" style={{ background: dotColor(ev, meta) }} />
              <div className="tl-head"><span className="tl-actor">{ev.actor}</span><span className="tl-time num">{fmtRelative(ev.created_at, nowMs)}</span></div>
              <div className="tl-detail">{ev.detail}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

`NoteComposer.tsx`:

```tsx
import { useState, type FormEvent } from "react";

export function NoteComposer({ locked, onSubmit }: { locked: boolean; onSubmit: (text: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || locked) return;
    setDraft("");
    const ok = await onSubmit(text);
    if (!ok) setDraft(text); // never lose a draft to a failed POST
  };
  return (
    <form className="composer" onSubmit={(e) => void submit(e)}>
      <textarea aria-label="Work note" maxLength={1000} rows={3} disabled={locked} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={locked ? "Closed — notes are locked" : "Add a work note…"} />
      <button type="submit" className="btn-primary btn-small" disabled={locked}>Add note</button>
    </form>
  );
}
```

`Drawer.tsx`:

```tsx
import { useEffect } from "react";
import type { Meta, State } from "../api/types";
import type { Store } from "../lib/store";
import { useTicketDetail } from "../hooks/useTicketDetail";
import { useToast } from "./Toasts";
import { DrawerIdentity } from "./DrawerIdentity";
import { SlaRing } from "./SlaRing";
import { DrawerControls } from "./DrawerControls";
import { Timeline } from "./Timeline";
import { NoteComposer } from "./NoteComposer";

interface Props {
  id: number | null; store: Store; meta: Meta; actingAgent: string;
  onClose: () => void; onChangeState: (id: number, next: State) => void; onAssign: (id: number, name: string | null) => void; onReopen: (id: number) => void;
}

export function Drawer({ id, store, meta, actingAgent, onClose, onChangeState, onAssign, onReopen }: Props) {
  const toast = useToast();
  const { ticket, events, refresh, addNote } = useTicketDetail(id, store, actingAgent, toast);
  const open = id !== null;
  // Poll piggyback: whenever the store changes, refresh the timeline (the composer keeps its draft).
  useEffect(() => { if (open) void refresh(); }, [store, open, refresh]);
  return (
    <>
      <div className="drawer-backdrop" hidden={!open} onClick={onClose} />
      <aside className={`drawer ${open ? "open" : ""}`} role="dialog" aria-modal="true" aria-label="Ticket detail" aria-hidden={!open}>
        <header className="drawer-head">
          <div className="drawer-title"><span className="drawer-number num">{ticket?.number}</span><h2>{ticket?.subject}</h2></div>
          <button type="button" className="icon-btn" aria-label="Close drawer" onClick={onClose}>&#10005;</button>
        </header>
        {ticket && id !== null && (
          <div className="drawer-body">
            <DrawerIdentity ticket={ticket} meta={meta} onAssign={(name) => onAssign(id, name)} />
            <SlaRing ticket={ticket} />
            <DrawerControls ticket={ticket} meta={meta} onChangeState={(s) => onChangeState(id, s)} onReopen={() => onReopen(id)} />
            <Timeline events={events} meta={meta} loading={events.length === 0} />
            <NoteComposer locked={ticket.state === "Closed"} onSubmit={addNote} />
          </div>
        )}
      </aside>
    </>
  );
}
```

- [ ] **Step 4: Wire into App**

In `Desk`: `const [drawerId, setDrawerId] = useState<number | null>(null);` and `const openDrawer = (id: number) => setDrawerId(id);`. Pass `onOpen={openDrawer}` to `Queue` and `VipBanner`. Render after `</main>`: `{meta && <Drawer id={drawerId} store={store} meta={meta} actingAgent={actingAgent} onClose={() => setDrawerId(null)} onChangeState={(id, s) => void changeState(id, s)} onAssign={(id, n) => void assignTicket(id, n)} onReopen={(id) => void reopenTicket(id)} />}`. When `resetDemo` runs (Task 10) also `setDrawerId(null)`.

- [ ] **Step 5: Run everything, commit**

Run: `npm run lint && npm run typecheck && npx vitest run`

```bash
git add frontend/src
git commit -m "feat(frontend): ticket drawer with SLA ring, controls, timeline, and notes"
```

---

### Task 10: Keyboard shortcuts, overlay, footer reset

**Files:**
- Create: `frontend/src/hooks/useShortcuts.ts`, `frontend/src/components/ShortcutsOverlay.tsx`
- Test: `frontend/src/hooks/useShortcuts.test.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/components/QueueRow.tsx` (shake class)

**Interfaces:**
- Produces: `useShortcuts(handlers: { onNew, onSearch, onMove(dir: 1|-1), onOpen, onTransition(next: State), onEscape, onToggleOverlay, overlayOpen: boolean })`, `ShortcutsOverlay({ open, onClose })`.

- [ ] **Step 1: Failing test**

```tsx
import { renderHook } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useShortcuts } from "./useShortcuts";

test("dispatches keys, ignores typing and modifiers, and is inert under the overlay", async () => {
  const h = { onNew: vi.fn(), onSearch: vi.fn(), onMove: vi.fn(), onOpen: vi.fn(), onTransition: vi.fn(), onEscape: vi.fn(), onToggleOverlay: vi.fn(), overlayOpen: false };
  const { rerender } = renderHook((p) => useShortcuts(p), { initialProps: h });
  await userEvent.keyboard("j"); expect(h.onMove).toHaveBeenCalledWith(1);
  await userEvent.keyboard("k"); expect(h.onMove).toHaveBeenCalledWith(-1);
  await userEvent.keyboard("1"); expect(h.onTransition).toHaveBeenCalledWith("In Progress");
  await userEvent.keyboard("{Enter}"); expect(h.onOpen).toHaveBeenCalled();
  await userEvent.keyboard("?"); expect(h.onToggleOverlay).toHaveBeenCalled();
  await userEvent.keyboard("{Control>}j{/Control}"); expect(h.onMove).toHaveBeenCalledTimes(2);
  const input = document.createElement("input"); document.body.append(input); input.focus();
  await userEvent.keyboard("n"); expect(h.onNew).not.toHaveBeenCalled();
  input.blur(); input.remove();
  rerender({ ...h, overlayOpen: true });
  await userEvent.keyboard("j"); expect(h.onMove).toHaveBeenCalledTimes(2);
  await userEvent.keyboard("{Escape}"); expect(h.onEscape).toHaveBeenCalled();
});
```

- [ ] **Step 2: Implement useShortcuts**

```ts
import { useEffect } from "react";
import type { State } from "../api/types";

export interface ShortcutHandlers {
  onNew: () => void; onSearch: () => void; onMove: (dir: 1 | -1) => void; onOpen: () => void;
  onTransition: (next: State) => void; onEscape: () => void; onToggleOverlay: () => void; overlayOpen: boolean;
}

const TYPING = ["INPUT", "TEXTAREA", "SELECT"];

export function useShortcuts(h: ShortcutHandlers): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && TYPING.includes(el.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "?") { e.preventDefault(); h.onToggleOverlay(); return; }
      if (e.key === "Escape") { h.onEscape(); return; }
      if (h.overlayOpen) return;
      switch (e.key) {
        case "n": e.preventDefault(); h.onNew(); break;
        case "/": e.preventDefault(); h.onSearch(); break;
        case "j": h.onMove(1); break;
        case "k": h.onMove(-1); break;
        case "Enter": h.onOpen(); break;
        case "1": h.onTransition("In Progress"); break;
        case "2": h.onTransition("On Hold"); break;
        case "3": h.onTransition("Resolved"); break;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [h]);
}
```

- [ ] **Step 3: Implement ShortcutsOverlay**

```tsx
const ROWS: [string[], string][] = [
  [["n"], "New ticket (focus subject)"], [["/"], "Search the queue"], [["j", "k"], "Move selection down / up"],
  [["Enter"], "Open selected ticket"], [["1"], "Selected → In Progress"], [["2"], "Selected → On Hold"],
  [["3"], "Selected → Resolved"], [["Esc"], "Close drawer / clear selection"], [["?"], "Toggle this overlay"],
];

export function ShortcutsOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <div className="overlay" hidden={!open} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="overlay-card" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <div className="overlay-head"><h2>Keyboard shortcuts</h2><button type="button" className="icon-btn" aria-label="Close shortcuts" onClick={onClose}>&#10005;</button></div>
        <dl className="shortcut-list">
          {ROWS.map(([keys, label]) => <div className="shortcut" key={label}><dt>{keys.map((k) => <kbd key={k}>{k}</kbd>)}</dt><dd>{label}</dd></div>)}
        </dl>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire selection, shortcuts, overlay, footer into App**

In `Desk` add state `overlayOpen`, `shakeId` (number | null) and the handlers. Selection moves through `visibleQueueIds(store, filter, search, nowMs)`; `nowMs` comes from a child under `NowProvider`, so put the shortcut wiring in a `<Shortcuts .../>` child component that calls `useNow()` and `useShortcuts()`. `onTransition` checks `meta.transitions[t.state]` and sets `shakeId` for 150 ms on an illegal move; `QueueRow` gets a `shake: boolean` prop that appends the `shake` class. `onEscape` closes the overlay if open, else the drawer if open, else clears selection. Footer:

```tsx
<footer className="footer">
  Press <kbd>?</kbd> for shortcuts ·{" "}
  <button type="button" className="linklike" onClick={() => void onReset()}>Reset demo data</button>
</footer>
```

with `onReset = async () => { if (!window.confirm("Reset demo data? Current tickets will be replaced with the seeded tableau.")) return; try { setDrawerId(null); setSelectedId(null); toast(await resetDemo(), { type: "ok" }); } catch (err) { toast(err instanceof Error ? err.message : "Request failed", { type: "error" }); } }`. Render `<ShortcutsOverlay open={overlayOpen} onClose={() => setOverlayOpen(false)} />` last. Resolve from a row or shortcut goes through `changeState(id, "Resolved")` directly (the 200 ms collapse is added in Task 11).

- [ ] **Step 5: App-level test for reset and shortcuts**

Append to `App.test.tsx`:

```tsx
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "./test/handlers";

test("reset demo asks for confirmation then toasts the message", async () => {
  server.use(http.post("/api/demo/reset", () => HttpResponse.json({ ok: true, message: "Demo data reset" })));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<App />);
  await screen.findByText("CEO laptop");
  await userEvent.click(screen.getByRole("button", { name: "Reset demo data" }));
  expect(await screen.findByText("Demo data reset")).toBeInTheDocument();
});

test("? opens the shortcuts overlay and Escape closes it", async () => {
  render(<App />);
  await screen.findByText("CEO laptop");
  await userEvent.keyboard("?");
  expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).not.toBeVisible();
});
```

- [ ] **Step 6: Run everything, commit**

Run: `npm run lint && npm run typecheck && npx vitest run --coverage`
Expected: all passing, coverage ≥ 80% on every metric.

```bash
git add frontend/src
git commit -m "feat(frontend): keyboard shortcuts, overlay, and demo reset"
```

---

### Task 11: FLIP reorder, row enter, resolve collapse, shimmer

**Files:**
- Create: `frontend/src/hooks/useFlip.ts`
- Test: `frontend/src/hooks/useFlip.test.tsx`
- Modify: `frontend/src/components/Queue.tsx`, `frontend/src/components/QueueRow.tsx`, `frontend/src/App.tsx`, `frontend/index.html`

**Interfaces:**
- Produces: `useFlip(containerRef: RefObject<HTMLElement>, deps: unknown[], enabled: boolean)`.

- [ ] **Step 1: Failing test**

```tsx
import { render } from "@testing-library/react";
import { useRef } from "react";
import { useFlip } from "./useFlip";

function List({ ids }: { ids: number[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useFlip(ref, [ids], true);
  return <div ref={ref}>{ids.map((id) => <div key={id} className="row" data-id={id}>{id}</div>)}</div>;
}

test("marks new rows with row-enter after the first paint and animates moved rows", () => {
  let top = 0;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { top: Number(this.dataset["id"]) * 40 + top, left: 0, width: 0, height: 0, bottom: 0, right: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
  const { container, rerender } = render(<List ids={[1, 2]} />);
  expect(container.querySelector(".row-enter")).toBeNull();
  rerender(<List ids={[3, 1, 2]} />);
  expect(container.querySelector('[data-id="3"]')).toHaveClass("row-enter");
  top = 40; // rows 1 and 2 moved down by one slot
  rerender(<List ids={[3, 1, 2]} />);
  expect((container.querySelector('[data-id="1"]') as HTMLElement).style.transform).toContain("translateY(-40px)");
});
```

- [ ] **Step 2: Implement useFlip**

```ts
import { useLayoutEffect, useRef, type RefObject } from "react";

// FLIP: remember where each [data-id] row sat before this render, then play
// the inverted delta back to identity. Skipped entirely when disabled.
export function useFlip(containerRef: RefObject<HTMLElement>, deps: unknown[], enabled: boolean): void {
  const prev = useRef<Map<string, number> | null>(null);
  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root || !enabled) { prev.current = null; return; }
    const before = prev.current;
    const next = new Map<string, number>();
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(".row[data-id]"))) {
      const id = el.dataset["id"] ?? "";
      const top = el.getBoundingClientRect().top;
      next.set(id, top);
      if (!before) continue;
      const prevTop = before.get(id);
      if (prevTop === undefined) { el.classList.add("row-enter"); continue; }
      const delta = prevTop - top;
      if (Math.abs(delta) < 1) continue;
      el.style.transform = `translateY(${delta}px)`;
      el.style.transition = "none";
      requestAnimationFrame(() => {
        el.style.transition = "transform 250ms ease";
        el.style.transform = "";
        el.addEventListener("transitionend", () => { el.style.transition = ""; }, { once: true });
      });
    }
    prev.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
```

- [ ] **Step 3: Use it in Queue, add resolve collapse, add shimmer**

- In `Queue.tsx`: `const listRef = useRef<HTMLDivElement>(null); const reduced = useReducedMotion(); useFlip(listRef, [ids.join(","), store.resolvedIds.join(",")], !reduced);` and put `ref={listRef}` on the `.queue` div. Since `QueueRow` wraps the `.row` in a plain div (Task 5), the FLIP query still finds `.row[data-id]`.
- Resolve collapse: in `App.tsx` add `const [collapsingId, setCollapsingId] = useState<number | null>(null)` and a `resolveFromRow = (id) => { if (reduced) return void changeState(id, "Resolved"); setCollapsingId(id); setTimeout(() => { setCollapsingId(null); void changeState(id, "Resolved"); }, 200); }`; route the row quick action, drawer control, and shortcut `3` for `Resolved` through it. `QueueRow` takes `collapsing: boolean` and appends the `collapsing` class.
- Shimmer: in `index.html` keep `<div id="root"></div>` but render skeleton markup inside `App` when `!store.loaded`: a `Skeleton` component in `App.tsx` that reproduces the six `.tile.skeleton` and five `.skel-row.skeleton` blocks from the old template; add `document.body.classList.toggle("shimmer-on", true)` after 300 ms via a `useEffect` with a timeout that is cleared when `store.loaded` flips, and remove the class when loaded.

- [ ] **Step 4: Run everything, visual pass, commit**

Run: `npm run lint && npm run typecheck && npx vitest run --coverage`, then `npm run dev` and create a VIP ticket: the queue should animate the new row to the top and push others down.

```bash
git add frontend/src frontend/index.html
git commit -m "feat(frontend): FLIP reorder, resolve collapse, loading skeleton"
```

---

### Task 12: Remove the old UI, finish Flask, docs, and the PR

**Files:**
- Delete: `static/app.js`, `static/style.css`, `templates/index.html`
- Modify: `concierge/__init__.py`, `README.md`, `screenshot.png`, `tests/test_api.py` (any test that referenced the template)

- [ ] **Step 1: Delete the old files and Flask template config**

```bash
git rm -r static templates
```

In `concierge/__init__.py` remove the `template_folder=` and `static_folder=` arguments from `Flask(...)` (pass `static_folder=None` so Flask does not register its default `/static` route).

- [ ] **Step 2: Full test run**

Run from `frontend/`: `npm ci && npm run lint && npm run typecheck && npm test -- --coverage && npm run build`
Run from root: `ruff check . && pytest -q`
Expected: everything green; `pytest` exercises the real `frontend/dist` now.

- [ ] **Step 3: Parity walkthrough**

Run `SEED_ON_START=1 .venv/bin/python app.py` and open http://localhost:5001. Walk the 17 items in the spec's parity checklist with the seeded data. Fix anything that differs, with a test where the gap was testable, and commit each fix separately.

- [ ] **Step 4: README and screenshot**

In `README.md`: replace the tech line with "Flask + SQLite API, React 18 + TypeScript frontend built with Vite, tested with Vitest and React Testing Library"; add a "Development" section:

```
## Development

Backend: `SEED_ON_START=1 python app.py` (port 5001)
Frontend: `cd frontend && npm install && npm run dev` (port 5173, proxies /api)
Tests: `pytest -q` and `cd frontend && npm test`
Build for Flask to serve: `cd frontend && npm run build`
```

Retake `screenshot.png` of the React UI at the same viewport as the old one.

- [ ] **Step 5: Commit, push, open the PR**

```bash
git add -A
git commit -m "feat(frontend): replace vanilla JS UI with the React app; docs and screenshot"
git push -u origin react-frontend
gh pr create --title "React + TypeScript frontend" --body-file docs/superpowers/specs/2026-09-18-react-frontend-design.md
```

Report the PR URL. Do not merge. Ali approves the PR; Render deploys from `main` after merge. If the Render build fails on `npm` not found, add a `Dockerfile` (python:3.12-slim, install Node 22 from nodesource, `npm ci && npm run build`, `gunicorn app:app`) and switch `render.yaml` to `runtime: docker` in a follow-up commit on the same branch.

---

## Self-Review

**Spec coverage:** Layout → Task 1 and File Map. Server contract → Task 2 types. Flask changes → Tasks 1 and 12. Parity items 1 (boot, shimmer) → Tasks 5 and 11; 2 (poll, offset, offline) → Task 5; 3 (tick) → Tasks 4, 5, 9; 4 (breach toast) → Task 8; 5 (filters, search) → Task 5; 6 (rows, quick actions, collapse) → Tasks 5 and 11; 7 (optimistic, undo) → Task 6; 8 (local mirror) → Task 4; 9 (tiles) → Task 8; 10 (VIP banner) → Task 8; 11 (drawer) → Task 9; 12 (form) → Task 7; 13 (keyboard) → Task 10; 14 (toasts) → Task 6; 15 (acting agent) → Task 4; 16 (reset) → Task 10; 17 (FLIP) → Task 11. Testing, CI, deploy → Tasks 1, 10, 12.

**Placeholder scan:** none. Every code step carries the code.

**Type consistency:** `ToastFn` returns `{ dismiss }` everywhere; `useTickets` option names match between Tasks 5, 6, and App; `QueueFilter` exported from `QueueToolbar` and re-exported by `Queue`; `applyTicket(store, ticket, priorities)` argument order is consistent across Tasks 4 and 6; `visibleQueueIds(store, filter, search, nowMs)` is used by both `Queue` and the shortcut wiring in Task 10.
