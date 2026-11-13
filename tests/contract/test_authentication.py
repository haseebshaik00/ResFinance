from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi.testclient import TestClient

from server.app.application.authentication import AuthenticationService
from server.app.application.intents import (
    IntentPolicy,
    actor_address,
    base58_encode,
    canonical_json,
    parameters_hash,
    verify_signed_intent,
)
from server.app.domain.settlement import SignedIntent
from server.app.infrastructure.auth_repository import AuthRepository
from server.app.main import create_app

NOW = datetime.now(UTC).replace(microsecond=0)
CROSS_LANGUAGE_FIXTURE_NOW = datetime(2026, 10, 13, 18, 0, tzinfo=UTC)
ORIGIN = "https://app.resfinance.local"


class MemoryKeyValueStore:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}

    def get(self, key: str) -> str | None:
        return self.values.get(key)

    def put(self, key: str, value: str) -> None:
        self.values[key] = value

    def range_values(self, prefix: str) -> Sequence[str]:
        return [self.values[key] for key in sorted(self.values) if key.startswith(prefix)]


class TokenFactory:
    def __init__(self) -> None:
        self.counter = 0

    def __call__(self, size: int) -> str:
        self.counter += 1
        return f"token-{self.counter:04d}-" + "x" * size


def service(store: MemoryKeyValueStore) -> AuthenticationService:
    return AuthenticationService(
        AuthRepository(store),
        clock=lambda: NOW,
        token_factory=TokenFactory(),
    )


def wallet() -> tuple[Ed25519PrivateKey, dict[str, str]]:
    private_key = Ed25519PrivateKey.generate()
    public_bytes = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return private_key, {
        "public_key": base58_encode(public_bytes),
        "address": actor_address(public_bytes),
    }


def challenge(client: TestClient, identity: dict[str, str]) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/challenges",
        headers={"Origin": ORIGIN},
        json={"wallet": identity},
    )
    assert response.status_code == 201
    return response.json()


def login_intent(
    private_key: Ed25519PrivateKey,
    identity: dict[str, str],
    challenge_body: dict[str, str],
    *,
    origin: str = ORIGIN,
    network_id: str = "pinned-local-network",
    expires_at: datetime = NOW + timedelta(minutes=5),
    nonce: str = "nonce-login-000000000001",
) -> dict[str, object]:
    parameters = {"challenge": challenge_body["challenge"], "origin": origin}
    payload: dict[str, object] = {
        "version": 1,
        "intent_id": "intent-login-0001",
        "action": "auth.login",
        "actor_public_key": identity["public_key"],
        "actor_address": identity["address"],
        "resource_id": challenge_body["challenge_id"],
        "parameters_hash": parameters_hash(parameters),
        "nonce": nonce,
        "issued_at": NOW.isoformat().replace("+00:00", "Z"),
        "expires_at": expires_at.isoformat().replace("+00:00", "Z"),
        "origin": origin,
        "audience": "resfinance-api",
        "network_id": network_id,
    }
    payload["signature"] = base58_encode(private_key.sign(canonical_json(payload)))
    return payload


def create_session(
    client: TestClient,
    challenge_body: dict[str, str],
    intent: dict[str, object],
    *,
    origin: str = ORIGIN,
):
    return client.post(
        "/api/v1/auth/sessions",
        headers={"Origin": origin},
        json={"challenge": challenge_body["challenge"], "intent": intent},
    )


def test_approved_challenge_creates_memory_access_and_hashed_refresh_session() -> None:
    store = MemoryKeyValueStore()
    private_key, identity = wallet()
    client = TestClient(create_app(service(store)))
    challenge_body = challenge(client, identity)

    response = create_session(
        client,
        challenge_body,
        login_intent(private_key, identity, challenge_body),
    )

    assert response.status_code == 201
    assert response.json()["actor_address"] == identity["address"]
    access_token = response.json()["access_token"]
    refresh_cookie = client.cookies.get("resfinance_refresh")
    assert refresh_cookie is not None
    persisted = "".join(store.values.values())
    assert access_token not in persisted
    assert refresh_cookie not in persisted
    assert challenge_body["challenge"] not in persisted
    session_records = [
        json.loads(value)
        for key, value in store.values.items()
        if key.startswith("auth:session:")
    ]
    assert len(session_records) == 1
    assert len(session_records[0]["refresh_token_hash"]) == 64


