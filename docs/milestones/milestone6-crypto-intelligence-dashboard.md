# Milestone 6: Crypto Intelligence — Risk & Portfolio Dashboard

Status: complete for the active local, seven-day market-only workflow.

## Active workflow

1. The dashboard reads a verified Original MSPCIFormer or VASA-MSPCIFormer
   checkpoint and seven direct BTC/ETH/SOL price paths.
2. Completed market observations can trigger inference-only refresh; stale
   coverage is visible rather than silently replaced.
3. A wallet-scoped v3 questionnaire selects Conservative, Balanced, or Growth
   BTC/ETH/SOL/USD-cash strategic targets.
4. The selected model's held-out calibration blends an optimizer view only
   within the fixed crypto sleeve. USD cash and total crypto exposure remain
   profile-controlled.
5. The allocation uses Ledoit-Wolf covariance, a fixed `lambda = 5.0`,
   CLARABEL/SCS fallback on the same objective, and exact-cent reconciliation.

The page shows market cards, a seven-day chart with a Historical Error Range,
one hypothetical USD capital input, risk questionnaire, cash-inclusive
allocation, provenance, and freshness warnings. No trade is executed and no
Finance record is changed.

Active endpoints:

- `GET /api/v1/crypto/forecast`
- `GET /api/v1/crypto/risk-profile`
- `POST /api/v1/crypto/risk-profile`
- `POST /api/v1/crypto/recommendations`

## Boundaries

The retired 15-day portfolio/snapshot routes, adaptive-gating path, and
naïve-baseline promotion gate are not part of this milestone's active product
surface. Their dated evidence is preserved under
[`../research/archive/paper2-multimodal-naive/`](../research/archive/paper2-multimodal-naive/).

See [`../research/phase2-seven-day-portfolio.md`](../research/phase2-seven-day-portfolio.md)
for the active policy and exercised local result.
