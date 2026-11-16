# Daily Crypto Intelligence market-refresh evidence

The scheduled fixed-PST market-refresh workflow writes one dated evidence
file here after each run:

```text
milestone9-forward-completion-YYYY-MM-DD.json
```

The filename date is the 6:00 AM PST run date. The evidence uses the previous
PST calendar day as its current provider cutoff and records the idempotent
Coin Metrics BTC/ETH/SOL ingestion receipt. Forecast inference uses the saved
MSPCIFormer/VASA artifact when the dashboard next reads the refreshed data.

These JSON records contain bounded provenance and ingestion identifiers emitted
by `scripts.milestone9.run_forward_completion`. Raw provider observations,
model artifacts, encryption keys, and forecasts remain in ResilientDB and must
not be committed here. Retired Paper 2 records are archived under
`docs/research/archive/paper2-multimodal-naive/`.
