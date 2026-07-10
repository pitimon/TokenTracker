#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

command -v codex >/dev/null 2>&1 || { echo "codex CLI is required for independent verification." >&2; exit 1; }

REPORT="${OPENWIKI_VERIFY_REPORT:-$ROOT/openwiki-verify-report.md}"
PARALLEL="${OPENWIKI_VERIFY_PARALLEL:-2}"
PAGES=("$@")
if [[ ${#PAGES[@]} -eq 0 ]]; then
  while IFS= read -r page; do PAGES+=("$page"); done < <(find openwiki -type f -name '*.md' | sort)
fi
[[ ${#PAGES[@]} -gt 0 ]] || { echo "No OpenWiki pages found." >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

verify_page() {
  local page="$1" output="$2"
  local prompt
  prompt="Fact-check exactly one generated TokenTracker OpenWiki page against repository source. Read-only only: do not edit, create, or delete files. PAGE: $page. Source of truth: src/cli.js (commands), src/commands/ (options/behavior), src/lib/local-api.js (local routes), src/lib/rollout.js (parsers), dashboard/src/App.jsx (routes), TokenTrackerBar/ and TokenTrackerWin/ (native boundaries), CLAUDE.md (repository workflow). Also read openwiki-facts/source-facts.json before checking exact facts. Treat only contradictions as errors. Ignore style. Output exactly STATUS: CLEAN, or STATUS: ERRORS followed by one bullet per confirmed error with source path:line evidence."
  if ! codex exec -s read-only --ephemeral -C "$ROOT" -o "$output" "$prompt" </dev/null >/dev/null 2>"$output.err"; then
    {
      echo "STATUS: ERRORS"
      echo "- verifier failed"
      tail -n 20 "$output.err" | sed 's/^/  > /'
    } > "$output"
  fi
  grep -qE '^STATUS: (CLEAN|ERRORS)$' "$output" 2>/dev/null || {
    printf 'STATUS: ERRORS\n- verifier produced no status line\n' > "$output"
  }
}

: > "$REPORT"
printf '# OpenWiki independent verification\n\n' >> "$REPORT"
errors=0
active=0
for index in "${!PAGES[@]}"; do
  verify_page "${PAGES[$index]}" "$TMP/$index.out" &
  active=$((active + 1))
  if [[ $active -ge $PARALLEL ]]; then wait; active=0; fi
done
wait

for index in "${!PAGES[@]}"; do
  page="${PAGES[$index]}"
  {
    printf '## %s\n\n' "$page"
    cat "$TMP/$index.out"
    printf '\n'
  } >> "$REPORT"
  if grep -q '^STATUS: ERRORS$' "$TMP/$index.out"; then errors=$((errors + 1)); fi
done

echo "OpenWiki independent verification: $(( ${#PAGES[@]} - errors )) clean, $errors with errors -> $REPORT" >&2
[[ $errors -eq 0 ]]
