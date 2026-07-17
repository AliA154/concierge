"""API contract tests: validation, the state machine, hold accounting, events."""

from __future__ import annotations

import pytest

from conftest import live_ago


def get_ticket(client, ticket_id):
    return client.get(f"/api/tickets/{ticket_id}").get_json()


# --- create -----------------------------------------------------------------


def test_create_happy_path(client):
    resp = client.post(
        "/api/tickets",
        json={
            "subject": "  Projector dead in 4A  ",
            "requester": "S. Chu",
            "ticket_type": "Incident",
            "impact": "High",
            "urgency": "High",
            "is_vip": True,
            "priority": "Low",  # client-sent priority must be ignored
        },
        headers={"X-Agent": "Priya Sharma"},
    )
    assert resp.status_code == 201
    ticket = resp.get_json()
    assert resp.headers["Location"].endswith(f"/api/tickets/{ticket['id']}")
    assert ticket["subject"] == "Projector dead in 4A"  # trimmed
    assert ticket["priority"] == "Critical"  # derived, not the client's "Low"
    assert ticket["number"] == f"INC{ticket['id']:07d}"
    assert ticket["sla_target_min"] == 15  # VIP halves the 30m Critical target

    events = get_ticket(client, ticket["id"])["events"]
    assert len(events) == 1
    assert events[0]["event_type"] == "created"
    assert events[0]["actor"] == "Priya Sharma"
    assert events[0]["detail"] == "Ticket created — Critical Incident (VIP)"


def test_create_missing_subject_is_400(client):
    resp = client.post("/api/tickets", json={"requester": "S. Chu"})
    assert resp.status_code == 400
    assert "subject" in resp.get_json()["error"]["message"]


def test_create_invalid_impact_lists_allowed_values(client):
    resp = client.post(
        "/api/tickets",
        json={"subject": "x", "requester": "y", "impact": "Severe"},
    )
    assert resp.status_code == 400
    assert "High, Medium, Low" in resp.get_json()["error"]["message"]


def test_create_subject_over_200_chars_is_400(client):
    resp = client.post("/api/tickets", json={"subject": "x" * 201, "requester": "y"})
    assert resp.status_code == 400


def test_malformed_json_body_gets_json_envelope(client):
    resp = client.post("/api/tickets", data="{not json", content_type="application/json")
    assert resp.status_code == 400
    assert resp.get_json()["error"] == {"code": 400, "message": "request body must be JSON"}


# --- error envelope ----------------------------------------------------------


def test_unknown_url_returns_404_envelope(client):
    resp = client.get("/api/nonsense")
    assert resp.status_code == 404
    assert resp.get_json()["error"]["code"] == 404


def test_wrong_method_returns_405_envelope(client):
    resp = client.delete("/api/tickets")
    assert resp.status_code == 405
    assert resp.get_json()["error"]["code"] == 405


def test_unknown_ticket_returns_404_envelope(client):
    resp = client.get("/api/tickets/999")
    assert resp.status_code == 404
    assert "999" in resp.get_json()["error"]["message"]


# --- state machine -----------------------------------------------------------


def test_patch_closed_is_terminal(client, mkticket):
    tid = mkticket(state="Closed", resolved_at=live_ago(60), closed_at=live_ago(30), sla_met=1)
    resp = client.patch(f"/api/tickets/{tid}", json={"state": "In Progress"})
    assert resp.status_code == 400
    assert "Closed is terminal" in resp.get_json()["error"]["message"]


def test_patch_resolved_to_in_progress_requires_reopen(client, mkticket):
    tid = mkticket(state="Resolved", resolved_at=live_ago(10), sla_met=1)
    resp = client.patch(f"/api/tickets/{tid}", json={"state": "In Progress"})
    assert resp.status_code == 400
    assert "reopen" in resp.get_json()["error"]["message"]


def test_patch_empty_body_is_400(client, mkticket):
    tid = mkticket()
    resp = client.patch(f"/api/tickets/{tid}", json={})
    assert resp.status_code == 400
    assert resp.get_json()["error"]["message"] == "nothing to update"


def test_hold_cycle_stamps_and_accrues(client, mkticket):
    tid = mkticket(state="New", created_at=live_ago(40))
    held = client.patch(f"/api/tickets/{tid}", json={"state": "On Hold"}).get_json()
    assert held["on_hold_since"] is not None
    assert held["sla_status"] == "paused"

    # Simulate a 30-minute hold by planting on_hold_since in the past.
    tid2 = mkticket(state="On Hold", created_at=live_ago(40), on_hold_since=live_ago(30))
    resumed = client.patch(f"/api/tickets/{tid2}", json={"state": "In Progress"}).get_json()
    assert resumed["on_hold_since"] is None
    assert resumed["held_minutes"] == pytest.approx(30, abs=0.2)
    assert resumed["sla_elapsed_min"] == pytest.approx(10, abs=0.2)


def test_resolve_while_held_accrues_then_resolves(client, mkticket):
    # Critical (30m target): 40m wall clock minus a 30m hold = 10m effective.
    tid = mkticket(
        state="On Hold", priority="Critical", created_at=live_ago(40), on_hold_since=live_ago(30)
    )
    resolved = client.patch(f"/api/tickets/{tid}", json={"state": "Resolved"}).get_json()
    assert resolved["on_hold_since"] is None
    assert resolved["held_minutes"] == pytest.approx(30, abs=0.2)
    assert resolved["resolved_at"] is not None
    assert resolved["sla_met"] is True  # 10m effective, comfortably under 30m


