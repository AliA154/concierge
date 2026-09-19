# Concierge React + TypeScript Frontend — Design

Date: 2026-09-18. Status: approved design, awaiting implementation plan.

## Goal

Replace the single-file vanilla JavaScript UI (`static/app.js`, `templates/index.html`) with a React 18 + TypeScript application built by Vite, served by the existing Flask app at the same URL, with full feature parity and a tested frontend in CI. Nothing about the JSON API changes.

## Non-goals

- No new product features. Parity with today's UI is the acceptance bar.
- No router. The app is one screen plus a drawer and an overlay.
- No state library. The current app is one state object, a 15 second poll, and a 1 second tick; typed hooks cover that.
- No visual redesign. The existing `style.css` moves into the frontend unchanged and every component keeps the current class names.
- No backend changes beyond serving the built bundle.

## Repository layout

```
concierge/                 (unchanged Flask package; index route now serves the bundle)
frontend/
  package.json             react, react-dom, typescript, vite, vitest, @testing-library/*, msw, eslint
  vite.config.ts           dev proxy /api -> http://localhost:5001, build outDir dist
  tsconfig.json            strict: true, noUncheckedIndexedAccess: true
  index.html
  src/
    main.tsx
    App.tsx
    styles.css             (moved verbatim from static/style.css)
    api/types.ts           server shapes (see below)
    api/client.ts          typed fetch wrapper
    lib/sla.ts             pure SLA math and formatters
    lib/format.ts          fmtClock, fmtAge, fmtRelative, fmtDeskTime, clamp01
    hooks/useMeta.ts
    hooks/useTickets.ts
    hooks/useTick.ts
    hooks/useActingAgent.ts
    hooks/useShortcuts.ts
    hooks/useFlip.ts
    hooks/useTween.ts
    components/TopBar.tsx, AgentPicker.tsx
    components/MetricsTiles.tsx, Tile.tsx
    components/VipBanner.tsx
    components/TicketForm.tsx, PriorityPreview.tsx
    components/Queue.tsx, QueueToolbar.tsx, QueueRow.tsx, SlaInstrument.tsx, ResolvedList.tsx, DoneRow.tsx, EmptyState.tsx
    components/Drawer.tsx, DrawerIdentity.tsx, SlaRing.tsx, DrawerControls.tsx, Timeline.tsx, NoteComposer.tsx
    components/Toasts.tsx  (ToastProvider + useToast)
    components/ShortcutsOverlay.tsx
  src/test/                setup.ts (MSW server, jest-dom), handlers.ts (API mocks), fixtures.ts
```

Target 40 to 150 lines per file. Anything over 200 lines is split.

## Server contract (unchanged)

- `GET /api/meta` → `{ types, states, priorities, impacts, urgencies, priority_matrix: Record<"Impact|Urgency", Priority>, sla_targets: Record<Priority, number>, transitions: Record<State, State[]>, agents: {name, initials, color}[] }`
- `GET /api/tickets` → `{ now, queue: Ticket[], resolved: Ticket[], metrics }`
- `GET /api/tickets/:id` → `{ now, ticket, events: Event[] }`
- `POST /api/tickets` body `{ subject, requester, ticket_type, impact, urgency, is_vip }` → 201 Ticket
- `PATCH /api/tickets/:id` body `{ state? , assigned_to? }` → Ticket
- `POST /api/tickets/:id/notes` body `{ note }` → 201 Event
- `POST /api/tickets/:id/reopen` → Ticket
- `POST /api/demo/reset` → `{ ok, message }` (429 inside the cooldown)
- Errors: `{ error: { code, message } }`. Mutations send `X-Agent: <acting agent name>`.

`Ticket` fields used by the UI: id, number, subject, requester, ticket_type, impact, urgency, priority, state, is_vip, assigned_to, created_at, resolved_at, closed_at, on_hold_since, held_minutes, reopened_count, sla_target_min, sla_elapsed_min, sla_remaining_min, sla_status, sla_met. `types.ts` declares exactly these; nothing is `any`.

## Flask changes

- `index()` returns `frontend/dist/index.html` when it exists, else a 503 with a one line message telling the developer to run the frontend build.
- A static route serves `frontend/dist/assets/*` with long cache headers (Vite hashes filenames).
- `templates/` and `static/` are deleted in the final commit. `create_app` stops declaring `template_folder` and `static_folder`.
- `tests/test_api.py`'s index test asserts the built `index.html` is served when a stub `dist` exists and the 503 when it does not.

## Behavior to preserve (parity checklist)

