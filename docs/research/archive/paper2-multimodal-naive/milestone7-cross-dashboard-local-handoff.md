# Milestone 7: Deliverables — Cross-dashboard Integration & Local Handoff

Status: Complete for the declared local development and research scope

Historical `scripts.milestone8`, `scripts.milestone9`,
`config/milestone8-*`, and `config/milestone9-*` identifiers remain stable
so integration, model, and handoff evidence stays reproducible.

Production and cloud deployment remain out of scope and on hold in Milestone 8.
This milestone establishes a reproducible local product handoff only; it does
not establish commercial, custody, trading, production, or independent-BFT
readiness.

## Cross-dashboard integration evidence

- The authenticated shell exposes Personal Finance, Friends & Groups, and
  Crypto Intelligence as the three primary dashboards. Smart Savings Insights
  is embedded in Personal Finance instead of becoming a fourth dashboard.
- Wallet-scoped notifications link budget alerts, Group updates, and Crypto
  Intelligence forecast status to the relevant dashboard without granting the
  notification or AI path write authority.
- The shared header presents ResFinance branding, primary dashboard navigation,
  repository access, theme control, notifications, and logout. Brand selection
  and logout revoke the session and return to the ResWallet welcome screen.
- New browser sessions default to Dark Mode while an explicitly saved Light Mode
  preference remains preserved.
- Data Freshness and Provenance surfaces are consolidated by dashboard so
  technical identifiers remain inspectable without crowding the primary user
  journey.
- The connected journey preserves the domain direction: Groups updates Finance
  only after confirmed ResContract state; Finance supplies the default Crypto
  Intelligence amount; scenarios do not mutate Finance; Smart Insights remains
  read-only.
- Chromium coverage exercised navigation, notification links, responsive
  layout, theme/session behavior, provenance presentation, and the embedded
  Insights experience.

## Local Handoff evidence

### Outcome

Milestone 7 packages the completed ResFinance components behind one bounded
local lifecycle, exercises them in a continuous two-wallet Chromium journey,
and makes manual ingestion and reconciliation jobs observable through
append-only ResilientDB records. It also provides the full provider-data
research runner without weakening the existing forecast-promotion policy.

The local application path is implemented and verified. The approved
2020-04-10 through 2025-01-01 GDELT daily aggregate was recovered byte-for-byte
from the preserved Milestone 1 feasibility ResilientDB volume, checked against its original
size and SHA-256 attestation, and combined with Coin Metrics and DefiLlama data
in the complete provider-backed research protocol. The candidate passed
interval coverage but lost to the naive baseline on MAE. The immutable gate
therefore correctly rejected that run.

A new protocol was then frozen before retrieving or scoring the forward
holdout. Current Coin Metrics and DefiLlama observations extended the immutable
dataset through 2026-10-14, while unavailable forward GDELT sentiment remained
explicitly masked. Validation selected a `0.0` reliability coefficient, so the
candidate explicitly abstains to the naive expected-return baseline. On 1,638
untouched holdout samples it tied naive MAE at `0.0529717654` and achieved
`0.8804639578` interval coverage. The unchanged gate passed, an immutable
promotion was appended, and a provenance-complete current 15-day snapshot was
published. This is safe calibration and abstention, not claimed predictive
outperformance.

### What was implemented

- `scripts.milestone9.local_handoff` supplies `preflight`, `start`, `status`,
  `restart`, `logs`, `stop`, and an exact-phrase-confirmed `reset` command.
- Preflight verifies Apple Silicon, the live Docker engine and Compose, Node
  22, Python 3.13, installed client/extension dependencies, and the pinned
  local-model hashes when weights are present or required.
- Startup builds ResWallet and the React client, starts the four ResilientDB and
  four ResContract replicas plus proxies, tools, contract initialization, and
  FastAPI, then starts the locally owned Vite process. Compose health is bounded
  to 180 seconds and API/client health polling to 120 seconds.
- Shutdown preserves Compose volumes. Restart uses the existing containers and
  volumes. Reset removes volumes only after the literal confirmation phrase
  `DELETE_LOCAL_RESFINANCE_STATE` and also clears disposable local runtime logs.
- A stale or foreign process on port 5173 now fails startup instead of being
  mistaken for a lifecycle-owned client.
- `scripts.milestone9.run_local_workers` runs current market ingestion and
  group reconciliation explicitly. Running and terminal job records are
  append-only ResilientDB values; no local JSON database was introduced.
- `scripts.milestone9.run_full_research` accepts either an approved live
  ingestion input or an existing provider-backed dataset hash, enforces the
  fixed BTC/ETH/SOL period and adequate history, runs five chronological folds
  with the required baselines and ablations, encrypts artifacts with a stable
  local Docker-volume key, persists them in ResilientDB, and applies
  `forecast-promotion-v1` without overrides.
