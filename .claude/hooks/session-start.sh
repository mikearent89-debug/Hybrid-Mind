#!/usr/bin/env bash
# Prepares a fresh cloud session so lint, typecheck, test and build work without manual setup.
set -euo pipefail
cd "$CLAUDE_PROJECT_DIR"

if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || npm install -g pnpm@10 >/dev/null 2>&1
fi

pnpm install --frozen-lockfile
pnpm turbo run build --filter=@hybrid/memory-contract

if command -v uv >/dev/null 2>&1; then
  (cd apps/memory-worker && uv sync --frozen) || echo "uv sync failed; the Python worker tests will not run"
fi
