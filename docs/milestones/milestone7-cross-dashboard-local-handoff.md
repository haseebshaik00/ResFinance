# Milestone 7: Deliverables — Cross-dashboard Integration & Local Handoff

Status: Complete for the declared local-development scope.

Historical `scripts.milestone8`, `scripts.milestone9`, `config/milestone8-*`,
and `config/milestone9-*` identifiers remain stable compatibility names. Cloud
and production deployment remain out of scope.

## Cross-dashboard integration

- The authenticated shell connects Personal Finance, Friends & Groups, and
  Crypto Intelligence; Smart Savings Insights remains embedded and read-only.
- Finance and Group state continue to follow the documented append-only,
  signed-intent, and ResContract boundaries.
- The Crypto Intelligence surface presents the active seven-day MSPCIFormer
  forecast path and the wallet-scoped risk profile. It never trades, transfers
  funds, or mutates Finance.

## Local handoff

`scripts.milestone9.local_handoff` provides bounded local lifecycle commands
for preflight, start, status, logs, stop, restart, and explicitly confirmed
reset. The local browser journey covers wallet authentication, Finance, Groups,
settlement, Crypto Intelligence, notifications, and read-only Insights.

The daily Crypto Intelligence workflow keeps its stable filename for GitHub
Actions and catch-up compatibility, but now performs only a BTC/ETH/SOL market
data refresh. It emits a bounded, auditable receipt after ingesting the latest
completed UTC market day. The saved MSPCIFormer checkpoint is refreshed by
inference when the dashboard next requests a forecast; the scheduled job does
not train, select, compare, or publish a model.

Use [`../local-operator-guide.md`](../local-operator-guide.md) for the active
local lifecycle and refresh procedure. Historical Paper 2 artifacts are kept
outside active operating guidance under
[`../research/archive/paper2-multimodal-naive/`](../research/archive/paper2-multimodal-naive/).
