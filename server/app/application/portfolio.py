from __future__ import annotations

import hashlib
import re
import threading

from server.app.application.projections import rebuild_projection
from server.app.domain.events import AppendEventCommand, AppendResult
from server.app.domain.portfolio import (
    RISK_POLICY_VERSION,
    RiskAnswers,
    RiskProjection,
    reduce_risk_event,
)
from server.app.infrastructure.event_repository import EncryptedEventRepository

_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


class PortfolioRejected(ValueError):
    pass


class PortfolioService:
    """Wallet-scoped risk-profile storage for the active seven-day portfolio flow."""

    def __init__(self, events: EncryptedEventRepository) -> None:
        self._events = events
        self._lock = threading.Lock()

    def record_risk_profile(
        self,
        *,
        actor_address: str,
        idempotency_key: str,
        expected_version: int,
        answers: RiskAnswers,
    ) -> AppendResult:
        tenant_id, aggregate_id, actor_id = _identity(actor_address)
        if not _ID.fullmatch(idempotency_key):
            raise PortfolioRejected("idempotency_key must be an opaque identifier")
        command = AppendEventCommand(
            tenant_id=tenant_id,
            actor_id=actor_id,
            command_type="risk.record-profile",
            idempotency_key=idempotency_key,
            event_type="risk.profile-recorded",
            aggregate_type="risk-profile",
            aggregate_id=aggregate_id,
            expected_version=expected_version,
            payload={
                "answers": answers.to_dict(),
                "score": answers.score,
                "policy_version": RISK_POLICY_VERSION,
            },
        )
        with self._lock:
            if (existing := self._events.find_idempotent(command)) is not None:
                return existing
            return self._events.append(command)

    def risk_profile(self, *, actor_address: str) -> RiskProjection:
        tenant_id, aggregate_id, _ = _identity(actor_address)
        events = self._events.load_stream(
            tenant_id=tenant_id,
            aggregate_type="risk-profile",
            aggregate_id=aggregate_id,
        )
        return rebuild_projection(events, initial=RiskProjection(), reducer=reduce_risk_event)


def _identity(actor_address: str) -> tuple[str, str, str]:
    digest = hashlib.sha256(actor_address.encode()).hexdigest()[:32]
    return f"tenant-{digest}", f"risk-{digest}", f"wallet-{digest}"
