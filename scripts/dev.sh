#!/usr/bin/env bash
# Copyright 2026 Alex Macra
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Bootstrap if anything's missing
need_setup=0
[ -d api/node_modules ] || need_setup=1
[ -d frontend/node_modules ] || need_setup=1
[ -x preprocessor/.venv/bin/uvicorn ] || need_setup=1
[ -f api/.env ] || need_setup=1
if [ "$need_setup" -eq 1 ]; then
  echo "==> running setup (missing deps or .env)"
  bash "$ROOT/scripts/setup.sh"
fi

mkdir -p .logs
pids=()
cleanup() {
  echo
  echo "==> stopping services"
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

echo "==> starting preprocessor on :8001 (logs: .logs/preprocessor.log)"
(cd preprocessor && ../preprocessor/.venv/bin/uvicorn main:app --reload --host 127.0.0.1 --port 8001) \
  > .logs/preprocessor.log 2>&1 &
pids+=($!)

echo "==> starting api on :3001 (logs: .logs/api.log)"
(cd api && npm run dev) > .logs/api.log 2>&1 &
pids+=($!)

echo "==> starting frontend on :5173 (logs: .logs/frontend.log)"
(cd frontend && npm run dev) > .logs/frontend.log 2>&1 &
pids+=($!)

echo "==> all started. Ctrl-C to stop. tail -f .logs/*.log to watch."
wait
