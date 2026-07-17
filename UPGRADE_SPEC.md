# Concierge Upgrade Spec — v2 "Desk that breathes"

**Status: APPROVED. This document is the contract.** Backend and frontend are built in
parallel by different agents from this spec alone. The API contract in §4 is LAW: neither
side may deviate from it without editing this file first.

---

## 1. Product thesis

Concierge stays what it is: a single-screen IT service desk console whose story is
**VIP priority routing + live SLA clocks**. This round upgrades it in three directions
at once, and every selected feature serves at least one:

1. **ITIL correctness** a desk manager can feel in 60 seconds: the SLA clock pauses On Hold,
   priority is derived from Impact × Urgency, every ticket has an owner and an audit trail,
   Resolved is distinct from Closed, reopens are counted.
2. **Instrument-grade presentation**: dense Linear-style queue rows, per-second ticking
   countdown clocks with color ramps, a detail drawer with an SLA ring and timeline,
   FLIP reorder animation when a VIP ticket leapfrogs the queue.
3. **Visible engineering hygiene** in the repo: app-factory package layout, ~30 pytest
   tests over the tricky math, GitHub Actions CI with badge, a README that states tradeoffs.

Hard constraints (unchanged, non-negotiable):

- Flask + SQLite + vanilla HTML/CSS/JS. No build step. No CDN scripts. Zero frontend deps.
- `pip install -r requirements.txt && python app.py` must work; `gunicorn app:app` must work
  unchanged so `render.yaml` needs no edit.
- No auth. The agent picker is cosmetic ("acting as"), enforced nowhere.
- Fresh/ephemeral DB must look alive (curated deterministic seed).

### Selected features (the whole list — nothing else ships this round)

| # | Feature | Side |
|---|---------|------|
| 1 | SLA clock pauses On Hold (accrued hold time) | Backend logic, frontend display |
| 2 | Impact × Urgency → derived priority (matrix served by API) | Backend derive, frontend preview |
| 3 | ServiceNow-style ticket numbers (INC0000042) | Backend computed field |
| 4 | Ticket events audit trail + work notes | Backend table/endpoints, frontend timeline |
| 5 | Agent assignment + "Acting as" picker + auto-assign on take | Both |
| 6 | Resolved vs Closed + Reopen flow with reopen count, frozen SLA outcome | Both |
| 7 | SLA status tiers: ok / at_risk (75%) / breached / paused / met / missed | Backend computed, frontend ramp |
| 8 | 1-second client-side ticking clocks + countdown bars + breach-the-moment-it-happens | Frontend |
| 9 | Dense data-grid queue rows replacing cards | Frontend |
| 10 | Ticket detail drawer: SLA ring, timeline, work-note form, state controls | Frontend |
| 11 | Optimistic updates + FLIP queue reorder + undo toast | Frontend |
| 12 | Metrics row upgrade: 6 instrument tiles + SLA donut + VIP-breach banner | Frontend |
| 13 | Filters (All/VIP/At risk/Unassigned) + text search, client-side | Frontend |
| 14 | Keyboard shortcuts (n / j k Enter Esc 1 2 3 ?) + shortcuts overlay | Frontend |
| 15 | Skeleton load, crafted empty states, "Reconnecting…" pill, breach toasts + title counter | Frontend |
| 16 | Visual system pass: tokens, type scale, tabular-nums mono numerals, favicon | Frontend |
| 17 | Curated deterministic seed: 8 open demo beats + 14-ticket resolved backfill + seeded timelines | Backend |
| 18 | `POST /api/demo/reset` + footer Reset button | Backend endpoint, frontend button |
| 19 | Package restructure: `concierge/` app factory, thin `app.py` shim | Backend |
| 20 | Validation + consistent JSON error envelope everywhere | Backend |
| 21 | Pytest suite (~30 tests) + requirements-dev.txt | Backend |
| 22 | GitHub Actions CI (ruff + pytest, 3.11/3.12) + badge | Backend |
| 23 | README rewrite: architecture, design decisions, API table, drift fixes | Backend |
| 24 | Type hints + docstrings on the package | Backend |

### Explicitly cut (do not build; do not partially build)

- **Second first-response SLA clock** — two clocks per row wrecks the dense grid, and it
  interacts messily with hold-pause. The pause + matrix already carry the ITIL story.
- **Demo Mode auto-arriving tickets + time fast-forward** — fast-forward mutates
  `created_at` but not the hold-accounting fields coherently, and auto-spawn risks a
  runaway queue for concurrent visitors. The 1s clocks plus a seeded ticket that breaches
  ~3 minutes after page load deliver the "alive" moment without mutation endpoints.
- **Analytics tab with SVG charts** — a second surface at large effort with high
  "amateur chart" risk. One excellent console beats a console plus a mediocre dashboard.
- **Ctrl+K command palette** — redundant garnish once shortcuts exist; fiddly focus-trap
  work. Cut; plain shortcuts stay.
- **CSV export / shift report** — low wow, adds toolbar clutter.
- **PRAGMA user_version migration runner** — the DB is deleted on every Render deploy;
  a migration system with nothing to migrate reads as theater. `init_db()` creates the
  final schema; README explains the tradeoff instead.
- **mypy in CI** — type hints ship, but CI stays ruff + pytest (fast, no annotation-fight
  flakiness).
