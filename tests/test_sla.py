"""Pure SLA math: targets, the priority matrix, hold-adjusted elapsed, status tiers."""

from __future__ import annotations

import pytest

from concierge.sla import derive_priority, effective_elapsed, sla_minutes, sla_status
from conftest import FROZEN_NOW, frozen_ago


@pytest.mark.parametrize(
    ("priority", "target"),
    [("Critical", 30), ("High", 60), ("Medium", 240), ("Low", 480)],
)
def test_sla_minutes_per_priority(priority, target):
    assert sla_minutes(priority, is_vip=False) == target


@pytest.mark.parametrize(
    ("priority", "target"),
    [("Critical", 15), ("High", 30), ("Medium", 120), ("Low", 240)],
)
def test_sla_minutes_vip_halved(priority, target):
    assert sla_minutes(priority, is_vip=True) == target


def test_sla_minutes_unknown_priority_falls_back_to_low():
    assert sla_minutes("Bogus", is_vip=False) == 480
    assert sla_minutes("Bogus", is_vip=True) == 240


@pytest.mark.parametrize(
    ("impact", "urgency", "priority"),
    [
        ("High", "High", "Critical"),
        ("High", "Medium", "High"),
        ("High", "Low", "Medium"),
        ("Medium", "High", "High"),
        ("Medium", "Medium", "Medium"),
        ("Medium", "Low", "Low"),
        ("Low", "High", "Medium"),
        ("Low", "Medium", "Low"),
        ("Low", "Low", "Low"),
    ],
)
def test_derive_priority_covers_full_matrix(impact, urgency, priority):
    assert derive_priority(impact, urgency) == priority


def test_effective_elapsed_subtracts_accrued_hold_time():
    elapsed = effective_elapsed(frozen_ago(100), FROZEN_NOW, held_minutes=30.0)
    assert elapsed == pytest.approx(70.0)


def test_effective_elapsed_subtracts_in_progress_hold():
    # 100m wall clock, 10m of completed holds, currently 20m into another hold.
    elapsed = effective_elapsed(
        frozen_ago(100), FROZEN_NOW, held_minutes=10.0, on_hold_since=frozen_ago(20)
    )
    assert elapsed == pytest.approx(70.0)


def test_effective_elapsed_stops_at_resolution():
    elapsed = effective_elapsed(frozen_ago(100), FROZEN_NOW, resolved_at=frozen_ago(60))
    assert elapsed == pytest.approx(40.0)


def test_at_risk_starts_exactly_at_75_percent():
    assert sla_status("In Progress", elapsed=45.0, target=60, sla_met=None) == "at_risk"
    assert sla_status("In Progress", elapsed=44.9, target=60, sla_met=None) == "ok"


def test_breached_only_when_remaining_goes_negative():
    assert sla_status("In Progress", elapsed=60.0, target=60, sla_met=None) == "at_risk"
    assert sla_status("In Progress", elapsed=60.1, target=60, sla_met=None) == "breached"


def test_on_hold_reports_paused():
    assert sla_status("On Hold", elapsed=30.0, target=60, sla_met=None) == "paused"


def test_breached_is_sticky_while_on_hold():
    assert sla_status("On Hold", elapsed=61.0, target=60, sla_met=None) == "breached"


@pytest.mark.parametrize(
    ("state", "sla_met", "expected"),
    [
        ("Resolved", 1, "met"),
        ("Resolved", 0, "missed"),
        ("Closed", 1, "met"),
        ("Closed", 0, "missed"),
    ],
)
def test_done_states_report_frozen_outcome(state, sla_met, expected):
    # Elapsed is irrelevant once resolved: the frozen sla_met flag decides.
    assert sla_status(state, elapsed=999.0, target=60, sla_met=sla_met) == expected
