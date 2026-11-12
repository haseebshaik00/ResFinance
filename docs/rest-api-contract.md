# REST API Contract

Status: Milestones 2–7 authentication, Finance, Groups, contractual settlement, Crypto Intelligence portfolio, read-only AI, and integration boundaries implemented for local development

## Boundary

The browser calls application services only through generated clients for `/api/v1`. ResilientDB, ResContract GraphQL, contract CLI endpoints, and provider credentials are private infrastructure and are never browser-accessible.

All requests and responses use JSON unless an endpoint explicitly documents another representation. Timestamps are RFC 3339 UTC values. Unknown fields are rejected on commands. Public identifiers are opaque strings.

## Shared types

```text
CryptoAsset = "BTC" | "ETH" | "SOL"
Money = { "currency": "USD", "minor_units": int64 }
DecimalString = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/
```

Money never uses a JSON floating-point number. Crypto quantities, prices, returns, weights, and probabilities use validated decimal strings with endpoint-specific scale and bounds.

## Commands and idempotency

Every state-changing endpoint requires `Idempotency-Key`. The value is scoped to the authenticated tenant and command type. Reusing a key with the same canonical request returns the original outcome; reusing it with a different request returns `409 Conflict`.

Successful command responses expose:

```json
{
  "event_id": "opaque-event-id",
  "projection_version": 12,
  "occurred_at_utc": "2026-10-12T00:00:00Z",
  "receipt_ids": []
}
```

Contract-affecting commands additionally require a backend-verified signed intent. A finance event may be appended only after confirmed ResContract state and a receipt.

## Signed intent

The signed bytes are RFC 8785 canonical JSON of every field except `signature`:

```json
{
  "version": 1,
  "intent_id": "opaque-id",
  "action": "settlement.authorize",
  "actor_public_key": "base58-ed25519-public-key",
  "actor_address": "derived-address",
  "resource_id": "opaque-resource-id",
  "parameters_hash": "sha256-hex",
  "nonce": "single-use-value",
  "issued_at": "2026-10-12T00:00:00Z",
  "expires_at": "2026-10-12T00:05:00Z",
  "origin": "https://app.resfinance.local",
  "audience": "resfinance-api",
  "network_id": "pinned-local-network",
  "signature": "base58-ed25519-signature"
}
```

The backend verifies the signature, public-key/address relationship, action, audience, network, origin policy, expiry, nonce uniqueness, parameter hash, authorization, and expected resource version before invoking ResContract.

`origin` is a required signed-intent field. It must exactly equal the browser `Origin` header and an explicitly configured ResFinance origin.

## Authentication

- `POST /api/v1/auth/challenges` accepts a public Ed25519 identity and returns a five-minute challenge.
- `POST /api/v1/auth/sessions` consumes an approved `auth.login` signed intent and the matching challenge.
- `POST /api/v1/auth/refresh` rotates the refresh session and returns a new memory-only access token.
- `DELETE /api/v1/auth/sessions/current` revokes the session and expires the refresh cookie.

Access tokens are opaque and held only in API/browser process memory. Refresh tokens use an HttpOnly, SameSite=Strict cookie; only their SHA-256 hashes are persisted in ResilientDB. Challenges are also persisted only as hashes. Challenge use, intent nonces, refresh rotation, and logout append durable use or revocation markers. The checked local environment permits `https://app.resfinance.local` and `http://127.0.0.1:5173` exactly.

## Personal Finance

- `GET /api/v1/finance/overview?month=YYYY-MM` returns the authenticated user's rebuilt monthly summary, categories, transactions, budgets, recurring entries, read-only obligations, and provenance.
- `POST /api/v1/finance/categories` appends an income or expense category.
- `POST /api/v1/finance/transactions` appends an integer-cent USD income or expense.
- `POST /api/v1/finance/transactions/{id}/void` appends a compensating void event.
- `POST /api/v1/finance/budgets` appends or replaces the named category-month budget in the projection.
- `POST /api/v1/finance/budgets/{id}/deactivate` appends a budget deactivation event; the original budget remains in the audit projection but no longer contributes an active monthly guardrail.
- `POST /api/v1/finance/recurring` appends a monthly recurring entry.
- `POST /api/v1/finance/recurring/{id}/deactivate` appends a deactivation event.

There is intentionally no public obligation-write endpoint. Receivables and payables enter Finance only through the application service after confirmed ResContract state, with a source event and contract receipt. Finance responses expose formula version `finance-savings-v1`, a deterministic savings calculation ID, projection freshness, and source event IDs.