- **Auto-escalation events written during GET** — writing to the DB as a side effect of a
  read is exactly what a reviewer circles in red. `sla_status` is computed, never stored.
- **PATCHable priority / is_vip** — conflicts with derived priority. Priority changes only
  by changing impact/urgency, which is out of scope for PATCH this round.
- **Metrics sparkline + canvas favicon badge** — noise risk; title-bar counter kept instead.

---

## 2. Domain rules (LAW — both sides implement identically)

### 2.1 Enums

```
TICKET_TYPES = ["Incident", "Request", "Problem", "Change"]
STATES       = ["New", "In Progress", "On Hold", "Resolved", "Closed"]
PRIORITIES   = ["Critical", "High", "Medium", "Low"]
IMPACTS      = ["High", "Medium", "Low"]      # how many people affected
URGENCIES    = ["High", "Medium", "Low"]      # how time-sensitive
```

### 2.2 Priority matrix (server derives; served via /api/meta; JS reads it from meta — never hardcode in JS)

| Impact \ Urgency | High     | Medium | Low    |
|------------------|----------|--------|--------|
| **High**         | Critical | High   | Medium |
| **Medium**       | High     | Medium | Low    |
| **Low**          | Medium   | Low    | Low    |

JSON key form: `"<Impact>|<Urgency>"`, e.g. `"High|Medium": "High"`.

### 2.3 SLA targets (resolution SLA, minutes)

```
SLA_TARGETS = {"Critical": 30, "High": 60, "Medium": 240, "Low": 480}
sla_target_min = SLA_TARGETS[priority] // 2 if is_vip else SLA_TARGETS[priority]
```

VIP is an SLA modifier and a queue-sort key, **not** a priority bump. (Interview line:
"VIP is effectively an urgency multiplier applied to the clock, not the triage.")

### 2.4 Hold-pause accounting

- Entering `On Hold`: stamp `on_hold_since = now`.
- Leaving `On Hold` (to In Progress **or** Resolved): `held_minutes += minutes_between(on_hold_since, now)`; set `on_hold_since = NULL`. Resolving while on hold accrues first, then resolves.
- **Effective elapsed** (the only elapsed that matters, everywhere):

```
effective_elapsed = minutes_between(created_at, now_or_resolved_at)
                    - held_minutes
                    - (minutes_between(on_hold_since, now) if on_hold_since else 0)
remaining = sla_target_min - effective_elapsed
```

### 2.5 SLA status (computed at serialize time, never stored)

For open tickets (New / In Progress / On Hold), in priority order:

1. `breached` — effective_elapsed > target (sticky: applies even while On Hold)
2. `paused`  — state == On Hold
3. `at_risk` — consumed ≥ 75% of target
4. `ok`      — otherwise

For Resolved/Closed tickets: `met` or `missed`, read from the frozen `sla_met` flag.

### 2.6 Frozen SLA outcome

At the **first** transition to Resolved, stamp `sla_met = 1 if effective_elapsed <= target else 0`.
Never modify it afterwards — reopening cannot retroactively un-breach an SLA (or breach a met one).
A reopened ticket's live clock resumes from its hold-adjusted elapsed; its eventual metrics
contribution stays the frozen first-resolution outcome. Put a code comment on this policy;
interviewers ask about it.

### 2.7 State machine (400 on anything else)

```
New          → In Progress | On Hold | Resolved
In Progress  → On Hold | Resolved
On Hold      → In Progress | Resolved
Resolved     → Closed            (via PATCH)
Resolved     → In Progress       (ONLY via POST /reopen — PATCH state="In Progress" from Resolved is 400)
Closed       → (terminal)
```

Transitions map is exported in `/api/meta` so the frontend renders only legal buttons.

- `state → Resolved`: stamp `resolved_at` (after hold accrual), freeze `sla_met` if NULL.
- `state → Closed`: stamp `closed_at`.
- Reopen: state → In Progress, `resolved_at = NULL` (keep `sla_met`!), `reopened_count += 1`.

### 2.8 Ticket numbers

Computed in `serialize()`, never stored (type is immutable after creation):

```
PREFIX = {"Incident": "INC", "Request": "REQ", "Problem": "PRB", "Change": "CHG"}
number = f"{PREFIX[ticket_type]}{id:07d}"     # e.g. INC0000042
```

### 2.9 Queue sort (unchanged — the app's identity)

```
key = (0 if is_vip else 1, PRIORITY_RANK[priority], created_at)   # Critical=0 … Low=3
```

On Hold tickets do **not** sink; a held VIP Critical stays visible at the top with a
paused chip. Document this choice in the README.

### 2.10 Agents

```
AGENTS = [
  {"name": "Ali Ahmad",     "initials": "AA", "color": "#4c8bf5"},
  {"name": "Priya Sharma",  "initials": "PS", "color": "#a78bfa"},
  {"name": "Marcus Tate",   "initials": "MT", "color": "#34d399"},
  {"name": "Dana Whitfield","initials": "DW", "color": "#f5a623"},
]
```

Actor attribution: every mutating request may carry an `X-Agent: <name>` header.
If the value exactly matches an agent name, that name is the event actor; otherwise the
actor is `"System"`. No 400 for bad/missing header — it is cosmetic by design (comment this).

