"""Shared fixtures: a TESTING app on a throwaway DB, and helpers for building
tickets with explicit frozen timestamps — no sleeping, no mocking frameworks."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone

import pytest

from concierge import create_app

# Frozen reference instant for pure-logic tests (test_sla, test_queue).
FROZEN_NOW = "2026-07-16T12:00:00+00:00"


def frozen_ago(minutes: float) -> str:
    """ISO timestamp `minutes` before FROZEN_NOW — for pure SLA math tests."""
    base = datetime.fromisoformat(FROZEN_NOW)
    return (base - timedelta(minutes=minutes)).isoformat()


def live_ago(minutes: float) -> str:
    """ISO timestamp `minutes` before real now — for API tests, where the
    server stamps real timestamps and elapsed time is asserted with tolerance."""
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()


@pytest.fixture()
def app(tmp_path):
    # testing=True: no auto-seed, and the tmp_path DB wins over any env var.
    return create_app(db_path=str(tmp_path / "t.db"), testing=True)


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture()
def mkticket(app):
    """Insert a ticket row directly, with explicit timestamps, bypassing the API."""

    def _mk(**overrides):
        fields = {
            "subject": "Test ticket",
            "requester": "Q. Tester",
            "ticket_type": "Incident",
            "impact": "Medium",
            "urgency": "Medium",
            "priority": "Medium",
            "state": "New",
            "is_vip": 0,
            "assigned_to": None,
            "created_at": live_ago(5),
            "resolved_at": None,
            "closed_at": None,
            "on_hold_since": None,
            "held_minutes": 0,
            "reopened_count": 0,
            "sla_met": None,
        }
        fields.update(overrides)
        db = sqlite3.connect(app.config["DATABASE"])
        try:
            cur = db.execute(
                """INSERT INTO tickets (subject, requester, ticket_type, impact, urgency,
                                        priority, state, is_vip, assigned_to, created_at,
                                        resolved_at, closed_at, on_hold_since, held_minutes,
                                        reopened_count, sla_met)
                   VALUES (:subject, :requester, :ticket_type, :impact, :urgency, :priority,
                           :state, :is_vip, :assigned_to, :created_at, :resolved_at,
                           :closed_at, :on_hold_since, :held_minutes, :reopened_count,
                           :sla_met)""",
                fields,
            )
            db.commit()
            return cur.lastrowid
        finally:
            db.close()

    return _mk