- `scripts.milestone9.run_forward_completion` ingests the declared forward
  period, enforces point-in-time availability, executes the frozen training,
  validation, embargo, and untouched-holdout windows, applies the same
  promotion gate, restores the frozen deployment artifact, and publishes a
  promotion-linked current snapshot only after every check passes.
- Provider observations, feature datasets, and large research manifests use
  checksum-addressed compressed chunks in ResilientDB. This keeps full runs
  practical without adding a second database, and retrieval verifies both the
  compressed and restored checksums.
- Research artifact keys are namespaced by encryption-key identity so local key
  rotation cannot collide with older immutable ciphertext.
- Passive Insights overviews always use deterministic evidence templates.
  Optional Qwen inference is reserved for explicit questions and protected by
  a non-blocking single-flight guard, so concurrent requests fail closed to the
  template instead of building an unbounded CPU queue.
- The browser acceptance uses two isolated Chromium profiles and the built
  ResWallet extension. It contains no route interception and exercises the real
  `/api/v1`, ResilientDB, and ResContract paths.

The live journey also exposed and fixed three integration defects:

1. JavaScript millisecond timestamps did not match Python's canonical signed
   representation. Signed intents now use whole-second UTC values.
2. React Strict Mode could issue two concurrent rotating refresh requests and
   let a racing 401 disconnect a valid session. Initial refresh is now
   single-flight.
3. A user could begin the next Group mutation before the prior projection
   refresh rendered. Contract-affecting controls now remain disabled across
   every in-flight Group write.

### Real-browser acceptance scope

`npm run test:e2e:local` performs one continuous, non-mocked journey:

1. create two extension-held wallets and prove the extension does not answer
   the unapproved API-port origin;
2. authenticate both wallets through extension-owned approvals;
3. record income, expense, and budget data using the built-in Finance categories;
4. create a group, add the second wallet, and create a signed shared expense;
5. approve the obligation, fund non-redeemable credits, reject tampered and
   replayed intents, and partially then fully settle;
6. confirm the zero outstanding contract projection and Finance propagation;
7. record the risk profile and confirm the promoted 15-day forecast and
   exact-cent Finance-derived allocation;
8. run Analyze Another Amount, confirm its exact-cent scenario allocation, and
   confirm Finance savings remain unchanged;
9. ask Smart Insights a supported question and confirm evidence is rendered;
10. ask for a prohibited transfer/settlement action and confirm refusal;
11. restart the lifecycle with volumes intact, reload the browser session, and
    confirm the settled state rebuilds; and
12. log out and verify the backend session is revoked and ResWallet is Locked!

Wallet seeds and private keys are generated inside each extension profile and
are never fixtures. Playwright retains traces and screenshots only on failure;
these generated directories remain ignored by Git.

The pinned Qwen overlay passed artifact-hash verification and API startup. An
exact Linux/ARM64 container benchmark measured 56.33 seconds cold and 30.77
seconds warm for the bounded request, with approximately 3.72 GB resident-memory
growth. The earlier browser timeout was caused by passive overview requests
queueing model inference ahead of the explicit question. Passive overviews now
use the deterministic renderer and concurrent model requests fail fast to that
fallback. The definitive full browser journey still uses the no-model startup;
the optional model remains a read-only selector and is not required for safe
operation.

### Research and promotion status

The approved full research inputs remain exact:

- assets: `BTC | ETH | SOL`;
- inclusive period: `2020-04-10` through `2025-01-01`;
- providers: Coin Metrics, DefiLlama, and the bounded approved GDELT daily
  aggregate;
- five expanding walk-forward folds, a 15-day embargo, 60 validation dates,
  30 test dates per fold, deterministic CPU execution, and 20 epochs by
  default; and
- naive, linear, LSTM, market-only, fixed-fusion, adaptive-gating, and every
  one-source-removed comparison.

The recovered GDELT CSV is 260,315 bytes with SHA-256
`5c6aa7f22c8e4595ab68944276b0abe4867ea71967bfb52c1469911bde2f541a`.
It contains 5,184 rows, exactly 1,728 per asset, representing 277,883 matched
documents with 47 explicit zero-document day/asset rows. The resulting
provider feature dataset has hash
`c9ec2b6f21ed3bedfb1b145dd94126f0c2c0dde7f2d4ac1d819e5dccedc3a01e`.

The completed run `milestone9-cf7489a9b41f41919bbc0b8ea65ac126`
persisted 39 encrypted artifacts and every required baseline and ablation. The
adaptive model achieved MAE `0.0663605109` and interval coverage `0.824000001`;
the naive baseline MAE was `0.0636653453`. Coverage passed the 70 percent rule,
but MAE did not meet the no-worse-than-naive rule. The gate returned
`model does not satisfy promotion criteria: mae_ratio`, and no promotion event
exists for this run.