**Auto-assign rule:** PATCH that moves an unassigned ticket to `In Progress` with a valid
X-Agent auto-assigns to that agent (that is how real desks behave) and writes an
`assigned` event in addition to the `state_change` event.

---

## 3. Data model (final SQLite schema — complete, no other tables/columns)

```sql
CREATE TABLE IF NOT EXISTS tickets (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    subject        TEXT    NOT NULL,                 -- 1..200 chars
    requester      TEXT    NOT NULL,                 -- 1..200 chars
    ticket_type    TEXT    NOT NULL,                 -- TICKET_TYPES
    impact         TEXT    NOT NULL DEFAULT 'Medium',-- IMPACTS
    urgency        TEXT    NOT NULL DEFAULT 'Medium',-- URGENCIES
    priority       TEXT    NOT NULL,                 -- derived at create, stored
    state          TEXT    NOT NULL DEFAULT 'New',   -- STATES
    is_vip         INTEGER NOT NULL DEFAULT 0,       -- 0/1
    assigned_to    TEXT,                             -- agent name or NULL
    created_at     TEXT    NOT NULL,                 -- ISO-8601 UTC with offset
    resolved_at    TEXT,                             -- NULL when open or reopened
    closed_at      TEXT,
    on_hold_since  TEXT,                             -- set only while state = 'On Hold'
    held_minutes   REAL    NOT NULL DEFAULT 0,       -- accrued completed hold time
    reopened_count INTEGER NOT NULL DEFAULT 0,
    sla_met        INTEGER                           -- NULL until first resolution; then 0/1 forever
);

CREATE TABLE IF NOT EXISTS ticket_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id  INTEGER NOT NULL REFERENCES tickets(id),
    actor      TEXT    NOT NULL DEFAULT 'System',
    event_type TEXT    NOT NULL,   -- 'created'|'state_change'|'work_note'|'assigned'|'reopened'
    detail     TEXT    NOT NULL,
    created_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_ticket ON ticket_events(ticket_id, created_at);
```

Event `detail` formats (exact — the frontend renders these verbatim):

- `created`:      `Ticket created — {priority} {ticket_type}` + ` (VIP)` if VIP
- `state_change`: `{old_state} → {new_state}`
- `work_note`:    the note text itself
- `assigned`:     `Assigned to {name}` / `Unassigned`
- `reopened`:     `Reopened — resolution did not hold (reopen #{reopened_count})`

---

## 4. API contract (LAW)

All responses are JSON. All timestamps ISO-8601 UTC. Every error — including Flask-level
404/405/500 via `app.errorhandler` — uses the envelope:

```json
{ "error": { "code": 400, "message": "human-readable message" } }
```

Request bodies parsed with `get_json(silent=True)`; `None` → 400 `"request body must be JSON"`.

### 4.1 Ticket object (returned everywhere a ticket appears)

```json
{
  "id": 7,
  "number": "INC0000007",
  "subject": "CEO cannot join board video call",
  "requester": "M. Reyes (CEO)",
  "ticket_type": "Incident",
  "impact": "High",
  "urgency": "High",
  "priority": "Critical",
  "state": "In Progress",
  "is_vip": true,
  "assigned_to": "Ali Ahmad",
  "created_at": "2026-07-16T14:02:11+00:00",
  "resolved_at": null,
  "closed_at": null,
  "on_hold_since": null,
  "held_minutes": 0.0,
  "reopened_count": 0,
  "sla_target_min": 15,
  "sla_elapsed_min": 9.4,
  "sla_remaining_min": 5.6,
  "sla_consumed_pct": 63,
  "sla_status": "at_risk",
  "sla_met": null
}
```

Notes: `sla_elapsed_min` is always the hold-adjusted effective elapsed (§2.4); for
Resolved/Closed it is the elapsed at resolution. `sla_remaining_min` is `null` for
Resolved/Closed. `sla_consumed_pct` = round(100 × elapsed/target), may exceed 100.
`sla_status` ∈ ok|at_risk|paused|breached|met|missed. `sla_met` null|true|false.

### 4.2 Endpoints

**`GET /`** → renders `templates/index.html`.

**`GET /api/meta`** → 200

```json
{
  "types": ["Incident","Request","Problem","Change"],
  "states": ["New","In Progress","On Hold","Resolved","Closed"],
  "priorities": ["Critical","High","Medium","Low"],
  "impacts": ["High","Medium","Low"],
  "urgencies": ["High","Medium","Low"],
  "priority_matrix": { "High|High": "Critical", "High|Medium": "High", "High|Low": "Medium",
                       "Medium|High": "High", "Medium|Medium": "Medium", "Medium|Low": "Low",
                       "Low|High": "Medium", "Low|Medium": "Low", "Low|Low": "Low" },
  "sla_targets": { "Critical": 30, "High": 60, "Medium": 240, "Low": 480 },
  "transitions": { "New": ["In Progress","On Hold","Resolved"],
                   "In Progress": ["On Hold","Resolved"],
                   "On Hold": ["In Progress","Resolved"],
                   "Resolved": ["Closed"],
                   "Closed": [] },
  "agents": [ { "name": "Ali Ahmad", "initials": "AA", "color": "#4c8bf5" }, ... ]
}
```

**`GET /api/tickets`** → 200

```json
{
  "now": "2026-07-16T14:11:33+00:00",
  "queue":    [ Ticket, ... ],
  "resolved": [ Ticket, ... ],
  "metrics":  Metrics
}
```