def test_resolve_stamps_and_freezes_sla_met_once(client, mkticket):
    tid = mkticket(state="In Progress", priority="Critical", created_at=live_ago(45))
    resolved = client.patch(f"/api/tickets/{tid}", json={"state": "Resolved"}).get_json()
    assert resolved["resolved_at"] is not None
    assert resolved["sla_met"] is False  # 45m elapsed vs 30m target
    assert resolved["sla_status"] == "missed"


def test_sla_met_survives_reopen_and_re_resolve(client, mkticket):
    # First resolution met SLA; the clock is long past target now. Reopening and
    # re-resolving must NOT flip the frozen outcome to missed.
    tid = mkticket(
        state="Resolved",
        priority="Critical",
        created_at=live_ago(500),
        resolved_at=live_ago(480),
        sla_met=1,
    )
    reopened = client.post(f"/api/tickets/{tid}/reopen").get_json()
    assert reopened["state"] == "In Progress"
    assert reopened["resolved_at"] is None
    assert reopened["sla_met"] is True
    assert reopened["reopened_count"] == 1

    re_resolved = client.patch(f"/api/tickets/{tid}", json={"state": "Resolved"}).get_json()
    assert re_resolved["sla_met"] is True  # frozen, despite ~500m > 30m target

    events = get_ticket(client, tid)["events"]
    assert events[1]["event_type"] == "reopened"
    assert events[1]["detail"] == "Reopened — resolution did not hold (reopen #1)"


def test_reopen_from_new_is_400(client, mkticket):
    tid = mkticket(state="New")
    resp = client.post(f"/api/tickets/{tid}/reopen")
    assert resp.status_code == 400


# --- assignment --------------------------------------------------------------


def test_assign_valid_agent_and_unassign(client, mkticket):
    tid = mkticket()
    assigned = client.patch(f"/api/tickets/{tid}", json={"assigned_to": "Marcus Tate"}).get_json()
    assert assigned["assigned_to"] == "Marcus Tate"
    unassigned = client.patch(f"/api/tickets/{tid}", json={"assigned_to": None}).get_json()
    assert unassigned["assigned_to"] is None

    details = [e["detail"] for e in get_ticket(client, tid)["events"]]
    assert details[0] == "Unassigned"
    assert details[1] == "Assigned to Marcus Tate"


def test_assign_unknown_agent_is_400(client, mkticket):
    tid = mkticket()
    resp = client.patch(f"/api/tickets/{tid}", json={"assigned_to": "Nobody"})
    assert resp.status_code == 400


def test_auto_assign_on_take_with_valid_agent(client, mkticket):
    tid = mkticket(state="New", assigned_to=None)
    resp = client.patch(
        f"/api/tickets/{tid}", json={"state": "In Progress"}, headers={"X-Agent": "Dana Whitfield"}
    ).get_json()
    assert resp["assigned_to"] == "Dana Whitfield"

    events = get_ticket(client, tid)["events"]
    types = {e["event_type"] for e in events}
    assert {"state_change", "assigned"} <= types
    assert all(e["actor"] == "Dana Whitfield" for e in events if e["event_type"] != "created")


def test_unknown_x_agent_falls_back_to_system(client, mkticket):
    tid = mkticket(state="New", assigned_to=None)
    resp = client.patch(
        f"/api/tickets/{tid}", json={"state": "In Progress"}, headers={"X-Agent": "Zorp"}
    ).get_json()
    assert resp["assigned_to"] is None  # no auto-assign for an unknown agent
    events = get_ticket(client, tid)["events"]
    assert events[0]["event_type"] == "state_change"
    assert events[0]["actor"] == "System"


# --- work notes --------------------------------------------------------------


def test_add_note_returns_event(client, mkticket):
    tid = mkticket()
    resp = client.post(
        f"/api/tickets/{tid}/notes",
        json={"note": "Checked the switch port, all green."},
        headers={"X-Agent": "Ali Ahmad"},
    )
    assert resp.status_code == 201
    event = resp.get_json()
    assert event["event_type"] == "work_note"
    assert event["actor"] == "Ali Ahmad"
    assert event["detail"] == "Checked the switch port, all green."
    assert get_ticket(client, tid)["events"][0]["id"] == event["id"]


def test_note_over_1000_chars_is_400(client, mkticket):
    tid = mkticket()
    resp = client.post(f"/api/tickets/{tid}/notes", json={"note": "x" * 1001})
    assert resp.status_code == 400


def test_note_on_closed_ticket_is_400(client, mkticket):
    tid = mkticket(state="Closed", resolved_at=live_ago(60), closed_at=live_ago(30), sla_met=1)
    resp = client.post(f"/api/tickets/{tid}/notes", json={"note": "too late"})
    assert resp.status_code == 400


# --- metrics, reset, smoke ---------------------------------------------------


def test_metrics_on_empty_db_have_safe_defaults(client):
    metrics = client.get("/api/tickets").get_json()["metrics"]
    assert metrics["open"] == 0
    assert metrics["mttr_min"] == 0
    assert metrics["sla_met_pct"] == 100  # no completed work yet — no division error


def test_demo_reset_reseeds_and_rate_limits(client):
    first = client.post("/api/demo/reset")
    assert first.status_code == 200
    assert first.get_json()["ok"] is True
    payload = client.get("/api/tickets").get_json()
    assert len(payload["queue"]) == 8

    second = client.post("/api/demo/reset")
    assert second.status_code == 429
    assert second.get_json()["error"]["code"] == 429


def test_index_renders(client):
    # Gunicorn smoke: `gunicorn app:app` serves this same view.
    assert client.get("/").status_code == 200
