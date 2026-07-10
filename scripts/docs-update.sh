#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OPENWIKI_VERSION="${OPENWIKI_VERSION:-0.1.0}"
OPENWIKI_BACKEND="${OPENWIKI_BACKEND:-zai}"

case "$OPENWIKI_BACKEND" in
  zai)
    : "${ZAI_API_KEY:?ZAI_API_KEY is required for OPENWIKI_BACKEND=zai}"
    export OPENWIKI_PROVIDER="anthropic"
    export ANTHROPIC_API_KEY="$ZAI_API_KEY"
    export ANTHROPIC_BASE_URL="${ANTHROPIC_BASE_URL:-https://api.z.ai/api/anthropic}"
    export OPENWIKI_MODEL_ID="${OPENWIKI_MODEL_ID:-glm-4.7}"
    ;;
  openrouter)
    : "${OPENROUTER_API_KEY:?OPENROUTER_API_KEY is required for OPENWIKI_BACKEND=openrouter}"
    export OPENWIKI_PROVIDER="openrouter"
    export OPENWIKI_MODEL_ID="${OPENWIKI_MODEL_ID:-z-ai/glm-5.2}"
    ;;
  anthropic)
    : "${ANTHROPIC_API_KEY:?ANTHROPIC_API_KEY is required for OPENWIKI_BACKEND=anthropic}"
    export OPENWIKI_PROVIDER="anthropic"
    export OPENWIKI_MODEL_ID="${OPENWIKI_MODEL_ID:-claude-sonnet-5}"
    ;;
  *)
    echo "Unsupported OPENWIKI_BACKEND='$OPENWIKI_BACKEND' (use zai, openrouter, or anthropic)." >&2
    exit 1
    ;;
esac

node scripts/openwiki-extract-facts.cjs

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

snapshot_file() {
  local source="$1" name="$2"
  if [[ -f "$source" ]]; then
    cp "$source" "$TMP/$name"
    printf 'present' > "$TMP/$name.state"
  else
    printf 'absent' > "$TMP/$name.state"
  fi
}

restore_file() {
  local target="$1" name="$2"
  if [[ "$(cat "$TMP/$name.state")" == 'present' ]]; then
    cp "$TMP/$name" "$target"
  else
    rm -f "$target"
  fi
}

cleanup() {
  local status=$?
  set +e
  restore_file AGENTS.md agents
  restore_file CLAUDE.md claude
  restore_file .github/workflows/openwiki-update.yml workflow
  rm -rf "$TMP"
  exit "$status"
}

# OpenWiki code mode unconditionally creates a scheduled GitHub workflow and appends
# an AGENTS.md section. TokenTracker keeps those decisions under repository control.
snapshot_file AGENTS.md agents
snapshot_file CLAUDE.md claude
snapshot_file .github/workflows/openwiki-update.yml workflow
trap cleanup EXIT

if [[ -d openwiki ]]; then
  MODE=--update
else
  MODE=--init
fi

PROMPT="Generate or update concise English-only code documentation for TokenTracker. Write only under /openwiki. Read /openwiki-facts/source-facts.json before stating exact commands, endpoints, dashboard routes, or parser names. Cover local-first data flow, CLI and service operations, parser/sync boundaries, local API, dashboard routes, native app boundaries, testing, and release workflow. Prefer source-file links and short change guidance. Do not invent command options, response JSON, environment variables, storage paths, defaults, provider behavior, counts, or implementation details that you have not read directly. Do not read or document secrets, credentials, .env files, dashboard/dist, node_modules, or generated native build output. Do not create CI workflows and do not modify project instructions outside /openwiki."

echo ">> OpenWiki backend=$OPENWIKI_BACKEND provider=$OPENWIKI_PROVIDER model=$OPENWIKI_MODEL_ID version=$OPENWIKI_VERSION" >&2
npx --yes "openwiki@$OPENWIKI_VERSION" code "$MODE" --print --modelId "$OPENWIKI_MODEL_ID" "$PROMPT"

node scripts/openwiki-check-facts.cjs