- `queue`: states New/In Progress/On Hold, sorted per §2.9.
- `resolved`: states Resolved/Closed, sorted newest `resolved_at` first (Closed use `resolved_at` too).
- `now`: server time — the frontend computes clock-skew offset from this (§7.3).

**Metrics object:**

```json
{
  "open": 8, "vip_open": 2, "unassigned": 3,
  "at_risk": 1, "breaching": 2,
  "resolved": 15, "mttr_min": 41.6, "sla_met_pct": 87,
  "reopened": 1
}
```

Definitions: `open/vip_open/unassigned/at_risk/breaching` over open tickets
(`at_risk`/`breaching` count `sla_status`); `resolved` = Resolved+Closed count;
`mttr_min` = mean `sla_elapsed_min` over Resolved+Closed, 1 decimal, `0` if none;
`sla_met_pct` = round(100 × met / (met+missed)) over tickets with non-NULL `sla_met`,
`100` if none (attainment is measured over completed work; live pain is the `breaching`
tile — document this in the README); `reopened` = count of tickets with `reopened_count > 0`.

**`GET /api/tickets/<id>`** → 200

```json
{ "now": "...", "ticket": Ticket, "events": [ Event, ... ] }
```

`events` newest-first: `{ "id": 3, "actor": "Priya Sharma", "event_type": "work_note",
"detail": "Called requester, no answer, left VM — placing On Hold", "created_at": "..." }`.
Unknown id → 404 envelope.

**`POST /api/tickets`** — body:

```json
{ "subject": "...", "requester": "...", "ticket_type": "Incident",
  "impact": "Medium", "urgency": "Medium", "is_vip": false }
```

Rules: `subject`/`requester` required, trimmed, 1–200 chars else 400.
`ticket_type`/`impact`/`urgency` optional (defaults Incident/Medium/Medium) but if present
must be valid enum values — **400 listing allowed values, never silent coercion**.
`priority` is derived server-side (§2.2); a client-sent `priority` field is ignored.
Writes a `created` event (actor from X-Agent).
→ **201**, `Location: /api/tickets/<id>` header, body = Ticket.

**`PATCH /api/tickets/<id>`** — body may contain any subset of exactly `{state, assigned_to}`;
unknown keys ignored, empty effective body → 400 `"nothing to update"`.

- `state`: must be a legal transition per §2.7 else 400 (message names the illegal move,
  e.g. `"cannot move Closed → In Progress (Closed is terminal; use /reopen from Resolved)"`).
  Applies hold accrual / resolved_at / closed_at / sla_met per §2. Writes `state_change` event.
- `assigned_to`: agent name from AGENTS or `null` to unassign, else 400. Writes `assigned` event.
- Auto-assign per §2.10.
- → 200 body = Ticket. Unknown id → 404.

**`POST /api/tickets/<id>/notes`** — body `{ "note": "text" }`, trimmed, 1–1000 chars else 400.
Writes `work_note` event (actor from X-Agent). Allowed in any state except Closed (400).
→ **201**, body = the Event object.

**`POST /api/tickets/<id>/reopen`** — no body. Legal only from `Resolved` else 400.
Applies §2.7 reopen semantics, writes `reopened` event. → 200 body = Ticket.

**`POST /api/demo/reset`** — no body. Calls `seed_db(force=True)`. Rate-limited: a second
call within 10 seconds → 429 envelope. → 200 `{ "ok": true, "message": "Demo data reset" }`.
(Code comment: unauthenticated by design — single-user demo on an ephemeral DB.)

---

## 5. Workstream split (disjoint files — zero overlap)

### BACKEND workstream owns

```
app.py                      → thin shim: from concierge import create_app; app = create_app()
                              plus the __main__ block (PORT env, default 5001, debug=True)
concierge/__init__.py       → create_app(db_path: str | None = None); registers blueprint,
                              error handlers; seeds unless app.config["TESTING"]
concierge/db.py             → get_db / close_db / init_db (schema from §3)
concierge/sla.py            → all constants (§2.1–2.3, 2.8–2.10), derive_priority,
                              sla_minutes, effective_elapsed, serialize, queue_sort_key,
                              build_metrics — pure logic, ZERO Flask imports
concierge/routes.py         → one Blueprint, all endpoints from §4
concierge/seed.py           → SAMPLE data + seed_db(db_path, force=False)
tests/conftest.py           → create_app(tmp_path db) + client fixtures, frozen-time helper
tests/test_sla.py, test_queue.py, test_api.py, test_seed.py
requirements.txt            → Flask, gunicorn (unchanged pins ok)
requirements-dev.txt        → pytest, ruff
pyproject.toml              → [tool.ruff]: line-length 100, target py311, select E,F,I,UP,B
.github/workflows/ci.yml    → push+PR; matrix python 3.11/3.12; pip install both req files;
                              ruff check .; pytest -q
README.md                   → full rewrite (§8)
DELETE: seed.py (root)      → superseded by concierge/seed.py; fix README drift
```

Deployment invariants: `gunicorn app:app` still boots (CI smoke test: `GET /` → 200 via
test client); `render.yaml` untouched; DB path from env `CONCIERGE_DB` else
`<repo>/concierge.db`; seeding never fires against a test DB (factory param wins over env).

### FRONTEND workstream owns

