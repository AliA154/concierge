"""All HTTP endpoints, on a single blueprint. Contract: UPGRADE_SPEC.md §4."""

from __future__ import annotations

import sqlite3
import time
from typing import Any

from flask import Blueprint, Response, current_app, jsonify, render_template, request, url_for

from .db import get_db
from .seed import seed_db
from .sla import (
    AGENT_NAMES,
    AGENTS,
    DONE_STATES,
    IMPACTS,
    OPEN_STATES,
    PRIORITIES,
    PRIORITY_MATRIX,
    SLA_TARGETS,
    STATES,
    TICKET_TYPES,
    TRANSITIONS,
    URGENCIES,
    build_metrics,
    derive_priority,
    effective_elapsed,
    minutes_between,
    now_iso,
    queue_sort_key,
    serialize,
    sla_minutes,
)

bp = Blueprint("concierge", __name__)

# Minimum seconds between demo resets — enough to stop a double-click (or a
# curl loop) from hammering the reseed while costing a real visitor nothing.
RESET_COOLDOWN_SECONDS = 10


def error(code: int, message: str) -> tuple[Response, int]:
    """The one JSON error envelope every failure uses, Flask-level errors included."""
    return jsonify({"error": {"code": code, "message": message}}), code


def actor_from_header() -> str:
    """Resolve the acting agent from the X-Agent header.

    The header is cosmetic by design — there is no auth in this demo, so an
    unknown or missing value silently attributes the action to "System" rather
    than rejecting the request.
    """
    name = request.headers.get("X-Agent", "")
    return name if name in AGENT_NAMES else "System"


def fetch_ticket(db: sqlite3.Connection, ticket_id: int) -> sqlite3.Row | None:
    return db.execute("SELECT * FROM tickets WHERE id = ?", (ticket_id,)).fetchone()


def add_event(
    db: sqlite3.Connection,
    ticket_id: int,
    actor: str,
    event_type: str,
    detail: str,
    created_at: str,
) -> int:
    cur = db.execute(
        """INSERT INTO ticket_events (ticket_id, actor, event_type, detail, created_at)
           VALUES (?, ?, ?, ?, ?)""",
        (ticket_id, actor, event_type, detail, created_at),
    )
    return cur.lastrowid


def serialize_event(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "actor": row["actor"],
        "event_type": row["event_type"],
        "detail": row["detail"],
        "created_at": row["created_at"],
    }


def clean_text(value: Any, field: str, max_len: int) -> tuple[str | None, str | None]:
    """Validate a required text field: string, trimmed, 1..max_len chars."""
    if not isinstance(value, str) or not value.strip():
        return None, f"{field} is required (1–{max_len} characters)"
    value = value.strip()
    if len(value) > max_len:
        return None, f"{field} must be at most {max_len} characters"
    return value, None


@bp.get("/")
def index() -> str:
    return render_template("index.html")


@bp.get("/api/meta")
def meta() -> Response:
    return jsonify(
        {
            "types": TICKET_TYPES,
            "states": STATES,
            "priorities": PRIORITIES,
            "impacts": IMPACTS,
            "urgencies": URGENCIES,
            "priority_matrix": PRIORITY_MATRIX,
            "sla_targets": SLA_TARGETS,
            "transitions": TRANSITIONS,
            "agents": AGENTS,
        }
    )


@bp.get("/api/tickets")
def list_tickets() -> Response:
    now = now_iso()
    rows = get_db().execute("SELECT * FROM tickets").fetchall()
    tickets = [serialize(row, now) for row in rows]

    queue = sorted((t for t in tickets if t["state"] in OPEN_STATES), key=queue_sort_key)
    # Closed tickets sort by resolved_at too — closing is bookkeeping, not work.
    done = sorted(
        (t for t in tickets if t["state"] in DONE_STATES),
        key=lambda t: t["resolved_at"],
        reverse=True,
    )
    return jsonify(
        {"now": now, "queue": queue, "resolved": done, "metrics": build_metrics(tickets)}
    )


