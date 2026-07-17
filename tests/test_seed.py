"""Seed invariants: the scripted demo beats must survive future edits."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone

import pytest

from concierge import create_app
from concierge.seed import seed_db


@pytest.fixture()
def seeded_app(tmp_path):
    app = create_app(db_path=str(tmp_path / "seed.db"), testing=True)
    seed_db(app.config["DATABASE"], force=True)
    return app


@pytest.fixture()
def payload(seeded_app):
    return seeded_app.test_client().get("/api/tickets").get_json()


def test_seed_counts(payload):
    assert len(payload["queue"]) == 8
    assert len(payload["resolved"]) == 14


def test_at_least_one_open_ticket_already_breached(payload):
    assert any(t["sla_status"] == "breached" for t in payload["queue"])


def test_one_ticket_breaches_within_five_minutes(payload):
    # The live demo beat: someone watching the page sees a breach happen.
    assert any(
        t["sla_remaining_min"] is not None and 0 < t["sla_remaining_min"] <= 5
        for t in payload["queue"]
    )


def test_at_least_one_paused_ticket_on_hold(payload):
    paused = [t for t in payload["queue"] if t["sla_status"] == "paused"]
    assert paused
    assert all(t["on_hold_since"] is not None for t in paused)


def test_at_least_one_reopened_ticket_with_frozen_outcome(payload):
    reopened = [t for t in payload["queue"] if t["reopened_count"] > 0]
    assert reopened
    assert all(t["sla_met"] is not None for t in reopened)


def test_queue_head_is_the_vip_critical(payload):
    head = payload["queue"][0]
    assert head["is_vip"] is True
    assert head["priority"] == "Critical"


def test_sla_attainment_lands_in_believable_range(payload):
    assert 80 <= payload["metrics"]["sla_met_pct"] <= 92


def test_seeding_twice_without_force_is_a_noop(seeded_app):
    db_path = seeded_app.config["DATABASE"]
    db = sqlite3.connect(db_path)
    before = db.execute("SELECT id, subject, created_at FROM tickets ORDER BY id").fetchall()
    db.close()

    seed_db(db_path)  # no force: must not touch a populated DB

    db = sqlite3.connect(db_path)
    after = db.execute("SELECT id, subject, created_at FROM tickets ORDER BY id").fetchall()
    db.close()
    assert after == before


def test_every_event_falls_inside_its_tickets_lifespan(seeded_app):
    db = sqlite3.connect(seeded_app.config["DATABASE"])
    db.row_factory = sqlite3.Row
    rows = db.execute(
        """SELECT e.created_at AS event_at, t.created_at, t.resolved_at, t.closed_at
           FROM ticket_events e JOIN tickets t ON t.id = e.ticket_id"""
    ).fetchall()
    db.close()

    now = datetime.now(timezone.utc)
    assert rows
    for row in rows:
        event_at = datetime.fromisoformat(row["event_at"])
        start = datetime.fromisoformat(row["created_at"])
        end_iso = row["closed_at"] or row["resolved_at"]
        end = datetime.fromisoformat(end_iso) if end_iso else now
        assert start <= event_at <= end