```
templates/index.html        → full rewrite (layout §6.2, skeleton markup, favicon data-URI,
                              shortcuts overlay markup, drawer + toast containers)
static/style.css            → full rewrite on the token system (§6)
static/app.js               → full rewrite (§7); single file, ES2020, no deps,
                              organized in banner-commented sections:
                              state / api / render / tick / drawer / shortcuts / toasts
```

Frontend builds strictly against §4. Until the new backend lands, develop against the
current backend for GET/POST/PATCH-state and stub the rest from the spec examples.

**No file appears in both lists.** Backend never edits templates/static; frontend never
edits Python/CI/README.

---

## 6. Visual design direction (concrete)

Committed dark theme (an ops console; no light mode this round — set `color-scheme: dark`).

### 6.1 Tokens (exact values — put at top of style.css)

```css
:root {
  --bg:        #0b0e14;
  --surface-1: #11151c;   /* panels, topbar */
  --surface-2: #171c26;   /* rows, inputs */
  --surface-3: #1e2530;   /* hover raise */
  --line:      rgba(255,255,255,0.06);
  --text:      #e6edf3;
  --muted:     #8b98a5;
  --muted-2:   #5c6773;
  --accent:    #4c8bf5;
  --vip:       #f5b74c;   --vip-bg:  rgba(245,183,76,0.12);
  --crit:      #f56c6c;   --crit-bg: rgba(245,108,108,0.12);
  --warn:      #f5a623;   --warn-bg: rgba(245,166,35,0.12);
  --ok:        #4caf82;   --ok-bg:   rgba(76,175,130,0.12);
  --radius: 6px;                      /* ONE radius everywhere */
  --space-1: 4px; --space-2: 8px; --space-3: 12px;
  --space-4: 16px; --space-5: 24px; --space-6: 32px;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
```

Priority colors: Critical `--crit`, High `--warn`, Medium `--accent`, Low `--muted`.
Panels get `box-shadow: inset 0 1px 0 rgba(255,255,255,0.04)`. Focus:
`:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }`.
Type scale — only these sizes: 11 / 12 / 13 / 15 / 20 / 26 px. All numerals (IDs, clocks,
metrics, ages) use `font-family: var(--mono); font-variant-numeric: tabular-nums;`.
Respect `prefers-reduced-motion` for every animation. Favicon: inline SVG data-URI, the
◆ glyph in `--accent` on transparent.

### 6.2 Layout regions

```
┌ topbar ─────────────────────────────────────────────────────────────────┐
│ ◆ Concierge · tagline      Desk time 14:11:33 UTC   [Acting as ⦿ AA ▾] │
├ main (max-width 1160px) ────────────────────────────────────────────────┤
│ [VIP breach banner — only when a VIP open ticket is breached]           │
│ metrics: 6 tiles                                                        │
│ ┌ new-ticket panel (300px) ┐ ┌ queue panel (1fr) ──────────────────────┐│
│ │ subject / requester      │ │ [All|VIP|At risk|Unassigned] [search 🔍]││
│ │ type / impact / urgency  │ │ ── dense grid rows ──                   ││
│ │ Priority preview: High   │ │ …                                       ││
│ │ [VIP toggle] [Create]    │ │ Resolved (collapsed rows, 60% opacity)  ││
│ └──────────────────────────┘ └─────────────────────────────────────────┘│
│ footer: "Press ? for shortcuts · Reset demo data"                       │
└──────────────────────────────────────────────────────────────────────────┘
[detail drawer: fixed right, 420px]  [toast stack: bottom-right, max 3]
```

Under 860px: single column, queue rows wrap to two lines (subject line + meta line).

### 6.3 Queue row (the centerpiece)

`grid-template-columns: 92px 20px minmax(0,1fr) auto auto 28px 64px 150px`, height ≈ 44px,
hairline `border-bottom: 1px solid var(--line)`, no per-row borders:

1. **Number** `INC0000042` — mono 12px `--muted`.
2. **Priority glyph** — 10px filled square in priority color, `title` tooltip.
3. **Subject** 13px/500 `--text` · **requester** 12px `--muted`, single line, ellipsis.
   Reopened tickets append an amber tag `Reopened ×1` (11px, `--warn-bg`/`--warn`).
4. **Type tag** — 11px pill, `--surface-1` bg.
5. **Assignee chip** — 20px circle, agent color bg, initials 10px/600; unassigned shows a
   dashed-outline circle and, on row hover, a **Take** ghost button (PATCH assigned_to = acting agent).
6. **VIP** — gold ★ only when set; VIP rows also get a 3px `--vip` left rule and the
   existing subtle gold gradient wash. Critical non-VIP rows get a 3px `--crit` left rule.
7. **Age** — `38m` relative, mono 12px `--muted`.
8. **SLA cell** — see 6.4.

Row hover: background `--surface-3`, reveals Take + a single next-state quick button
(New→"Start", In Progress→"Resolve"...). Row click (not on a button) opens the drawer.
Selected row (keyboard): 2px `--accent` left rule + `--surface-3`.

Resolved rows: same grid, 60% opacity, SLA cell shows outcome chip — `Met in 8m` (ok) /
`Missed · 74m` (crit) / Closed adds a lock glyph.

### 6.4 Signature moment — the SLA instrument