@bp.get("/api/tickets/<int:ticket_id>")
def get_ticket(ticket_id: int) -> Response | tuple[Response, int]:
    db = get_db()
    row = fetch_ticket(db, ticket_id)
    if row is None:
        return error(404, f"ticket {ticket_id} not found")
    events = db.execute(
        "SELECT * FROM ticket_events WHERE ticket_id = ? ORDER BY created_at DESC, id DESC",
        (ticket_id,),
    ).fetchall()
    now = now_iso()
    return jsonify(
        {"now": now, "ticket": serialize(row, now), "events": [serialize_event(e) for e in events]}
    )


@bp.post("/api/tickets")
def create_ticket() -> tuple[Response, int, dict[str, str]] | tuple[Response, int]:
    data = request.get_json(silent=True)
    if data is None:
        return error(400, "request body must be JSON")

    subject, err = clean_text(data.get("subject"), "subject", 200)
    if err:
        return error(400, err)
    requester, err = clean_text(data.get("requester"), "requester", 200)
    if err:
        return error(400, err)

    # Optional enums default sensibly but are never silently coerced when present.
    ticket_type = data.get("ticket_type", "Incident")
    if ticket_type not in TICKET_TYPES:
        return error(400, f"ticket_type must be one of: {', '.join(TICKET_TYPES)}")
    impact = data.get("impact", "Medium")
    if impact not in IMPACTS:
        return error(400, f"impact must be one of: {', '.join(IMPACTS)}")
    urgency = data.get("urgency", "Medium")
    if urgency not in URGENCIES:
        return error(400, f"urgency must be one of: {', '.join(URGENCIES)}")

    # Priority is derived from impact x urgency; a client-sent priority is ignored.
    priority = derive_priority(impact, urgency)
    is_vip = 1 if data.get("is_vip") else 0
    now = now_iso()

    db = get_db()
    cur = db.execute(
        """INSERT INTO tickets (subject, requester, ticket_type, impact, urgency,
                                priority, state, is_vip, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'New', ?, ?)""",
        (subject, requester, ticket_type, impact, urgency, priority, is_vip, now),
    )
    ticket_id = cur.lastrowid
    detail = f"Ticket created — {priority} {ticket_type}" + (" (VIP)" if is_vip else "")
    add_event(db, ticket_id, actor_from_header(), "created", detail, now)
    db.commit()

    row = fetch_ticket(db, ticket_id)
    location = url_for("concierge.get_ticket", ticket_id=ticket_id)
    return jsonify(serialize(row, now)), 201, {"Location": location}


@bp.patch("/api/tickets/<int:ticket_id>")
def update_ticket(ticket_id: int) -> Response | tuple[Response, int]:
    db = get_db()
    row = fetch_ticket(db, ticket_id)
    if row is None:
        return error(404, f"ticket {ticket_id} not found")

    data = request.get_json(silent=True)
    if data is None:
        return error(400, "request body must be JSON")
    if "state" not in data and "assigned_to" not in data:
        return error(400, "nothing to update")

    now = now_iso()
    actor = actor_from_header()
    fields: dict[str, Any] = dict(row)
    events: list[tuple[str, str]] = []

    if "assigned_to" in data:
        assignee = data["assigned_to"]
        if assignee is not None and assignee not in AGENT_NAMES:
            return error(
                400, f"assigned_to must be one of: {', '.join(AGENT_NAMES)} — or null"
            )
        fields["assigned_to"] = assignee
        events.append(("assigned", f"Assigned to {assignee}" if assignee else "Unassigned"))

    if "state" in data:
        new_state = data["state"]
        old_state = row["state"]
        if new_state not in STATES:
            return error(400, f"state must be one of: {', '.join(STATES)}")
        if new_state not in TRANSITIONS[old_state]:
            message = f"cannot move {old_state} → {new_state}"
            if old_state == "Closed":
                message += " (Closed is terminal; use /reopen from Resolved)"
            elif old_state == "Resolved" and new_state == "In Progress":
                message += " (use POST /api/tickets/<id>/reopen)"
            return error(400, message)

        # Hold accounting: leaving On Hold accrues the completed stretch into
        # held_minutes. Resolving while on hold accrues first, then resolves.
        if old_state == "On Hold":
            fields["held_minutes"] = row["held_minutes"] + minutes_between(
                row["on_hold_since"], now
            )
            fields["on_hold_since"] = None
        if new_state == "On Hold":
            fields["on_hold_since"] = now
        elif new_state == "Resolved":
            fields["resolved_at"] = now
            if row["sla_met"] is None:
                # Freeze the SLA outcome at FIRST resolution, forever. Reopening
                # cannot retroactively un-breach an SLA (or breach a met one);
                # the ticket's metrics contribution stays this first verdict.
                elapsed = effective_elapsed(
                    row["created_at"], now, held_minutes=fields["held_minutes"]
                )
                target = sla_minutes(row["priority"], bool(row["is_vip"]))
                fields["sla_met"] = 1 if elapsed <= target else 0
        elif new_state == "Closed":
            fields["closed_at"] = now
        fields["state"] = new_state
        events.append(("state_change", f"{old_state} → {new_state}"))

        # Auto-assign: taking an unassigned ticket into In Progress with a valid
        # X-Agent assigns it to that agent — that is how real desks behave.
        if new_state == "In Progress" and fields["assigned_to"] is None and actor != "System":
            fields["assigned_to"] = actor
            events.append(("assigned", f"Assigned to {actor}"))

    db.execute(
        """UPDATE tickets SET state = ?, assigned_to = ?, resolved_at = ?, closed_at = ?,
                              on_hold_since = ?, held_minutes = ?, sla_met = ?
           WHERE id = ?""",
        (
            fields["state"],
            fields["assigned_to"],
            fields["resolved_at"],
            fields["closed_at"],
            fields["on_hold_since"],
            fields["held_minutes"],
            fields["sla_met"],
            ticket_id,
        ),
    )
    for event_type, detail in events:
        add_event(db, ticket_id, actor, event_type, detail, now)
    db.commit()

    return jsonify(serialize(fetch_ticket(db, ticket_id), now))