def test_tamper_replay_expiry_wrong_origin_and_wrong_network_are_rejected() -> None:
    private_key, identity = wallet()

    cases = (
        {"network_id": "wrong-network"},
        {"expires_at": NOW - timedelta(seconds=1)},
        {"origin": "https://evil.example"},
    )
    for overrides in cases:
        store = MemoryKeyValueStore()
        client = TestClient(create_app(service(store)))
        challenge_body = challenge(client, identity)
        intent = login_intent(
            private_key,
            identity,
            challenge_body,
            network_id=str(overrides.get("network_id", "pinned-local-network")),
            expires_at=overrides.get("expires_at", NOW + timedelta(minutes=5)),
            origin=str(overrides.get("origin", ORIGIN)),
        )
        response = create_session(client, challenge_body, intent)
        assert response.status_code in {403, 422}

    store = MemoryKeyValueStore()
    client = TestClient(create_app(service(store)))
    challenge_body = challenge(client, identity)
    valid = login_intent(private_key, identity, challenge_body)
    tampered = json.loads(json.dumps(valid))
    tampered["parameters_hash"] = "0" * 64
    assert create_session(client, challenge_body, tampered).status_code == 422
    bad_signature = json.loads(json.dumps(valid))
    replacement = "2" if bad_signature["signature"].startswith("1") else "1"
    bad_signature["signature"] = replacement + bad_signature["signature"][1:]
    assert create_session(client, challenge_body, bad_signature).status_code == 422
    assert create_session(client, challenge_body, valid).status_code == 201
    assert create_session(client, challenge_body, valid).status_code == 409

    second_challenge = challenge(client, identity)
    repeated_nonce = login_intent(
        private_key,
        identity,
        second_challenge,
        nonce="nonce-login-000000000001",
    )
    assert create_session(client, second_challenge, repeated_nonce).status_code == 409


def test_refresh_survives_service_restart_rotates_and_logout_revokes() -> None:
    store = MemoryKeyValueStore()
    private_key, identity = wallet()
    first_client = TestClient(create_app(service(store)))
    challenge_body = challenge(first_client, identity)
    login = create_session(
        first_client,
        challenge_body,
        login_intent(private_key, identity, challenge_body),
    )
    assert login.status_code == 201
    first_refresh = first_client.cookies.get("resfinance_refresh")
    assert first_refresh is not None

    restarted_client = TestClient(create_app(service(store)))
    restarted_client.cookies.set(
        "resfinance_refresh",
        first_refresh,
        domain="testserver.local",
        path="/api/v1/auth",
    )
    refreshed = restarted_client.post(
        "/api/v1/auth/refresh", headers={"Origin": ORIGIN}
    )
    assert refreshed.status_code == 200
    second_refresh = restarted_client.cookies.get(
        "resfinance_refresh", domain="testserver.local", path="/api/v1/auth"
    )
    assert second_refresh is not None and second_refresh != first_refresh

    replay_client = TestClient(create_app(service(store)))
    replay_client.cookies.set(
        "resfinance_refresh",
        first_refresh,
        domain="testserver.local",
        path="/api/v1/auth",
    )
    assert replay_client.post(
        "/api/v1/auth/refresh", headers={"Origin": ORIGIN}
    ).status_code == 401

    logout = restarted_client.delete(
        "/api/v1/auth/sessions/current",
        headers={
            "Origin": ORIGIN,
            "Authorization": f"Bearer {refreshed.json()['access_token']}",
        },
    )
    assert logout.status_code == 204
    restarted_client.cookies.set(
        "resfinance_refresh",
        second_refresh,
        domain="testserver.local",
        path="/api/v1/auth",
    )
    assert restarted_client.post(
        "/api/v1/auth/refresh", headers={"Origin": ORIGIN}
    ).status_code == 401


def test_unconfigured_application_fails_closed_for_authentication() -> None:
    private_key, identity = wallet()
    del private_key
    response = TestClient(create_app()).post(
        "/api/v1/auth/challenges",
        headers={"Origin": ORIGIN},
        json={"wallet": identity},
    )
    assert response.status_code == 503


def test_reswallet_typescript_signature_matches_backend_rfc8785_verifier() -> None:
    fixture_path = (
        Path(__file__).parent / "fixtures" / "reswallet-signed-intent.json"
    )
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    intent_value = fixture["intent"]
    intent = SignedIntent(
        **{
            **intent_value,
            "issued_at": datetime.fromisoformat(
                intent_value["issued_at"].replace("Z", "+00:00")
            ),
            "expires_at": datetime.fromisoformat(
                intent_value["expires_at"].replace("Z", "+00:00")
            ),
        }
    )

    intent_hash = verify_signed_intent(
        intent,
        parameters=fixture["parameters"],
        origin=ORIGIN,
        now=CROSS_LANGUAGE_FIXTURE_NOW,
        policy=IntentPolicy(action="auth.login"),
    )

    assert len(intent_hash) == 64