Per open row, right-aligned stack:
- **Clock**: mono 15px/600 tabular-nums, `MM:SS` remaining; negative `-MM:SS` once over,
  rendered as chip `BREACHED +12:04` (crit color, `--crit-bg`).
- **Bar**: 3px, width = clamp(remaining/target), directly under the clock, 64px wide.
- **Ramp** (matches backend §2.5 exactly): consumed < 75% → `--ok`; ≥ 75% (at_risk) →
  `--warn` + 2s opacity pulse on the clock text only; breached → solid `--crit` bar + chip.
- **Paused** (On Hold): grey chip `Paused · 32m used of 60m`, no ticking, bar frozen at
  `--muted-2`. If breached-then-held: breached chip wins, no pulse.
- The row flips to breached styling **the second** the client clock crosses zero — no
  waiting for the next poll — and fires a toast + title counter update.

### 6.5 Metrics tiles (6)

Each: 11px uppercase `--muted` label, 26px mono value, 11px context line.

1. **Open** — context `2 VIP`.
2. **Unassigned** — context `of 8 open`; value `--warn` when > 0.
3. **At risk** — value `--warn` when > 0, context `≥75% SLA used`.
4. **Breaching** — alert state when > 0: `--crit` value, `--crit-bg` tile tint, 6px dot
   with slow 2s pulse.
5. **SLA met** — value % with a 24px hand-rolled SVG donut ring beside it (two `<circle>`,
   stroke-dasharray), green ≥90 / amber ≥75 / red below; context `target ≥ 90%`.
6. **MTTR** — `41.6m`, context `15 resolved`.

Value changes between polls tween with a 300ms count-up.
**VIP breach banner** (above metrics, only when an open VIP ticket is breached):
`--crit-bg` surface, `--crit` left rule, `★ VIP ticket INC0000001 has breached SLA`,
click scrolls to and opens that drawer.

### 6.6 Drawer

420px fixed right, `transform: translateX(100%)→0` 200ms ease-out, backdrop
`rgba(0,0,0,0.45)`. Header: number (mono, muted) + subject (15px/600) + close ✕.
Identity row: requester, VIP chip, type/priority/impact-urgency line
(`P2 · High — Impact High / Urgency Medium`), assignee with **assign dropdown** (agent list + Unassign).
**SLA ring**: 96px SVG ring, same two-circle technique and color ramp, remaining `MM:SS`
centered (ticks with the 1s loop); paused/breached/met/missed states mirror §6.4.
**State controls**: segmented control rendered from `meta.transitions[state]` only
(plus a `Reopen` button when Resolved, wired to POST /reopen).
**Timeline**: vertical hairline, dot per event (color by event_type: created `--accent`,
state_change `--muted`, work_note `--text`, assigned agent-color, reopened `--warn`),
actor + relative time 11px, detail 13px, newest first.
**Work note composer**: textarea + "Add note" → POST /notes, optimistic append.
Esc / backdrop click closes. On each 15s poll, refresh only the drawer's ticket + timeline
by id; never clobber an in-progress note draft.

---

## 7. Frontend behavior spec

### 7.1 Client state (single module-level object)

```js
const state = { tickets: new Map(), queueIds: [], resolvedIds: [], metrics: {},
                meta: null, clockOffsetMs: 0, actingAgent: localStorage(...),
                filter: "all", search: "", selectedId: null, drawerId: null,
                titleBreachCount: 0 };
```

All rendering flows through `renderQueue()` / `renderMetrics()` reading this state —
filters, poll, FLIP, and selection all converge here (single render path, no rot).

### 7.2 Data flow

- Poll `GET /api/tickets` every 15s + immediately after any mutation response
  (apply the returned Ticket/Event to state first — optimistic reconcile).
- Poll failure: keep last state, show `Reconnecting…` pill in topbar; clear on success.
- All mutations send `X-Agent: <acting agent>` and `Content-Type: application/json`;
  check `response.ok`, on failure revert optimistic change and toast the envelope message.
- Escape ALL user strings via textContent-based escapeHtml before interpolation.
- One delegated click listener on the queue container reading `data-*` attributes —
  no inline `onclick` handlers anywhere.

### 7.3 The 1-second tick (kills the frozen-clock problem)

- On each poll: `state.clockOffsetMs = Date.parse(payload.now) - Date.now()`.
- `setInterval(tick, 1000)`; `tick()` computes per open ticket:

```js
const nowMs = Date.now() + state.clockOffsetMs;
let elapsedMin = (nowMs - Date.parse(t.created_at)) / 60000 - t.held_minutes;
if (t.on_hold_since) elapsedMin -= (nowMs - Date.parse(t.on_hold_since)) / 60000;
const remainingMin = t.sla_target_min - elapsedMin;
```

- Updates ONLY clock text nodes, bar widths, ramp classes, age labels, and the topbar
  desk-time clock via `querySelector('[data-id="N"] .clock')` etc. — never re-renders rows.
  Guard: skip nodes missing after a re-render. Paused tickets are skipped (frozen display).
- Client-side breach crossing: apply breached classes, fire toast
  `INC0000042 breached SLA`, update `document.title` → `(2⚠) Concierge`.

### 7.4 Optimistic updates + FLIP + undo

- State/assign click: mutate local ticket, `renderQueue()` immediately, then PATCH;
  reconcile with response; revert + error-toast on failure.