## Groups and contractual settlement

- `GET /api/v1/groups` lists the authenticated wallet's group projections.
- `POST /api/v1/groups` creates a group and owner membership.
- `GET /api/v1/groups/{group_id}` returns members, expenses, obligations, internal-credit balances, notifications, and event provenance.
- `POST /api/v1/groups/{group_id}/members` adds a wallet member; only the owner may call it.
- `POST /api/v1/groups/{group_id}/expenses` validates an exact integer-cent split and requires the payer's `split.approve` signed intent before creating contract obligations.
- `POST /api/v1/groups/{group_id}/obligations/{obligation_id}/decision` requires the debtor's signed approval or rejection.
- `POST /api/v1/groups/{group_id}/credits` requires a `credits.fund` signed intent and issues internal accounting credits only.
- `POST /api/v1/groups/{group_id}/obligations/{obligation_id}/settlements` requires the debtor's `settlement.authorize` signed intent and accepts a positive partial or full outstanding amount.

Every Group write is append-only, encrypted before ResilientDB, version checked, and idempotency keyed. Contract receipts are verified against live obligation and credit state before Finance changes. Responses label credits as non-redeemable, non-monetary, and without cash value.

## Crypto risk and portfolio

- `GET /api/v1/crypto/overview?month=YYYY-MM` returns the versioned risk
  profile, Finance-owned default capital, promoted forecast evidence when
  available, and a constrained portfolio recommendation when every gate passes.
- `POST /api/v1/crypto/risk-profile` appends an idempotent encrypted
  `risk-questionnaire-v2` profile event and requires the expected profile
  version. It accepts three required answers from 1 through 3:
  `investment_horizon`, `risk_tolerance`, and `liquidity_needs`; the score is
  the nearest whole-number result of `100 × (investment_horizon +
  risk_tolerance + liquidity_needs) / 9`.
- `POST /api/v1/crypto/scenarios` returns an isolated allocation for positive
  integer USD cents. It appends no event and carries no Finance savings source.

Forecast records require a matching immutable promotion event, research run,
adaptive-gating model artifact hash, and dataset hash. The API rejects stale
forecasts. The normal runtime also rejects synthetic acceptance fixtures. A
recommendation carries the risk event, forecast snapshot, promotion event,
portfolio policy, Finance calculation, Finance source events, solver path, caps,
weights, exact integer-cent allocations, and a no-trading warning.

## Read-only Smart Savings Insights

- `GET /api/v1/insights/overview?month=YYYY-MM` returns a wallet-authorized,
  content-addressed fact bundle, an initial Smart Savings Insight, and in-app
  notifications linking to Finance, Groups, or Crypto Intelligence.
- `POST /api/v1/insights/query` accepts a month and a question of at most 500
  characters. The POST is computational only: it appends no event and changes
  no projection.

The server assembles facts through the authenticated Finance, Groups, and
Portfolio application services. The pinned local instruction model may select
one through four fact IDs; it cannot author final financial claims. The server
rejects unknown, duplicate, off-topic, or low-confidence selections and renders
the answer from validated fact statements. Each returned evidence item includes
its fact ID, source kind, source IDs, and as-of time.

Prompt-control text, prohibited action requests, and unsupported topics return
a refusal or deterministic fallback. The insights application has no mutation,
wallet, signing, ResContract, trading, direct ResilientDB, or external network
port. Model unavailability also falls back without weakening these boundaries.

## Errors

Errors use RFC 9457 Problem Details with `application/problem+json`:

```json
{
  "type": "https://resfinance.local/problems/idempotency-conflict",
  "title": "Idempotency key conflict",
  "status": 409,
  "detail": "The key was previously used for a different command.",
  "instance": "/api/v1/groups/example/settlements",
  "trace_id": "opaque-trace-id"
}
```

Validation errors may add an `errors` array containing field paths and stable machine-readable codes. Problem details never echo secrets, raw signed payloads, decrypted records, or provider credentials.

## Concurrency, paging, and provenance

- Commands that depend on aggregate state include the expected version; stale commands return `409`.
- Collection endpoints use opaque cursors and deterministic ordering, never an unbounded “list everything” operation.
- Responses include projection freshness and the source event IDs used to build the view.
- Market, forecast, research, and AI responses include source IDs, observation/as-of times, retrieval times, model/dataset hashes, and applicable warnings.
- Scenario endpoints are read-only and cannot update Finance or the saved default amount.