@bp.post("/api/tickets/<int:ticket_id>/notes")
def add_note(ticket_id: int) -> tuple[Response, int]:
    db = get_db()
    row = fetch_ticket(db, ticket_id)
    if row is None:
        return error(404, f"ticket {ticket_id} not found")
    if row["state"] == "Closed":
        return error(400, "cannot add a work note to a Closed ticket")

    data = request.get_json(silent=True)
    if data is None:
        return error(400, "request body must be JSON")
    note, err = clean_text(data.get("note"), "note", 1000)
    if err:
        return error(400, err)

    now = now_iso()
    event_id = add_event(db, ticket_id, actor_from_header(), "work_note", note, now)
    db.commit()
    event = db.execute("SELECT * FROM ticket_events WHERE id = ?", (event_id,)).fetchone()
    return jsonify(serialize_event(event)), 201


@bp.post("/api/tickets/<int:ticket_id>/reopen")
def reopen_ticket(ticket_id: int) -> Response | tuple[Response, int]:
    db = get_db()
    row = fetch_ticket(db, ticket_id)
    if row is None:
        return error(404, f"ticket {ticket_id} not found")
    if row["state"] != "Resolved":
        return error(400, f"can only reopen a Resolved ticket (state is {row['state']})")

    now = now_iso()
    count = row["reopened_count"] + 1
    # resolved_at clears so the live clock resumes; sla_met stays frozen (§2.6).
    db.execute(
        "UPDATE tickets SET state = 'In Progress', resolved_at = NULL, reopened_count = ? "
        "WHERE id = ?",
        (count, ticket_id),
    )
    add_event(
        db,
        ticket_id,
        actor_from_header(),
        "reopened",
        f"Reopened — resolution did not hold (reopen #{count})",
        now,
    )
    db.commit()
    return jsonify(serialize(fetch_ticket(db, ticket_id), now))


@bp.post("/api/demo/reset")
def demo_reset() -> Response | tuple[Response, int]:
    # Unauthenticated by design: this is a single-user demo on an ephemeral DB,
    # so the worst a stranger can do is put the sample data back.
    last = current_app.config.get("LAST_DEMO_RESET")
    now_mono = time.monotonic()
    if last is not None and now_mono - last < RESET_COOLDOWN_SECONDS:
        return error(429, "demo was just reset — try again in a few seconds")
    current_app.config["LAST_DEMO_RESET"] = now_mono

    seed_db(current_app.config["DATABASE"], force=True)
    return jsonify({"ok": True, "message": "Demo data reset"})
