from __future__ import annotations

from server.app.domain.insights import FactSelection
from tests.contract.test_insights import (
    ControlledSelector,
    MemoryKeyValueStore,
    record_finance,
    services,
)


def test_finance_portfolio_and_ai_integration_is_evidence_bound_and_read_only() -> None:
    store = MemoryKeyValueStore()
    actor = "0x" + "f" * 40
    finance, _, _ = services(store)
    record_finance(finance, actor)
    selector = ControlledSelector(
        FactSelection(
            fact_ids=("savings.available", "crypto.risk.missing"),
            confidence=0.97,
        )
    )
    _, _, insights = services(store, selector=selector)
    before = dict(store.values)

    response = insights.answer(
        actor_address=actor,
        month="2026-10",
        question="Give me a dashboard overview.",
    )

    assert response.mode == "local-model"
    assert [item.fact_id for item in response.evidence] == [
        "savings.available",
        "crypto.risk.missing",
    ]
    assert "$1,900.00" in response.summary
    assert "No risk profile is recorded yet" in response.summary
    assert store.values == before
