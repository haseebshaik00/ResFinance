# Local Operator Guide

> Compatibility note: the executable commands retain their historical
> `scripts.milestone9` module names so existing local operations remain stable.

This guide runs the complete ResFinance application locally on the validated
Apple Silicon development architecture. Cloud and production deployment remain
on hold.

For presenting the product to an audience—demo data, talk track, timing, and
demo-safe recovery—use the
[`Local Demo Runbook`](local-demo-runbook.md). Keep install, verification,
lifecycle, and research commands here as the source of truth.

## Prerequisites and resource expectations

- macOS on `arm64` with Docker Desktop running. The validated engine is
  29.8.2 with Compose 5.5.1.
- Python 3.13.2 in `.venv`, Node 22.14.0, and npm dependencies installed with
  `npm ci` in both `client/` and `reswallet/`.
- The source-pinned `resfinance/resilientdb:4de5cb4-m0` image described in the
  Milestone 1 feasibility documentation.
- Chromium installed for Playwright when running browser acceptance.
- Optional pinned Qwen weights at an operator-selected path outside Git.

On the acceptance host, the Qwen snapshot occupies 2.9 GB. Active Docker
images, containers, and volumes occupied about 14.2 GB; rebuild cache could add
about 18 GB. Keep roughly 35 GB free for a comfortable clean rebuild. The local
model benchmark measured approximately 3.12 GB of resident-memory growth, so a
16 GB host is the practical operator target, not a formally established hard
minimum. Cached startup took about 24 seconds in the final implementation run;
first builds depend on Docker cache and host performance.

## Install once

```bash
.venv/bin/python -m pip install \
  -r requirements/requirements-dev.txt \
  -r requirements/requirements-milestone0.txt \
  -r requirements/requirements-api.txt \
  -r requirements/requirements-ml.txt \
  -r requirements/requirements-portfolio.txt \
  -r requirements/requirements-ai.txt

(cd client && npm ci && npx playwright install chromium)
(cd reswallet && npm ci)
```

Startup never downloads dependencies, model weights, or provider data.

## Local verification

Install the pinned dependency sets, then run the repository checks:

```bash
.venv/bin/python -m pip install \
  -r requirements/requirements-dev.txt \
  -r requirements/requirements-milestone0.txt \
  -r requirements/requirements-api.txt \
  -r requirements/requirements-ml.txt \
  -r requirements/requirements-portfolio.txt \
  -r requirements/requirements-ai.txt
.venv/bin/ruff check .
.venv/bin/mypy
.venv/bin/pytest

(cd client && npm ci && npm run generate:api && npm run check && npm run lint && npm run format:check && npm test && npm run build)
(cd reswallet && npm ci && npm run check && npm run lint && npm run format:check && npm test && npm run build && npm run security:inspect)
```

To run the full CI-equivalent sequence, including Chromium acceptance, use:

```bash
./scripts/verify_ci.sh
```

Enable it automatically before each push with
`git config core.hooksPath .githooks`.

## Preflight and start

Use deterministic evidence templates without mounting a local language model:

```bash
.venv/bin/python -m scripts.milestone9.local_handoff preflight
.venv/bin/python -m scripts.milestone9.local_handoff start
```

Or verify and mount the pinned model read-only:

```bash
.venv/bin/python -m scripts.milestone9.local_handoff \
  --model-dir /private/tmp/resfinance-qwen2.5-1.5b \
  --require-model preflight
.venv/bin/python -m scripts.milestone9.local_handoff \
  --model-dir /private/tmp/resfinance-qwen2.5-1.5b \
  --require-model start
```

Open `http://127.0.0.1:5173`. Load `reswallet/dist` as an unpacked Chromium
extension if operating manually. Use a separate browser profile for each group
participant; create each wallet inside that profile and never export its seed.

## Lifecycle

Global options such as `--model-dir` precede the subcommand.

```bash
.venv/bin/python -m scripts.milestone9.local_handoff status
.venv/bin/python -m scripts.milestone9.local_handoff logs --tail 100
.venv/bin/python -m scripts.milestone9.local_handoff restart
.venv/bin/python -m scripts.milestone9.local_handoff stop
```

`stop` and `restart` preserve ResilientDB and ResContract volumes. Reset is
destructive and intentionally requires the exact phrase:

```bash
.venv/bin/python -m scripts.milestone9.local_handoff reset \
  --confirm DELETE_LOCAL_RESFINANCE_STATE
```

## Browser acceptance

Start the stack first, then run:

```bash
cd client
npm run test:e2e:local
```

The test creates disposable browser profiles under the operating system's
temporary directory. It uses the real extension, API, four-replica stores, and
contract; no request routing is mocked. Local model inference is allowed up to
120 seconds per Insights request, while the whole journey remains bounded to
10 minutes. The definitive Milestone 7 acceptance uses the no-model startup so
Smart Insights follows its deterministic evidence-template path; model hashes
and model-overlay startup are verified separately.

