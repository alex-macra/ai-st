#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> root: installing browser-test dependencies"
npm ci

echo "==> api: installing node deps"
(cd api && npm ci)

echo "==> api: ensuring .env"
if [ ! -f api/.env ]; then
  cp api/.env.example api/.env
  echo "    created api/.env from example - no model key is needed to start"
  echo "    set OPENAI_API_KEY for a real model or SOMNOSCRIBE_DEMO_MODE=true for offline analysis"
fi

echo "==> frontend: installing node deps"
(cd frontend && npm ci)

echo "==> preprocessor: creating venv"
if [ ! -d preprocessor/.venv ]; then
  python3 -m venv preprocessor/.venv
fi

echo "==> preprocessor: installing python deps"
preprocessor/.venv/bin/pip install --quiet --upgrade pip
preprocessor/.venv/bin/pip install --quiet -r preprocessor/requirements.txt

echo "==> done"
