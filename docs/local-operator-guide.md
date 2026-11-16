# Local operator guide

This guide covers the active local ResFinance workflow. It does not describe
the retired Paper 2 research pipeline.

## Local lifecycle

Use the bounded local handoff commands:

```bash
.venv/bin/python -m scripts.milestone9.local_handoff preflight
.venv/bin/python -m scripts.milestone9.local_handoff start
.venv/bin/python -m scripts.milestone9.local_handoff status
.venv/bin/python -m scripts.milestone9.local_handoff logs --tail 200
.venv/bin/python -m scripts.milestone9.local_handoff stop
```

The reset command is destructive and requires its documented literal
confirmation phrase. Do not use it for ordinary restarts.

## Crypto Intelligence market refresh

The active research path is a market-price-only, seven-day MSPCIFormer
experiment comparing the original clean-room implementation with VASA scale
aggregation. The validation-selected checkpoint is used for inference only.

The daily GitHub Actions workflow retains
`.github/workflows/crypto-intelligence-forward-completion.yml` as its stable
compatibility name. It runs on the dedicated local runner at 6:00 AM fixed PST
and ingests the prior completed UTC market day. A manual equivalent is:

```bash
.venv/bin/python -m scripts.milestone9.run_forward_completion \
  --current-cutoff-date YYYY-MM-DD \
  --output /private/tmp/crypto-market-refresh.json
```

The date must be no later than yesterday in UTC. The command stores immutable
Coin Metrics BTC/ETH/SOL observations in ResilientDB and writes only a bounded
market-refresh receipt to its output file. It does not retrain a model or alter
Finance, risk profiles, or allocations.

If the dashboard reports stale market data, first check the dated workflow
receipt, the local runner, Docker, and the Coin Metrics provider response. A
fresh completed market day becomes available to the forecast API on its next
inference request.

## Daily runner and catch-up

The scheduled workflow requires the self-hosted `resfinance-research` runner,
the `RESFINANCE_AUTOMATION_VENV` Actions variable, local Docker services, and
permission for GitHub Actions to commit its bounded receipt on `main`.

The optional macOS catch-up dispatcher only dispatches the existing workflow
after a missed fixed-PST run. It does not run research itself. Configure it
with:

```bash
gh auth login --hostname github.com --web --scopes "repo,workflow"
.venv/bin/python -m scripts.milestone9.install_daily_forward_catchup
```

Historical research evidence and old operating material are preserved under
[`research/archive/paper2-multimodal-naive/`](research/archive/paper2-multimodal-naive/)
and are not part of the active product workflow.
