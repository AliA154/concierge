"""
Concierge — a lightweight IT service desk console.

Small Flask app that models how a real service desk prioritizes work:
ITIL ticket types, priority levels, SLA timers, and a VIP flag that pushes
executive requests to the top of the queue. Built to understand how tools
like ServiceNow handle high-priority incidents.
"""

import os
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from flask import Flask, g, jsonify, render_template, request

APP_DIR = Path(__file__).parent
DB_PATH = APP_DIR / "concierge.db"

# ITIL ticket categories and the states a ticket moves through.
TICKET_TYPES = ["Incident", "Request", "Problem", "Change"]
STATES = ["New", "In Progress", "On Hold", "Resolved"]
PRIORITIES = ["Low", "Medium", "High", "Critical"]

# SLA response targets in minutes, by priority. VIP tickets get a tighter
# clock (see sla_minutes below) because executive downtime costs the most.
SLA_TARGETS = {"Critical": 30, "High": 60, "Medium": 240, "Low": 480}

app = Flask(__name__)


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DB_PATH)
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS tickets (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            subject      TEXT NOT NULL,
            requester    TEXT NOT NULL,
            ticket_type  TEXT NOT NULL,
            priority     TEXT NOT NULL,
            state        TEXT NOT NULL DEFAULT 'New',
            is_vip       INTEGER NOT NULL DEFAULT 0,
            created_at   TEXT NOT NULL,
            resolved_at  TEXT
        );
        """
    )
    db.commit()
    db.close()


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def sla_minutes(priority, is_vip):
    """SLA target in minutes. VIP tickets are held to half the normal time."""
    target = SLA_TARGETS.get(priority, 480)
    return target // 2 if is_vip else target


def minutes_between(start_iso, end_iso):
    start = datetime.fromisoformat(start_iso)
    end = datetime.fromisoformat(end_iso)
    return (end - start).total_seconds() / 60.0


def serialize(row):
    """Turn a ticket row into a dict, adding live SLA status for open tickets."""
    is_vip = bool(row["is_vip"])
    target = sla_minutes(row["priority"], is_vip)
    resolved = row["resolved_at"]

    if resolved:
        elapsed = minutes_between(row["created_at"], resolved)
        breached = elapsed > target
        remaining = None
    else:
        elapsed = minutes_between(row["created_at"], now_iso())
        remaining = round(target - elapsed, 1)
        breached = remaining < 0

    return {
        "id": row["id"],
        "subject": row["subject"],
        "requester": row["requester"],
        "ticket_type": row["ticket_type"],
        "priority": row["priority"],
        "state": row["state"],
        "is_vip": is_vip,
        "created_at": row["created_at"],
        "resolved_at": resolved,
        "sla_target_min": target,
        "sla_remaining_min": remaining,
        "sla_breached": breached,
        "elapsed_min": round(elapsed, 1),
    }


# Sort key: VIP first, then by priority severity, then oldest first. This is
# the whole point of the app, so high-priority exec issues never sit and wait.
PRIORITY_RANK = {"Critical": 0, "High": 1, "Medium": 2, "Low": 3}


def queue_sort_key(ticket):
    return (
        0 if ticket["is_vip"] else 1,
        PRIORITY_RANK.get(ticket["priority"], 9),
        ticket["created_at"],
    )


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/tickets", methods=["GET"])
def list_tickets():
    rows = get_db().execute("SELECT * FROM tickets").fetchall()
    tickets = [serialize(r) for r in rows]

    open_tickets = [t for t in tickets if t["state"] != "Resolved"]
    open_tickets.sort(key=queue_sort_key)
    resolved = [t for t in tickets if t["state"] == "Resolved"]
    resolved.sort(key=lambda t: t["resolved_at"], reverse=True)

    return jsonify({
        "queue": open_tickets,
        "resolved": resolved,
        "metrics": build_metrics(tickets),
    })


def build_metrics(tickets):
    open_tickets = [t for t in tickets if t["state"] != "Resolved"]
    resolved = [t for t in tickets if t["state"] == "Resolved"]

    resolve_times = [t["elapsed_min"] for t in resolved]
    mttr = round(sum(resolve_times) / len(resolve_times), 1) if resolve_times else 0

    total_handled = len(tickets)
    breached = sum(1 for t in tickets if t["sla_breached"])
    sla_met_pct = (
        round(100 * (total_handled - breached) / total_handled) if total_handled else 100
    )

    return {
        "open": len(open_tickets),
        "vip_open": sum(1 for t in open_tickets if t["is_vip"]),
        "breaching": sum(1 for t in open_tickets if t["sla_breached"]),
        "resolved": len(resolved),
        "mttr_min": mttr,
        "sla_met_pct": sla_met_pct,
    }


@app.route("/api/tickets", methods=["POST"])
def create_ticket():
    data = request.get_json(force=True)
    subject = (data.get("subject") or "").strip()
    requester = (data.get("requester") or "").strip()
    if not subject or not requester:
        return jsonify({"error": "subject and requester are required"}), 400

    ticket_type = data.get("ticket_type") if data.get("ticket_type") in TICKET_TYPES else "Incident"
    priority = data.get("priority") if data.get("priority") in PRIORITIES else "Medium"
    is_vip = 1 if data.get("is_vip") else 0

    db = get_db()
    cur = db.execute(
        """INSERT INTO tickets (subject, requester, ticket_type, priority, state, is_vip, created_at)
           VALUES (?, ?, ?, ?, 'New', ?, ?)""",
        (subject, requester, ticket_type, priority, is_vip, now_iso()),
    )
    db.commit()
    row = db.execute("SELECT * FROM tickets WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify(serialize(row)), 201


@app.route("/api/tickets/<int:ticket_id>", methods=["PATCH"])
def update_ticket(ticket_id):
    data = request.get_json(force=True)
    db = get_db()
    row = db.execute("SELECT * FROM tickets WHERE id = ?", (ticket_id,)).fetchone()
    if row is None:
        return jsonify({"error": "not found"}), 404

    new_state = data.get("state")
    if new_state not in STATES:
        return jsonify({"error": "invalid state"}), 400

    # Stamp the resolution time the first time a ticket is marked Resolved.
    resolved_at = row["resolved_at"]
    if new_state == "Resolved" and resolved_at is None:
        resolved_at = now_iso()
    elif new_state != "Resolved":
        resolved_at = None

    db.execute(
        "UPDATE tickets SET state = ?, resolved_at = ? WHERE id = ?",
        (new_state, resolved_at, ticket_id),
    )
    db.commit()
    row = db.execute("SELECT * FROM tickets WHERE id = ?", (ticket_id,)).fetchone()
    return jsonify(serialize(row))


@app.route("/api/meta")
def meta():
    return jsonify({
        "types": TICKET_TYPES,
        "states": STATES,
        "priorities": PRIORITIES,
    })


# Sample tickets used to populate a fresh database so the demo looks alive.
# (subject, requester, type, priority, vip, minutes_ago, resolved_after_min)
SAMPLE = [
    ("CEO cannot join board Zoom call", "M. Reyes (CEO)", "Incident", "Critical", 1, 12, None),
    ("VPN drops every few minutes", "T. Okafor (CFO)", "Incident", "High", 1, 40, None),
    ("New hire laptop setup for Monday", "HR Onboarding", "Request", "Medium", 0, 90, None),
    ("Conference room 14B display no signal", "Facilities", "Incident", "High", 0, 55, None),
    ("Printer on 12th floor jamming", "K. Silva", "Incident", "Low", 0, 200, None),
    ("Repeated Outlook crashes across sales team", "IT Monitoring", "Problem", "High", 0, 150, None),
    ("Approve O365 license bump for design team", "Change Board", "Change", "Medium", 0, 300, None),
    ("Password reset", "J. Park", "Request", "Low", 0, 30, 8),
    ("Executive iPhone will not sync mail", "L. Chen (COO)", "Incident", "High", 1, 240, 22),
    ("Meeting room mic not working", "R. Adler", "Incident", "Medium", 0, 500, 65),
]


def seed_db(force=False):
    """Load sample tickets. By default only seeds when the table is empty,
    so a live deploy comes up populated without wiping real activity on restart."""
    init_db()
    db = sqlite3.connect(DB_PATH)
    if not force:
        count = db.execute("SELECT COUNT(*) FROM tickets").fetchone()[0]
        if count > 0:
            db.close()
            return
    db.execute("DELETE FROM tickets")
    base = datetime.now(timezone.utc)
    for subj, req, ttype, pri, vip, ago, resolved_after in SAMPLE:
        created = base - timedelta(minutes=ago)
        state = "Resolved" if resolved_after is not None else "New"
        resolved_at = (
            (created + timedelta(minutes=resolved_after)).isoformat()
            if resolved_after is not None
            else None
        )
        db.execute(
            """INSERT INTO tickets (subject, requester, ticket_type, priority, state, is_vip, created_at, resolved_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (subj, req, ttype, pri, state, vip, created.isoformat(), resolved_at),
        )
    db.commit()
    db.close()


# Initialize (and seed if empty) at import time so it works under gunicorn too.
seed_db()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    app.run(debug=True, host="0.0.0.0", port=port)