## Local jobs

Jobs are manually triggered in V1; no hidden scheduler is started. Current
market ingestion uses the existing provider adapters. Reconciliation reads
authoritative ResContract state and appends only missing confirmation events.

```bash
.venv/bin/python -m scripts.milestone9.run_local_workers ingest-current
.venv/bin/python -m scripts.milestone9.run_local_workers \
  reconcile --group-id group-REPLACE_ME
.venv/bin/python -m scripts.milestone9.run_local_workers status
```

Running, completed, and failed job records are stored in ResilientDB under the
`job:local:` prefix. Provider failures append failed status without deleting
accepted observations.

## Full research attempt

The full runner requires either an approved GDELT CSV for fresh ingestion or a
known provider-backed feature-dataset hash already in ResilientDB. By default,
it reads the stable 32-byte research key from `/certs/research-blob.key` inside
the local API container. The key is generated once in the private certificate
volume, is never printed, and keeps encrypted artifacts readable after a
restart. An explicit environment override remains available for controlled
key-migration tests.

```bash
.venv/bin/python -m scripts.milestone9.run_full_research \
  --ingest \
  --gdelt-csv /absolute/path/to/approved-gdelt-daily.csv \
  --output /private/tmp/milestone9-full-research.json
```

To reuse a provider-backed feature dataset:

```bash
.venv/bin/python -m scripts.milestone9.run_full_research \
  --dataset-hash c9ec2b6f21ed3bedfb1b145dd94126f0c2c0dde7f2d4ac1d819e5dccedc3a01e \
  --output /private/tmp/milestone9-full-research.json
```

Exit status 0 means the evaluated adaptive candidate passed and an immutable
model-promotion event was appended. Exit status 2 means the run completed but
the candidate failed safely. Neither status alone publishes a current-cutoff
forecast; use the separately frozen completion runner below for that workflow.

The recorded provider-backed run exits 2: adaptive MAE `0.0663605109` was
worse than naive MAE `0.0636653453`, although its 82.4% interval coverage
passed. Do not change the criteria or reuse the held-out test result for model
selection merely to obtain exit 0.

## Untouched-forward completion and current snapshot

This command is the supported path that extends the provider period, executes
the predeclared untouched-forward protocol, promotes a qualifying candidate,
freezes its deployment artifacts, and publishes a current 15-day snapshot.
Choose the last complete provider date explicitly; do not move the frozen
training, validation, or holdout boundaries after inspecting results.

```bash
.venv/bin/python -m scripts.milestone9.run_forward_completion \
  --current-cutoff-date 2026-10-14 \
  --output /private/tmp/milestone9-forward-completion.json
```

The accepted local run used provider observations through 2026-10-14. Its
validation window selected coefficient `0.0`, an explicit abstention to the
naive expected-return forecast. On the untouched 2025-04-02 through 2026-09-29
holdout, adaptive and naive MAE both measured `0.0529717654`; adaptive interval
coverage was `0.8804639578`. Equality satisfies the unchanged no-worse-than-
naive rule, but it is not predictive outperformance. The immutable promotion
and snapshot remain research-only and do not execute trades.

## Daily Crypto Intelligence forward completion

The merge-ready workflow
`.github/workflows/crypto-intelligence-forward-completion.yml` runs at 6:00 AM
fixed PST (`Etc/GMT+8`, UTC-08:00 year-round). GitHub schedules only workflows
present on the default branch, so it remains inactive until merged into
`main`. A manual `workflow_dispatch` is also available from `main`.

The job intentionally uses a dedicated local runner rather than an ephemeral
GitHub-hosted runner. Forward completion depends on the locally persisted
ResilientDB volumes, the `resfinance-resdb-tools` container, and the research
encryption key mounted in `resfinance-api-1`.

### One-time GitHub and runner setup

1. In **Settings → Actions → Runners**, add a repository-level self-hosted
   macOS ARM64 runner on the ResFinance host. Add the custom label
   `resfinance-research`, and install the runner as a service so it can accept
   the 6:00 AM job without an interactive terminal.
2. Keep this runner dedicated to ResFinance. The repository is public and the
   runner can reach local Docker state and research key material; never route
   pull-request jobs or another repository to this label.
3. Create an Actions repository variable named
   `RESFINANCE_AUTOMATION_VENV` whose value is the absolute path to a prepared
   Python 3.13 virtual environment. Install the exact dependency sets into it:

   ```bash
   python3.13 -m venv /absolute/path/to/resfinance-automation-venv
   /absolute/path/to/resfinance-automation-venv/bin/python -m pip install \
     -r requirements/requirements-dev.txt \
     -r requirements/requirements-milestone0.txt \
     -r requirements/requirements-api.txt \
     -r requirements/requirements-ml.txt \
     -r requirements/requirements-portfolio.txt \
     -r requirements/requirements-ai.txt
   ```

