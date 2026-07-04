"""Seed the database with sample tickets so the dashboard looks alive on first run."""

import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app import DB_PATH, init_db

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


def now():
    return datetime.now(timezone.utc)


def seed():
    init_db()
    db = sqlite3.connect(DB_PATH)
    db.execute("DELETE FROM tickets")
    for subj, req, ttype, pri, vip, ago, resolved_after in SAMPLE:
        created = now() - timedelta(minutes=ago)
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
    print(f"Seeded {len(SAMPLE)} tickets.")


if __name__ == "__main__":
    seed()