1. Boot: meta and tickets fetched in parallel; skeleton shimmer only if the first fetch takes over 300 ms.
2. Poll `/api/tickets` every 15 s; store server clock offset; on failure keep last state and show the reconnect pill.
3. 1 s tick updates desk clock, row SLA clocks, bar widths, ramp classes, ages, drawer ring, and the document title breach count. On Hold rows freeze their instrument; ages still tick.
4. Breach crossing toasts once per ticket per crossing (memory carried across polls).
5. Queue: server order preserved; filters all / vip / at_risk (breached stays in at_risk) / unassigned with live counts; search over subject, requester, number; resolved section honors search only.
6. Rows: priority glyph with title, subject and requester, reopened tag, hover quick actions (Take, Start / Resolve / Resume), type tag, assignee avatar, VIP star, age, SLA instrument. Resolve from a row collapses it for 200 ms first.
7. Optimistic mutations for state change, assign, and create, with snapshot and revert on error and the server's message toasted. Resolve shows an Undo toast that calls reopen.
8. Local transition mirror: hold accounting, resolved freeze of `sla_met`, auto-assign to the acting agent on In Progress.
9. Metrics tiles: Open, Unassigned, At risk, Breaching (pulse dot), SLA met (donut, color by threshold), MTTR; 300 ms count-up tween, instant under reduced motion.
10. VIP banner for the first breached VIP ticket; click scrolls to the row and opens the drawer.
11. Drawer: identity, assignee select, SLA ring, state controls from `meta.transitions`, Reopen when Resolved, timeline newest first, note composer that keeps its draft across refreshes and restores it on a failed post; Closed tickets lock the composer.
12. Form: selects populated from meta, priority preview from `priority_matrix`, SLA target halved when VIP is checked, inline error persists until the next submit, focus returns to subject after create.
13. Keyboard: n, /, j, k, Enter, 1, 2, 3, Esc, ? with the same guards (ignored while typing or with modifiers; inert under the overlay). Illegal transitions shake the row and send nothing.
14. Toasts: info / ok / error / crit, optional action, max three on screen, 200 ms exit.
15. Acting agent persisted in localStorage under `concierge.actingAgent`, defaulting to the first agent.
16. Reset demo behind a confirm; closes the drawer and refetches.
17. FLIP reorder on queue changes and `row-enter` on new rows, skipped under reduced motion.

## Data flow

`App` mounts `ToastProvider`, calls `useMeta()` and `useTickets()`, and passes the acting agent down. `useTickets` exposes `{ tickets, queueIds, resolvedIds, metrics, loaded, offline, now(), refresh, createTicket, changeState, assignTicket, reopenTicket, resetDemo }`. Components receive plain props. `useTick` provides `nowMs` on a one second cadence to the few components that show live time; rows receive it but memoize everything not derived from it.

## Error handling

- `client.ts` throws `ApiError { code, message }` built from the envelope, or a generic message when the body is not JSON.
- Every mutation in `useTickets` follows: snapshot → apply local → render → await → apply server → refresh; on catch: revert snapshot, toast message.
- Meta fetch failure retries every 3 s; nothing renders without meta.
- The drawer ignores responses for a ticket it has moved away from.

## Testing

- Vitest, jsdom, React Testing Library, MSW for `/api/*`, fixtures with a VIP, a breached, an On Hold, and a Resolved ticket.
- `lib/sla.ts` and `lib/format.ts`: 100 percent, table driven, including breach while on hold and the 75 percent at_risk boundary.
- `useTickets`: poll stores clock offset; failed poll sets offline and keeps data; changeState reverts on 400 and toasts the server message; create inserts in sort position.
- Components: queue filters and counts; search; form priority preview and VIP halving; create posts the right body with X-Agent; drawer shows transitions from meta, reopen only when Resolved, note draft survives a failed post; reset demo calls the endpoint after confirm.
- Coverage threshold 80 percent lines and branches, enforced in `vitest.config.ts`.
- ESLint (typescript-eslint, react-hooks) and `tsc --noEmit` must pass.

## CI and deploy

- `.github/workflows/ci.yml` gains a `frontend` job: Node 22, `npm ci`, `npm run lint`, `npm run typecheck`, `npm test -- --coverage`, `npm run build`. The Python job depends on it so the index test can use the built bundle.
- `render.yaml` buildCommand becomes `pip install -r requirements.txt && npm --prefix frontend ci && npm --prefix frontend run build`. If Render's Python image lacks Node, switch the service to a `Dockerfile` (python:3.12-slim plus Node 22) in the same PR.
- All work on branch `react-frontend`, merged through a pull request that Ali approves before Render deploys, because the live URL is on his resume.

## Build order

1. Scaffold, tooling, CI job, Flask serving of `dist`, hello-world render at `/`.
2. `types`, `client`, `sla`, `format` with tests.
3. `useMeta`, `useTick`, `useActingAgent`, TopBar.
4. `useTickets` polling and clock offset; Queue read-only with SLA instruments and filters.
5. Mutations: quick actions, optimistic revert, toasts, undo.
6. TicketForm and PriorityPreview.
7. MetricsTiles, VipBanner, title breach count.
8. Drawer with all sections and NoteComposer.
9. Shortcuts and overlay.
10. FLIP and tweens.
11. Delete old `static/` and `templates/`, update Flask tests, README, screenshot.