- FLIP on every `renderQueue()`: record `getBoundingClientRect().top` per `data-id` before,
  re-render, apply inverse `translateY`, transition to 0 over 250ms. Keyed strictly by
  ticket id. Skip entirely under `prefers-reduced-motion`.
- Resolving from the row/drawer: row collapses (max-height+opacity 200ms), toast
  `INC0000042 resolved · Undo` (6s). Undo = POST /reopen (this is exactly what reopen is for;
  it increments the counter — acceptable and honest).
- New VIP ticket creation is THE demo beat: form POST → ticket enters queue and FLIP-leaps
  to the top in one 250ms motion.

### 7.5 New-ticket form

Subject, requester, Type select, **Impact + Urgency selects (default Medium/Medium)**,
live read-only priority badge computed from `meta.priority_matrix["Impact|Urgency"]`
(recompute on change — never hardcode the matrix), VIP toggle (gold accent), Create button.
Inline error banner under the form on 400 (show envelope message); never silently clear.

### 7.6 Filters, search, shortcuts

- Segmented filter: All / ★ VIP / At risk / Unassigned — client-side over `state`,
  counts in each segment label. Search input filters subject+requester+number as you type.
- Shortcuts (document-level keydown, hard early-return when an
  input/textarea/select is focused): `n` focus subject · `/` focus search ·
  `j`/`k` move selection (by id, survives reorder) · `Enter` open drawer ·
  `Esc` close drawer/clear selection · `1`=In Progress `2`=On Hold `3`=Resolved on the
  selection (only if legal per `meta.transitions`, else shake the row 150ms) ·
  `?` shortcuts overlay (centered modal, `<kbd>` keycaps: `--surface-2` bg, 1px border,
  2px bottom border). Topbar hint: `Press ? for shortcuts` (11px, `--muted`).

### 7.7 First-load craft

Static skeleton in index.html (6 ghost tiles + 5 ghost rows, shimmer via translating
gradient) — but only visibly shimmer if first fetch takes >300ms. Empty queue state:
centered `--ok` check-circle inline SVG, `Queue clear` 15px, muted subline
`New tickets appear here, sorted VIP first.`. Footer `Reset demo data` link →
`confirm()` → POST /api/demo/reset → full refresh + toast.

---

## 8. Demo-liveliness plan (ownership explicit)

| Piece | Owner | Detail |
|---|---|---|
| Curated seed (below) | BACKEND | deterministic, relative timestamps, seeded events |
| Seed invariants test | BACKEND | test_seed.py enforces the beats survive edits |
| Reset endpoint + rate limit | BACKEND | §4 `/api/demo/reset` |
| Reset button + confirm | FRONTEND | footer link |
| 1s ticking clocks | FRONTEND | §7.3 |
| Live breach moment | BOTH | backend seeds it; frontend makes it visible + toast |
| Cold-start skeleton | FRONTEND | §7.7 (Render free tier wakes slowly — this gap is real) |

### Seed data (concierge/seed.py) — curated, deterministic, no `random`

**Open queue (exactly 8) — each row is a scripted demo beat:**

1. `CEO cannot join board video call` — M. Reyes (CEO), Incident, Impact High/Urgency High
   → Critical, **VIP**, created **12m ago**, New, unassigned. VIP target 15m ⇒ **breaches
   ~3 minutes after page load, live, while the hiring manager watches.** Events: created.
2. `VPN drops every few minutes` — T. Okafor (CFO), Incident, High/Medium → High, **VIP**,
   created 45m ago, In Progress, assigned Ali Ahmad. Target 30m ⇒ **already breached** (red,
   feeds VIP banner + Breaching tile). Events: created, assigned, state_change, work_note
   (`Replicated on guest wifi — suspect cert expiry on VPN gateway, renewing. ETA 30m.`).
3. `Conference room 14B display no signal` — Facilities, Incident, Medium/High → High,
   created 50m ago, **On Hold** with `on_hold_since` 20m ago and `held_minutes = 0`
   ⇒ paused chip showing ~30m used of 60m. Assigned Priya Sharma. Events: created, assigned,
   state_change ×2, work_note (`Called requester, no answer, left VM — placing On Hold.`).
4. `Repeated Outlook crashes across sales team` — IT Monitoring, Problem, High/Medium →
   High, created 50m ago, In Progress, assigned Marcus Tate ⇒ **at_risk** (~83% consumed,
   amber pulse). Events: created, assigned, state_change.
5. `New hire laptop setup for Monday` — HR Onboarding, Request, Medium/Medium → Medium,
   created 90m ago, New, unassigned. Comfortable green.
6. `Approve O365 license bump for design team` — Change Board, Change, Medium/Low → Low,
   created 3h ago, New, unassigned.
7. `Printer on 12th floor jamming` — K. Silva, Incident, Low/Medium → Low, created 2h ago,
   In Progress, assigned Dana Whitfield. Green.
8. `Meeting room mic cuts out — again` — R. Adler, Incident, Medium/Medium → Medium,
   created 26h ago, In Progress, assigned Dana Whitfield, **reopened_count = 1**,
   `sla_met = 1` (frozen from first resolution). Shows the amber `Reopened ×1` tag.
   Events: created, state_change, work_note, state_change (→Resolved), reopened, state_change.