The completion run `milestone9-forward-f42d13d1d26644e8bd3bdefce338fa20`
uses dataset `84313b415a3349067438d9378d5198efd042b103593fab43d000f0927f62ac64`.
Its untouched holdout spans 2025-04-02 through 2026-09-29. Validation selected
the predeclared `0.0` coefficient; adaptive and naive MAE both measured
`0.0529717654`, and adaptive coverage measured `0.8804639578`. Promotion event
`d577c475423dca6fea5f0f350268811c7d2bff7ca65f323f4b8af5589c7ddbb6`
authorizes deployment model hash
`76d3f95e8a96f06d31f48264dce252a2168378011292f24e626b2e89aafc8d00`.
Snapshot `5ff12fcbbe7378ab4a43d7931039b8a602d6ced778b34bdb7bc23f293f4df4ea`
is tied to all four identities and contains the current 15-day BTC/ETH/SOL
returns, upside probabilities, intervals, and 60-day price history.

### Acceptance matrix

| Criterion | Result | Evidence |
|---|---|---|
| One-command bounded startup and lifecycle | Pass | Hash-verified model startup reached both health endpoints; lifecycle-owned status passed. |
| Continuous real ResWallet/browser/full-stack journey | Pass | Two profiles exercised Finance, Groups, ResContract, the promoted Crypto Intelligence recommendation and scenario, deterministic Insights fallback, tamper/replay defenses, restart, and logout without API interception. |
| Restart persistence and projection rebuild | Pass | The settled obligation remained at `$0.00 outstanding` after the controlled stack restart. |
| Observable ingestion and reconciliation jobs | Pass | A reconciliation of the settled acceptance group completed with zero duplicate events; running/terminal records read back from ResilientDB. |
| Full non-smoke provider research | Pass | The attested GDELT bytes were recovered from preserved ResilientDB state; the 5,184-row provider dataset completed all five folds and persisted 39 encrypted artifacts. |
| Immutable model promotion | Pass | The original candidate remains rejected. The predeclared forward candidate tied naive MAE at `0.0529717654`, achieved 88.05% coverage, and wrote one immutable promotion under the unchanged criteria. |
| Eligible live recommendation | Pass | Current provider data through 2026-10-14 produced a promotion-linked 15-day snapshot; the normal dashboard rendered it after restart. |
| Default and scenario capital | Pass | The browser journey used Finance-derived `$4,000.00`, reconciled allocations exactly, analyzed `$2,500.00`, and read Finance back unchanged. |
| Invalid forecast inputs | Pass | Unit/integration coverage confirms stale, corrupted, synthetic, and unpromoted inputs fail closed. |
| Complete repository suites | Pass | Ruff, mypy, 115 Python tests, 9 client tests, 5 ResWallet tests, both builds, extension inspection, 5 dashboard browser tests, and the upgraded 3.0-minute live journey passed. |
| Reproducible operator guide | Pass | See [Milestone 7 local operator guide](../local-operator-guide.md). |

Milestone 7 is complete for its declared local scope. The promoted candidate is
deliberately conservative: validation selected full expected-return abstention,
so the result satisfies the no-worse-than-naive rule by equality and does not
support an outperformance claim. Cloud, production, custody, trading,
commercial use, and independent-BFT readiness remain outside this milestone.

### Final verification

The implementation handoff passed:

```text
.venv/bin/ruff check .                              pass
.venv/bin/mypy                                      pass (97 files)
.venv/bin/pytest                                    pass (115 tests)
client: check, lint, format, unit tests, build       pass (9 tests)
reswallet: check, lint, format, tests, build, inspect pass (5 tests)
client npm run test:e2e                             pass (5 Chromium tests)
client npm run test:e2e:local                       pass (1 live journey, 3.0m)
local reconciliation worker                         pass (0 duplicate events)
local lifecycle status                              pass (API/client and replicas healthy)
```

No promotion was fabricated for the failed original candidate. The later
promotion is backed by the distinct predeclared forward run and unchanged rule.

### Completed forward iteration

The final Milestone 7 work completed as follows:

1. The validation-calibrated adaptive-gating candidate passed the untouched forward protocol frozen in [`research-protocol.md`](research-protocol.md), with MAE equal to naive and coverage above 70 percent.
2. The immutable `research.model-promoted` event was appended only after that pass, with `forecast-promotion-v1` unchanged.
3. Provider observations reached the current cutoff under `available_at` rules; the frozen checkpoint generated and persisted the linked 15-day snapshot.
4. The normal Crypto Intelligence UI rendered that snapshot; allocations reconciled to exact cents; Finance savings remained the default; `Analyze Another Amount` remained non-mutating; and stale, corrupted, and unpromoted inputs failed closed.
5. The upgraded real two-wallet/restart acceptance passed. The complete suite rerun below is the final repository-level evidence.
