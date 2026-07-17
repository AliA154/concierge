"""Queue ordering: VIP class first, then severity, then age — and stable."""

from __future__ import annotations

from concierge.sla import queue_sort_key
from conftest import frozen_ago


def ticket(tid, is_vip, priority, created_ago):
    return {
        "id": tid,
        "is_vip": is_vip,
        "priority": priority,
        "created_at": frozen_ago(created_ago),
    }


def sort_ids(tickets):
    return [t["id"] for t in sorted(tickets, key=queue_sort_key)]


def test_vip_low_sorts_above_non_vip_critical():
    tickets = [
        ticket(1, False, "Critical", 60),
        ticket(2, True, "Low", 5),
    ]
    assert sort_ids(tickets) == [2, 1]


def test_priority_order_within_vip_class():
    tickets = [
        ticket(1, True, "Low", 10),
        ticket(2, True, "Medium", 10),
        ticket(3, True, "Critical", 10),
        ticket(4, True, "High", 10),
    ]
    assert sort_ids(tickets) == [3, 4, 2, 1]


def test_created_at_breaks_ties_oldest_first():
    tickets = [
        ticket(1, False, "High", 5),
        ticket(2, False, "High", 90),
        ticket(3, False, "High", 30),
    ]
    assert sort_ids(tickets) == [2, 3, 1]


def test_sort_order_is_independent_of_input_order():
    tickets = [
        ticket(1, True, "Critical", 20),
        ticket(2, True, "High", 45),
        ticket(3, False, "Critical", 10),
        ticket(4, False, "Medium", 300),
        ticket(5, False, "Medium", 30),
        ticket(6, False, "Low", 500),
    ]
    expected = sort_ids(tickets)
    for rotation in range(1, len(tickets)):
        shuffled = tickets[rotation:] + tickets[:rotation]
        assert sort_ids(shuffled) == expected
    assert sort_ids(list(reversed(tickets))) == expected
