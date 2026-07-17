"""Domain logic for Concierge: priority derivation, SLA math, serialization, metrics.

Everything in this module is pure — no Flask, no I/O. Rows come in as mappings
(sqlite3.Row or dict), timestamps come in as ISO-8601 strings, and results come
out as plain dicts. That keeps the tricky math trivially unit-testable with
frozen timestamp strings.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timezone
from typing import Any

TICKET_TYPES = ["Incident", "Request", "Problem", "Change"]
STATES = ["New", "In Progress", "On Hold", "Resolved", "Closed"]
PRIORITIES = ["Critical", "High", "Medium", "Low"]
IMPACTS = ["High", "Medium", "Low"]  # how many people affected
URGENCIES = ["High", "Medium", "Low"]  # how time-sensitive

# Impact × Urgency → priority. Priority is always derived from these two,
# never picked directly — the classic ITIL triage matrix.
PRIORITY_MATRIX = {
    "High|High": "Critical",
    "High|Medium": "High",
    "High|Low": "Medium",
    "Medium|High": "High",
    "Medium|Medium": "Medium",
    "Medium|Low": "Low",
    "Low|High": "Medium",
    "Low|Medium": "Low",
    "Low|Low": "Low",
}

# Resolution SLA targets in minutes. VIP tickets run on half the clock:
# VIP is an urgency multiplier applied to the clock, not the triage.
SLA_TARGETS = {"Critical": 30, "High": 60, "Medium": 240, "Low": 480}

# Legal state transitions. Resolved → In Progress happens only through the
# dedicated /reopen endpoint, so it is deliberately absent from this map.
TRANSITIONS = {
    "New": ["In Progress", "On Hold", "Resolved"],
    "In Progress": ["On Hold", "Resolved"],
    "On Hold": ["In Progress", "Resolved"],
    "Resolved": ["Closed"],
    "Closed": [],
}

# ServiceNow-style number prefixes, keyed by ticket type (immutable after create).
NUMBER_PREFIX = {"Incident": "INC", "Request": "REQ", "Problem": "PRB", "Change": "CHG"}

PRIORITY_RANK = {"Critical": 0, "High": 1, "Medium": 2, "Low": 3}

AGENTS = [
    {"name": "Ali Ahmad", "initials": "AA", "color": "#4c8bf5"},
    {"name": "Priya Sharma", "initials": "PS", "color": "#a78bfa"},
    {"name": "Marcus Tate", "initials": "MT", "color": "#34d399"},
    {"name": "Dana Whitfield", "initials": "DW", "color": "#f5a623"},
]
AGENT_NAMES = [agent["name"] for agent in AGENTS]

OPEN_STATES = ("New", "In Progress", "On Hold")
DONE_STATES = ("Resolved", "Closed")


def now_iso() -> str:
    """Current UTC time as an ISO-8601 string with offset."""
    return datetime.now(timezone.utc).isoformat()


def minutes_between(start_iso: str, end_iso: str) -> float:
    """Minutes elapsed between two ISO-8601 timestamps."""
    start = datetime.fromisoformat(start_iso)
    end = datetime.fromisoformat(end_iso)
    return (end - start).total_seconds() / 60.0


def derive_priority(impact: str, urgency: str) -> str:
    """Priority from the Impact × Urgency matrix. Inputs must be valid enum values."""
    return PRIORITY_MATRIX[f"{impact}|{urgency}"]


def sla_minutes(priority: str, is_vip: bool) -> int:
    """SLA target in minutes. VIP tickets are held to half the normal time."""
    target = SLA_TARGETS.get(priority, 480)
    return target // 2 if is_vip else target


def effective_elapsed(
    created_at: str,
    now: str,
    held_minutes: float = 0.0,
    on_hold_since: str | None = None,
    resolved_at: str | None = None,
) -> float:
    """Hold-adjusted elapsed minutes — the only elapsed that matters, everywhere.

    Wall-clock time since creation (up to resolution, if resolved), minus all
    completed hold time, minus the in-progress hold stretch if the ticket is
    currently On Hold. The SLA clock simply does not run while a ticket waits
    on someone else.
    """
    end = resolved_at or now
    elapsed = minutes_between(created_at, end) - held_minutes
    if on_hold_since:
        elapsed -= minutes_between(on_hold_since, now)
    return elapsed


def sla_status(state: str, elapsed: float, target: float, sla_met: int | None) -> str:
    """SLA status tier, computed at serialize time and never stored.

    Open tickets, in priority order: breached is sticky (a ticket that blew its
    SLA stays red even while On Hold), then paused, then at_risk at >= 75% of
    target consumed, then ok. Resolved/Closed tickets report the frozen outcome.
    """
    if state in DONE_STATES:
        return "met" if sla_met else "missed"
    if elapsed > target:
        return "breached"
    if state == "On Hold":
        return "paused"
    if elapsed >= 0.75 * target:
        return "at_risk"
    return "ok"


def serialize(row: Mapping[str, Any], now: str) -> dict[str, Any]:
    """Turn a ticket row into the API ticket object, adding computed SLA fields."""
    is_vip = bool(row["is_vip"])
    target = sla_minutes(row["priority"], is_vip)
    done = row["state"] in DONE_STATES
    elapsed = effective_elapsed(
        row["created_at"],
        now,
        held_minutes=row["held_minutes"],
        on_hold_since=row["on_hold_since"],
        resolved_at=row["resolved_at"],
    )
    return {
        "id": row["id"],
        "number": f"{NUMBER_PREFIX[row['ticket_type']]}{row['id']:07d}",
        "subject": row["subject"],
        "requester": row["requester"],
        "ticket_type": row["ticket_type"],
        "impact": row["impact"],
        "urgency": row["urgency"],
        "priority": row["priority"],
        "state": row["state"],
        "is_vip": is_vip,
        "assigned_to": row["assigned_to"],
        "created_at": row["created_at"],
        "resolved_at": row["resolved_at"],
        "closed_at": row["closed_at"],
        "on_hold_since": row["on_hold_since"],
        "held_minutes": round(float(row["held_minutes"]), 1),
        "reopened_count": row["reopened_count"],
        "sla_target_min": target,
        "sla_elapsed_min": round(elapsed, 1),
        "sla_remaining_min": None if done else round(target - elapsed, 1),
        "sla_consumed_pct": round(100 * elapsed / target),
        "sla_status": sla_status(row["state"], elapsed, target, row["sla_met"]),
        "sla_met": None if row["sla_met"] is None else bool(row["sla_met"]),
    }


def queue_sort_key(ticket: Mapping[str, Any]) -> tuple[int, int, str]:
    """Queue order — the app's identity: VIP first, then severity, then oldest first.

    On Hold tickets do not sink; a held VIP Critical stays at the top with a
    paused chip, because out-of-sight is how held VIP tickets get forgotten.
    """
    return (
        0 if ticket["is_vip"] else 1,
        PRIORITY_RANK.get(ticket["priority"], 9),
        ticket["created_at"],
    )


def build_metrics(tickets: list[dict[str, Any]]) -> dict[str, Any]:
    """Desk metrics over serialized tickets.

    SLA attainment (`sla_met_pct`) is measured over completed work only — the
    frozen sla_met flags — while live pain shows up separately in `breaching`.
    Mixing the two would let an open breach drag down a historical rate.
    """
    open_tickets = [t for t in tickets if t["state"] in OPEN_STATES]
    done = [t for t in tickets if t["state"] in DONE_STATES]

    met = sum(1 for t in tickets if t["sla_met"] is True)
    missed = sum(1 for t in tickets if t["sla_met"] is False)
    sla_met_pct = round(100 * met / (met + missed)) if (met + missed) else 100

    resolve_times = [t["sla_elapsed_min"] for t in done]
    mttr = round(sum(resolve_times) / len(resolve_times), 1) if resolve_times else 0

    return {
        "open": len(open_tickets),
        "vip_open": sum(1 for t in open_tickets if t["is_vip"]),
        "unassigned": sum(1 for t in open_tickets if t["assigned_to"] is None),
        "at_risk": sum(1 for t in open_tickets if t["sla_status"] == "at_risk"),
        "breaching": sum(1 for t in open_tickets if t["sla_status"] == "breached"),
        "resolved": len(done),
        "mttr_min": mttr,
        "sla_met_pct": sla_met_pct,
        "reopened": sum(1 for t in tickets if t["reopened_count"] > 0),
    }