4. Start the local lifecycle and leave Docker Desktop, the runner service,
   `resfinance-resdb-tools`, and `resfinance-api-1` running:

   ```bash
   .venv/bin/python -m scripts.milestone9.local_handoff start
   ```

5. Ensure Actions may write repository contents and that the `main` branch
   policy permits `github-actions[bot]` to push the daily evidence commit. If
   direct bot pushes are prohibited, the scheduled job will fail closed at the
   push step until the policy is intentionally changed.
6. Merge the workflow to `main`, then use **Actions → Daily Crypto Intelligence
   Forward Completion → Run workflow** once to validate the complete runner,
   Docker, provider, ResilientDB, artifact-upload, commit, and push path.
   At job start, the workflow also detects an evidence file already committed
   for that fixed-PST date and exits successfully. This prevents a late GitHub
   schedule from repeating research after the local catch-up dispatcher has
   already completed the day.

7. Enable missed-run catch-up on the same macOS account. It retains GitHub
   Actions as the sole process that runs research and writes the evidence
   commit; the local launcher only dispatches the existing workflow after the
   fixed-PST due time when GitHub has no evidence or same-day workflow run.

   Authenticate the GitHub CLI once. Its credential is retained by the macOS
   Keychain; do not put a token in the repository, LaunchAgent plist, shell
   profile, or log.

   ```bash
   gh auth login --hostname github.com --web --scopes "repo,workflow"
   .venv/bin/python -m scripts.milestone9.install_daily_forward_catchup
   ```

   The installer creates the user LaunchAgent
   `com.resfinance.daily-forward-catchup`. It runs at login and every five
   minutes while the Mac is awake. Before 6:00 AM fixed PST it exits without
   contacting GitHub. After 6:00 AM, it checks `main` for that date's evidence
   file and for an existing workflow run before dispatching
   `crypto-intelligence-forward-completion.yml` on `main`.

   This makes a missed 6:00 AM run catch up after a later login or wake without
   duplicating a scheduled, manual, queued, running, completed, or
   evidence-producing run. It cannot run while the Mac remains powered off,
   offline, or unable to run the required Docker services; it catches up after
   the Mac is usable again. Inspect its logs at:

   ```text
   ~/Library/Logs/resfinance/daily-forward-catchup.log
   ~/Library/Logs/resfinance/daily-forward-catchup-error.log
   ```

### Daily output and failure behavior

At 6:00 AM PST the wrapper selects the previous PST calendar day as the latest
complete provider cutoff. A run on `2026-11-12` therefore executes the forward
completion with cutoff `2026-11-11` and writes:

```text
config/crypto-intelligence/milestone9-forward-completion-2026-11-12.json
```

The workflow uploads that JSON as a 90-day Actions artifact and commits it to
`main` with `chore(research): record forward completion YYYY-MM-DD`. It rebases
onto the latest `main` before pushing, and concurrency control prevents two
daily runs from overlapping.

Both eligible promotion and immutable-gate rejection evidence are committed so
the history stays auditable. A rejection is committed and uploaded, then the
workflow ends failed. An exit that produces no valid evidence fails before any
commit. Only an exit-zero record with
`live_forecast_snapshot_published: true` may claim a current snapshot.

Raw provider observations, feature datasets, encrypted model artifacts,
encryption keys, and forecast records remain in ResilientDB. Only the bounded
JSON evidence emitted by the checked-in forward-completion runner is committed.

## Troubleshooting

- `docker-engine: unavailable`: start Docker Desktop and rerun preflight.
- Architecture, Python, or Node failure: use the pinned versions; do not bypass
  the check with a different database or image.
- Model hash mismatch: remove the suspect snapshot and provision the exact
  locked revision outside startup. Do not edit the lock to fit local weights.
- Port 5173 ownership failure: stop the foreign process, then rerun `start`.
- Health timeout: run `logs --tail 200`; Compose identifies unhealthy services
  and the client log is `.resfinance-local/client.log`.
- ResWallet does not respond: confirm `reswallet/dist` is the loaded unpacked
  extension, use exactly `http://127.0.0.1:5173`, and unlock the wallet.
- Contract action fails with a version conflict: wait for the current Group
  projection to render before retrying; never reuse the signed intent.
- Research input error: verify the GDELT file is the approved bounded aggregate
  and retain its SHA-256/provenance. Synthetic fixtures cannot satisfy this
  gate.
- `GitHub CLI is not authenticated`: run the Keychain-backed `gh auth login`
  command in the daily catch-up setup above, then rerun the installer.
- Daily evidence is absent after a wake-up: inspect the catch-up logs, verify
  the runner service and Docker containers are running, and use the Actions
  run created by the dispatcher as the auditable failure record. Do not run the
  forward-completion Python module directly from the LaunchAgent.

Known limitations: local-only topology, personal non-commercial provider
scope, manual worker scheduling, no trade execution or exchange custody, no
fiat/native-crypto transfer, and a promoted candidate that currently abstains
to the naive expected-return baseline rather than demonstrating market
outperformance.
