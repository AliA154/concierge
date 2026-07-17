"""Curated deterministic demo seed — no random anywhere.

Every timestamp is relative to "now", so a fresh deploy always shows the exact
same tableau: eight open tickets that are each a scripted demo beat (one VIP
Critical that breaches live ~3 minutes after page load, one already-breached
VIP, one paused on hold, one at-risk, one reopened...) plus a two-week-feeling
backfill of 14 resolved/closed tickets tuned so SLA attainment lands near 86%
— a perfect 100% looks fake.

Guarded by tests/test_seed.py so the beats survive future edits.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any

from .db import init_db
from .sla import derive_priority, sla_minutes

DAY = 1440  # minutes

# Open queue: exactly 8 tickets. `events` are (minutes_after_created, actor,
# event_type, detail); the `created` event is generated automatically at t=0.
OPEN_TICKETS: list[dict[str, Any]] = [
    {
        # Beat 1: VIP Critical, 15m target, created 12m ago — breaches live,
        # about three minutes after the page is opened.
        "subject": "CEO cannot join board video call",
        "requester": "M. Reyes (CEO)",
        "ticket_type": "Incident",
        "impact": "High",
        "urgency": "High",
        "is_vip": 1,
        "created_ago": 12,
        "state": "New",
        "assigned_to": None,
        "events": [],
    },
    {
        # Beat 2: VIP already breached (45m elapsed vs 30m VIP target) — feeds
        # the VIP banner and the Breaching tile.
        "subject": "VPN drops every few minutes",
        "requester": "T. Okafor (CFO)",
        "ticket_type": "Incident",
        "impact": "High",
        "urgency": "Medium",
        "is_vip": 1,
        "created_ago": 45,
        "state": "In Progress",
        "assigned_to": "Ali Ahmad",
        "events": [
            (2, "Ali Ahmad", "assigned", "Assigned to Ali Ahmad"),
            (2, "Ali Ahmad", "state_change", "New → In Progress"),
            (
                10,
                "Ali Ahmad",
                "work_note",
                "Replicated on guest wifi — suspect cert expiry on VPN gateway, "
                "renewing. ETA 30m.",
            ),
        ],
    },
    {
        # Beat 3: paused On Hold 20m ago — chip reads ~30m used of 60m.
        "subject": "Conference room 14B display no signal",
        "requester": "Facilities",
        "ticket_type": "Incident",
        "impact": "Medium",
        "urgency": "High",
        "is_vip": 0,
        "created_ago": 50,
        "state": "On Hold",
        "assigned_to": "Priya Sharma",
        "on_hold_offset": 30,
        "events": [
            (3, "Priya Sharma", "assigned", "Assigned to Priya Sharma"),
            (3, "Priya Sharma", "state_change", "New → In Progress"),
            (
                29,
                "Priya Sharma",
                "work_note",
                "Called requester, no answer, left VM — placing On Hold.",
            ),
            (30, "Priya Sharma", "state_change", "In Progress → On Hold"),
        ],
    },
    {
        # Beat 4: at_risk — ~83% of a 60m target consumed, amber pulse.
        "subject": "Repeated Outlook crashes across sales team",
        "requester": "IT Monitoring",
        "ticket_type": "Problem",
        "impact": "High",
        "urgency": "Medium",
        "is_vip": 0,
        "created_ago": 50,
        "state": "In Progress",
        "assigned_to": "Marcus Tate",
        "events": [
            (4, "Marcus Tate", "assigned", "Assigned to Marcus Tate"),
            (4, "Marcus Tate", "state_change", "New → In Progress"),
        ],
    },
    {
        # Beat 5: comfortable green Request, unassigned.
        "subject": "New hire laptop setup for Monday",
        "requester": "HR Onboarding",
        "ticket_type": "Request",
        "impact": "Medium",
        "urgency": "Medium",
        "is_vip": 0,
        "created_ago": 90,
        "state": "New",
        "assigned_to": None,
        "events": [],
    },
    {
        # Beat 6: low-key Change at the bottom of the queue.
        "subject": "Approve O365 license bump for design team",
        "requester": "Change Board",
        "ticket_type": "Change",
        "impact": "Medium",
        "urgency": "Low",
        "is_vip": 0,
        "created_ago": 3 * 60,
        "state": "New",
        "assigned_to": None,
        "events": [],
    },
    {
        # Beat 7: assigned, green, plenty of runway.
        "subject": "Printer on 12th floor jamming",
        "requester": "K. Silva",
        "ticket_type": "Incident",
        "impact": "Low",
        "urgency": "Medium",
        "is_vip": 0,
        "created_ago": 2 * 60,
        "state": "In Progress",
        "assigned_to": "Dana Whitfield",
        "events": [
            (6, "Dana Whitfield", "assigned", "Assigned to Dana Whitfield"),
            (6, "Dana Whitfield", "state_change", "New → In Progress"),
        ],
    },
    {
        # Beat 8: reopened ticket — amber "Reopened ×1" tag, sla_met frozen at 1
        # from the first resolution 24h ago even though the live clock is long
        # past target now.
        "subject": "Meeting room mic cuts out — again",
        "requester": "R. Adler",
        "ticket_type": "Incident",
        "impact": "Medium",
        "urgency": "Medium",
        "is_vip": 0,
        "created_ago": 26 * 60,
        "state": "In Progress",
        "assigned_to": "Dana Whitfield",
        "reopened_count": 1,
        "sla_met": 1,
        "events": [
            (15, "Dana Whitfield", "state_change", "New → In Progress"),
            (
                60,
                "Dana Whitfield",
                "work_note",
                "Swapped the mic battery pack and re-paired the receiver — audio "
                "stable through a 10-minute test call.",
            ),
            (120, "Dana Whitfield", "state_change", "In Progress → Resolved"),
            (24 * 60, "System", "reopened", "Reopened — resolution did not hold (reopen #1)"),
            (24 * 60, "Dana Whitfield", "state_change", "Resolved → In Progress"),
        ],
    },
]

# Resolved/Closed backfill: exactly 14 tickets hand-spread over the prior week
# (weekday-weighted, not random). Resolve times are tuned so 12 meet SLA and 2
# miss it; 5 are Closed ~4h after resolution; 4 carry a work note in desk voice.
# (subject, requester, type, impact, urgency, vip, agent,
#  created_ago_min, resolve_after_min, closed, note text or None)
DONE_TICKETS: list[tuple[str, str, str, str, str, int, str, int, int, bool, str | None]] = [
    ("Password reset for returning contractor", "J. Park", "Request", "Low", "Medium",
     0, "Priya Sharma", 7 * DAY + 230, 12, True, None),
    ("Executive iPhone will not sync mail", "L. Chen (COO)", "Incident", "Medium", "High",
     1, "Ali Ahmad", 7 * DAY + 140, 22, True, None),
    ("Shared drive permissions for finance", "A. Novak", "Request", "Medium", "Medium",
     0, "Marcus Tate", 6 * DAY + 310, 95, False,
     "Mapped the finance share to the new AD group — asked requester to log off/on "
     "to pick up the token."),
    ("Monitor flickering at hot desk 22", "S. Iqbal", "Incident", "Low", "Low",
     0, "Dana Whitfield", 6 * DAY + 95, 130, True, None),
    ("Deploy security patch to kiosk machines", "IT Security", "Change", "Medium", "Medium",
     0, "Marcus Tate", 5 * DAY + 400, 310, False,  # 310 > 240 — missed
     "Kiosk 3 failed the patch preflight — cleared disk space and re-queued the rollout."),
    ("Badge reader offline at loading dock", "Facilities", "Incident", "Medium", "High",
     0, "Priya Sharma", 5 * DAY + 120, 41, False, None),
    ("CRM export failing for quarterly report", "B. Osei", "Incident", "High", "Medium",
     0, "Ali Ahmad", 4 * DAY + 260, 52, False,
     "Export dies on a null account owner. Patched the row in staging and re-ran — "
     "checking with CRM admin for root cause."),
    ("Provision test VM for QA", "QA Team", "Request", "Low", "Medium",
     0, "Dana Whitfield", 4 * DAY + 180, 240, True, None),
    ("Boardroom Polycom firmware update", "Exec Admin", "Change", "Medium", "Low",
     1, "Ali Ahmad", 3 * DAY + 330, 180, False, None),
    ("Wifi dead zone on 9th floor", "Workplace Ops", "Problem", "Medium", "Medium",
     0, "Priya Sharma", 3 * DAY + 150, 330, False,  # 330 > 240 — missed
     "Heatmap shows AP-9F-04 down. Facilities needs to unlock the ceiling panel "
     "before we can reseat it."),
    ("Laptop battery swelling", "D. Romero", "Incident", "Medium", "High",
     0, "Marcus Tate", 2 * DAY + 300, 38, True, None),
    ("Antivirus false positive on build agent", "DevOps", "Incident", "Medium", "Medium",
     0, "Dana Whitfield", 2 * DAY + 120, 66, False, None),
    ("Guest wifi access for partner onsite", "Reception", "Request", "Low", "High",
     0, "Priya Sharma", 1 * DAY + 200, 25, False, None),
    ("Email distribution list cleanup", "M. Haddad", "Request", "Low", "Low",
     0, "Marcus Tate", 1 * DAY + 90, 200, False, None),
]


def _iso(moment: datetime) -> str:
    return moment.isoformat()


def _insert_ticket(db: sqlite3.Connection, fields: dict[str, Any]) -> int:
    cur = db.execute(
        """INSERT INTO tickets (subject, requester, ticket_type, impact, urgency, priority,
                                state, is_vip, assigned_to, created_at, resolved_at, closed_at,
                                on_hold_since, held_minutes, reopened_count, sla_met)
           VALUES (:subject, :requester, :ticket_type, :impact, :urgency, :priority,
                   :state, :is_vip, :assigned_to, :created_at, :resolved_at, :closed_at,
                   :on_hold_since, :held_minutes, :reopened_count, :sla_met)""",
        fields,
    )
    return cur.lastrowid


def _insert_event(
    db: sqlite3.Connection, ticket_id: int, actor: str, event_type: str, detail: str, at: str
) -> None:
    db.execute(
        """INSERT INTO ticket_events (ticket_id, actor, event_type, detail, created_at)
           VALUES (?, ?, ?, ?, ?)""",
        (ticket_id, actor, event_type, detail, at),
    )


def _created_detail(priority: str, ticket_type: str, is_vip: int) -> str:
    return f"Ticket created — {priority} {ticket_type}" + (" (VIP)" if is_vip else "")


def seed_db(db_path: str, force: bool = False) -> None:
    """Load the demo tableau. Without force, seeding a non-empty DB is a no-op,
    so a live deploy comes up populated without wiping activity on restart."""
    init_db(db_path)
    db = sqlite3.connect(db_path)
    try:
        if not force:
            count = db.execute("SELECT COUNT(*) FROM tickets").fetchone()[0]
            if count:
                return
        db.execute("DELETE FROM ticket_events")
        db.execute("DELETE FROM tickets")
        # Reset AUTOINCREMENT so ticket numbers are deterministic after a reset.
        db.execute("DELETE FROM sqlite_sequence WHERE name IN ('tickets', 'ticket_events')")

        now = datetime.now(timezone.utc)

        for beat in OPEN_TICKETS:
            created = now - timedelta(minutes=beat["created_ago"])
            priority = derive_priority(beat["impact"], beat["urgency"])
            on_hold_offset = beat.get("on_hold_offset")
            ticket_id = _insert_ticket(
                db,
                {
                    "subject": beat["subject"],
                    "requester": beat["requester"],
                    "ticket_type": beat["ticket_type"],
                    "impact": beat["impact"],
                    "urgency": beat["urgency"],
                    "priority": priority,
                    "state": beat["state"],
                    "is_vip": beat["is_vip"],
                    "assigned_to": beat["assigned_to"],
                    "created_at": _iso(created),
                    "resolved_at": None,
                    "closed_at": None,
                    "on_hold_since": (
                        _iso(created + timedelta(minutes=on_hold_offset))
                        if on_hold_offset is not None
                        else None
                    ),
                    "held_minutes": beat.get("held_minutes", 0),
                    "reopened_count": beat.get("reopened_count", 0),
                    "sla_met": beat.get("sla_met"),
                },
            )
            detail = _created_detail(priority, beat["ticket_type"], beat["is_vip"])
            _insert_event(db, ticket_id, "System", "created", detail, _iso(created))
            for offset, actor, event_type, event_detail in beat["events"]:
                at = _iso(created + timedelta(minutes=offset))
                _insert_event(db, ticket_id, actor, event_type, event_detail, at)

        for (subject, requester, ticket_type, impact, urgency, is_vip, agent,
             created_ago, resolve_after, closed, note) in DONE_TICKETS:
            created = now - timedelta(minutes=created_ago)
            resolved = created + timedelta(minutes=resolve_after)
            closed_at = resolved + timedelta(hours=4) if closed else None
            priority = derive_priority(impact, urgency)
            target = sla_minutes(priority, bool(is_vip))
            ticket_id = _insert_ticket(
                db,
                {
                    "subject": subject,
                    "requester": requester,
                    "ticket_type": ticket_type,
                    "impact": impact,
                    "urgency": urgency,
                    "priority": priority,
                    "state": "Closed" if closed else "Resolved",
                    "is_vip": is_vip,
                    "assigned_to": agent,
                    "created_at": _iso(created),
                    "resolved_at": _iso(resolved),
                    "closed_at": _iso(closed_at) if closed_at else None,
                    "on_hold_since": None,
                    "held_minutes": 0,
                    "reopened_count": 0,
                    "sla_met": 1 if resolve_after <= target else 0,
                },
            )
            # Plausible chain: created → assigned/started → (note) → resolved,
            # every timestamp inside the created..resolved window.
            start_offset = max(1, resolve_after // 6)
            detail = _created_detail(priority, ticket_type, is_vip)
            _insert_event(db, ticket_id, "System", "created", detail, _iso(created))
            started = _iso(created + timedelta(minutes=start_offset))
            _insert_event(db, ticket_id, agent, "assigned", f"Assigned to {agent}", started)
            _insert_event(db, ticket_id, agent, "state_change", "New → In Progress", started)
            if note:
                note_at = _iso(created + timedelta(minutes=resolve_after // 2))
                _insert_event(db, ticket_id, agent, "work_note", note, note_at)
            _insert_event(
                db, ticket_id, agent, "state_change", "In Progress → Resolved", _iso(resolved)
            )

        db.commit()
    finally:
        db.close()
