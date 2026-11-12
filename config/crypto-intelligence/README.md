# Daily Crypto Intelligence evidence

The scheduled fixed-PST forward-completion workflow writes one dated evidence
file here after each run:

```text
milestone9-forward-completion-YYYY-MM-DD.json
```

The filename date is the 6:00 AM PST run date. The evidence uses the previous
PST calendar day as its current provider cutoff. Successful and immutable-gate
rejection outcomes are both retained so the daily history is auditable; only a
successful outcome may claim that a current forecast snapshot was published.

These JSON records contain bounded provenance, metrics, hashes, and ResilientDB
record identifiers emitted by `scripts.milestone9.run_forward_completion`.
Raw provider observations, feature datasets, model artifacts, encryption keys,
and forecasts remain in ResilientDB and must not be committed here.