**Resolved/Closed backfill (exactly 14):** spread deterministically over the prior 7 days
(weekday-weighted by hand, not random), mix of types/priorities, 2 VIP, resolve times chosen
so that **12 met / 2 missed ⇒ sla_met_pct lands at ~86%** (perfect 100% looks fake).
5 of them Closed (`closed_at` ~4h after `resolved_at`). Each has a plausible created +
state_change + resolved event chain; 4 include a work note in genuine desk voice.
Every event timestamp MUST fall between the ticket's created_at and resolved_at.

Seeding runs at app-factory time when the tickets table is empty (or `force=True`).
All timestamps relative to `now` so a fresh Render deploy always shows this exact tableau.

**test_seed.py invariants (backend):** fresh seed yields exactly 8 open + 14 done; ≥1 open
breached; ≥1 open with 0 < remaining ≤ 5 min; ≥1 paused with on_hold_since set; ≥1
reopened with frozen sla_met; queue[0] is the VIP Critical; sla_met_pct between 80 and 92;
seeding twice without force is a no-op; every event timestamp inside its ticket's lifespan.

---

## 9. Test plan (backend, ~30 tests — hit the tricky math, no padding)

`tests/conftest.py`: `app = create_app(db_path=tmp_path/"t.db")` with TESTING (no auto-seed),
client fixture, `mkticket(**overrides)` helper that inserts rows with explicit ISO
timestamps (no sleeping, no mocking frameworks — frozen strings).

- **test_sla.py**: sla_minutes per priority + VIP halving + unknown-priority fallback;
  derive_priority parametrized over all 9 matrix cells; effective elapsed with accrued
  `held_minutes`; effective elapsed mid-hold (`on_hold_since` set); at_risk exactly at 75%;
  breached boundary (remaining < 0); paused status On Hold; breached sticky while On Hold;
  met/missed from frozen `sla_met`.
- **test_queue.py**: VIP Low sorts above non-VIP Critical; priority order within VIP class;
  created_at tiebreak; shuffled input sorts to identical order (stability property).
- **test_api.py**: POST happy path (201, Location header, derived priority, created event,
  client `priority` ignored); missing subject 400; invalid impact 400 listing allowed values;
  201-char subject 400; malformed JSON body 400 JSON envelope (not HTML); unknown URL 404
  envelope; PATCH illegal transitions 400 (Closed→anything, Resolved→In Progress);
  hold cycle: →On Hold stamps on_hold_since, →In Progress accrues held_minutes and nulls it;
  resolve-while-held accrues then resolves; resolve stamps resolved_at + freezes sla_met
  exactly once; reopen clears resolved_at, keeps sla_met, increments count, writes event;
  reopen from New 400; assigned_to valid/invalid/null; auto-assign on →In Progress with
  X-Agent; X-Agent unknown falls back to System actor; notes 201 + event, >1000 chars 400,
  on Closed 400; metrics on empty DB (no division errors, sla_met_pct 100); demo reset
  reseeds + second call inside 10s → 429; `GET /` returns 200 (gunicorn smoke).
- **test_seed.py**: §8 invariants.

CI (`.github/workflows/ci.yml`): on push + PR · matrix 3.11/3.12 · install both requirements
files · `ruff check .` · `pytest -q`. Badge at top of README. All tests use frozen
timestamps ⇒ deterministic, no flakes.

---

## 10. README rewrite outline (backend workstream, keep under ~120 lines)

1. Title + CI badge + live-demo link (keep the cold-start warning).
2. One-paragraph pitch (VIP routing + SLA clocks) + updated screenshot
   (placeholder path `screenshot.png`; re-shoot AFTER frontend merges).
3. What it does — bullets updated for: derived priority (impact × urgency), hold-pause,
   audit trail, Resolved vs Closed, reopen tracking, agents.
4. **Design decisions** (the interview section, one short paragraph each):
   SLA computed at read time (no background jobs, clocks can't drift) · the SLA clock stops
   On Hold and how held time is accounted · priority is derived, not picked · SLA outcome
   freezes at first resolution (reopen can't un-breach) · attainment measured over completed
   tickets, live pain shown separately · SQLite/ephemeral-on-Render tradeoff (what would
   change for prod: Postgres, one line) · polling over WebSockets at this scale ·
   no pagination on a bounded demo dataset (stated non-decision) · held VIP tickets stay
   atop the queue rather than sinking.
5. API table: endpoint / method / body / response / errors (mirror §4).
6. Architecture: mermaid flow (browser poll → routes → sla.serialize → sort → JSON) +
   project layout (accurate: concierge/ package, tests/, render.yaml, requirements files).
7. Run it (fix drift: no seed.py step — seeding is automatic) + run tests
   (`pip install -r requirements-dev.txt && pytest`).

---

## 11. Build order & merge notes

- Backend order: package split → schema/sla → endpoints → seed → tests → CI → README.
- Frontend order: tokens/CSS system → grid rows + tick loop → drawer → form/matrix preview →
  FLIP/toasts → shortcuts → skeleton/empty/reset polish.
- Merge: backend first (API live), frontend second, then re-shoot `screenshot.png` and
  update the README image + take a short GIF if time allows.
- Post-merge smoke script (either side): create a VIP Critical ticket → watch it FLIP to
  the top → put it On Hold → clock pauses → resume → resolve → undo (reopen) → tag appears →
  open drawer → timeline shows every step with the acting agent. That sequence is the
  interview demo, end to end.
