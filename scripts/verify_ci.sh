#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"

if [ ! -x .venv/bin/python ]; then
  echo "Missing .venv. Install the pinned Python dependencies before pushing." >&2
  exit 1
fi
if [ ! -d client/node_modules ] || [ ! -d reswallet/node_modules ]; then
  echo "Missing client or ResWallet dependencies. Run npm ci in both directories." >&2
  exit 1
fi

echo "[verify-ci] backend lint, types, tests, generated API, and Compose"
.venv/bin/ruff check .
.venv/bin/mypy
.venv/bin/pytest
.venv/bin/python -m scripts.generate_openapi
git diff --exit-code -- openapi/openapi.json
docker compose config --quiet

echo "[verify-ci] client generated types, static checks, tests, build, and browser acceptance"
(
  cd client
  npm run generate:api
  git diff --exit-code -- src/lib/api/generated/schema.d.ts
  npm run check
  npm run lint
  npm run format:check
  npm test
  npm run build
  CI=1 npm run test:e2e
)

echo "[verify-ci] ResWallet static checks, tests, build, and security inspection"
(
  cd reswallet
  npm run check
  npm run lint
  npm run format:check
  npm test
  npm run build
  npm run security:inspect
)

echo "[verify-ci] all checks passed"
