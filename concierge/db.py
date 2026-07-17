"""SQLite access: per-request connection management and schema creation."""

from __future__ import annotations

import sqlite3

from flask import current_app, g

# The final schema, created outright. There is no migration runner on purpose:
# the demo DB is ephemeral (deleted on every Render deploy), so a migration
# system would have nothing to migrate. The README documents this tradeoff.
SCHEMA = """
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
    sla_met        INTEGER                           -- NULL until first resolution, then 0/1
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
"""


def get_db() -> sqlite3.Connection:
    """Open (or reuse) the request-scoped database connection."""
    if "db" not in g:
        g.db = sqlite3.connect(current_app.config["DATABASE"])
        g.db.row_factory = sqlite3.Row
    return g.db


def close_db(exception: BaseException | None = None) -> None:
    """Close the request-scoped connection, if one was opened."""
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db(db_path: str) -> None:
    """Create the schema at db_path. Safe to call repeatedly (IF NOT EXISTS)."""
    db = sqlite3.connect(db_path)
    try:
        db.executescript(SCHEMA)
        db.commit()
    finally:
        db.close()
