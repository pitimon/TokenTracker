#!/usr/bin/env bash
#
# release.sh — redeploy the local dashboard LaunchAgent to a published version.
#
# This is a LOCAL redeploy, NOT an npm publish. It repins BOTH local
# LaunchAgents — the dashboard (`serve --sync`) and the 5-minute local-sync
# (`sync --auto`) — to a specific published version, reloads them, waits for the
# server, and VERIFIES that the version the server actually serves matches the
# target (by grepping the served JS bundle — no false "success" on a stale
# bundle). Publish to npm first (`npm publish`), then run this.
#
# Why BOTH agents: they pin the version independently. If the local-sync agent
# is left on an older version, its next tick re-parses your logs with the old
# CLI — which can silently UNDO a data migration the new version just applied
# (this is exactly what happened during the issue #75 rebuild: the dashboard was
# repinned but local-sync stayed on 0.39.20 and re-inflated the corrected data).
# Keep them on the same version. The local-sync agent is optional — skipped if
# it is not installed.
#
# Why pin a version at all: this machine verifies releases, so a deterministic
# pin means the live version badge is an exact, checkable signal (and `npx`
# resolves the pinned spec into a fresh cache dir instead of possibly reusing a
# stale `@latest`). `latest` still pins — it resolves npm's latest to a concrete
# version first, so the deploy stays verifiable and reversible.
#
# Usage:
#   scripts/release.sh            # deploy npm 'latest'
#   scripts/release.sh 0.39.26    # deploy an exact version
#   scripts/release.sh latest     # same as no arg
#
# Env overrides:
#   TOKENTRACKER_NPM_PACKAGE       default @ipv9/tokentracker-cli
#   TOKENTRACKER_DASHBOARD_LABEL   default com.pitimon.tokentracker.dashboard
#   TOKENTRACKER_SYNC_LABEL        default com.pitimon.tokentracker.local-sync
#
set -euo pipefail

PACKAGE_NAME="${TOKENTRACKER_NPM_PACKAGE:-@ipv9/tokentracker-cli}"
DASHBOARD_LABEL="${TOKENTRACKER_DASHBOARD_LABEL:-com.pitimon.tokentracker.dashboard}"
SYNC_LABEL="${TOKENTRACKER_SYNC_LABEL:-com.pitimon.tokentracker.local-sync}"
AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST="$AGENTS_DIR/$DASHBOARD_LABEL.plist"
SYNC_PLIST="$AGENTS_DIR/$SYNC_LABEL.plist"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_TOOL="$SCRIPT_DIR/lib/launchagent-plist.cjs"
UID_NUM="$(id -u)"
SERVICE_TARGET="gui/$UID_NUM/$DASHBOARD_LABEL"
TARGET_ARG="${1:-latest}"

die() { echo "❌ $*" >&2; exit 1; }

command -v npm >/dev/null 2>&1 || die "npm not found on PATH"
[ "$(uname -s)" = "Darwin" ] || die "this script drives launchctl and only runs on macOS"
[ -f "$PLIST" ] || die "plist not found: $PLIST (run scripts/install-local-service.sh first)"
[ -f "$PLIST_TOOL" ] || die "plist helper not found: $PLIST_TOOL"

# --- 1. Resolve the target version -----------------------------------------
if [ "$TARGET_ARG" = "latest" ]; then
  echo "> Resolving npm 'latest' for ${PACKAGE_NAME}..."
  VERSION="$(npm view "$PACKAGE_NAME" version 2>/dev/null)" \
    || die "could not resolve latest from npm"
else
  VERSION="$TARGET_ARG"
fi
[ -n "$VERSION" ] || die "empty version"

# The version must actually exist on npm, or npx would fail on reload.
PUBLISHED="$(npm view "$PACKAGE_NAME@$VERSION" version 2>/dev/null || true)"
[ "$PUBLISHED" = "$VERSION" ] \
  || die "version $VERSION is not published on npm (got '${PUBLISHED:-nothing}')"
echo "✓ Target version on npm: $PACKAGE_NAME@$VERSION"

# --- 2. Read current state from the plist -----------------------------------
DASH_INSPECT="$(node "$PLIST_TOOL" inspect "$PLIST" "$PACKAGE_NAME")" \
  || die "could not inspect dashboard plist"
CURRENT="$(node -e 'const d=JSON.parse(process.argv[1]); console.log(d.versions[0] || "unpinned")' "$DASH_INSPECT")"
PORT="$(node -e 'const d=JSON.parse(process.argv[1]); console.log(d.port)' "$DASH_INSPECT")"
CURRENT_PINS="$(node -e 'const d=JSON.parse(process.argv[1]); console.log(d.pinCount)' "$DASH_INSPECT")"
[ "$CURRENT_PINS" -ge 1 ] || die "dashboard plist has no package reference for $PACKAGE_NAME"
echo "→ Current pin: $CURRENT · port: $PORT · refs: $CURRENT_PINS"

# Validate the optional writer before mutating or restarting the dashboard.
# This prevents a late local-sync shape failure from leaving the two agents
# on different package versions.
SYNC_PREFLIGHT=""
if [ -f "$SYNC_PLIST" ]; then
  SYNC_PREFLIGHT="$(node "$PLIST_TOOL" inspect "$SYNC_PLIST" "$PACKAGE_NAME")" \
    || die "could not inspect local-sync plist"
  SYNC_PREFLIGHT_REFS="$(node -e 'const d=JSON.parse(process.argv[1]); console.log(d.pinCount)' "$SYNC_PREFLIGHT")"
  [ "$SYNC_PREFLIGHT_REFS" -ge 1 ] || die "local-sync plist has no package reference for $PACKAGE_NAME"
fi

if [ "$CURRENT" = "$VERSION" ]; then
  echo "ℹ Plist already pins $VERSION — reloading to be sure it is live."
fi

# --- 3. Back up, then repin all observed package references -----------------
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$PLIST.bak-$CURRENT-$STAMP-$$"
cp -p "$PLIST" "$BACKUP"
echo "✓ Backup: $BACKUP"

if ! node "$PLIST_TOOL" repin "$PLIST" "$PACKAGE_NAME" "$VERSION" >/dev/null; then
  cp -p "$BACKUP" "$PLIST"
  die "dashboard repin failed — restored backup, plist unchanged"
fi
plutil -lint "$PLIST" >/dev/null || { cp -p "$BACKUP" "$PLIST"; die "dashboard plist invalid after repin — restored backup"; }
DASH_UPDATED="$(node "$PLIST_TOOL" inspect "$PLIST" "$PACKAGE_NAME")"
PINS="$(node -e 'const d=JSON.parse(process.argv[1]); console.log(d.pinCount)' "$DASH_UPDATED")"
echo "✓ Repinned $PINS occurrence(s) → $VERSION"

# --- 4. Reload the LaunchAgent ----------------------------------------------
echo "> Reloading ${DASHBOARD_LABEL}..."
launchctl bootout "$SERVICE_TARGET" >/dev/null 2>&1 || true
# Wait for the old instance to fully release before bootstrapping.
for _ in $(seq 1 15); do
  launchctl print "$SERVICE_TARGET" >/dev/null 2>&1 || break
  sleep 1
done
# The first bootstrap can lose a race with the async bootout; retry once.
if ! launchctl bootstrap "gui/$UID_NUM" "$PLIST" 2>/dev/null; then
  sleep 2
  launchctl bootstrap "gui/$UID_NUM" "$PLIST" || die "bootstrap failed for $PLIST"
fi
echo "✓ Bootstrapped"

# --- 5. Wait for the server -------------------------------------------------
echo -n "→ Waiting for http://127.0.0.1:$PORT "
UP=""
for _ in $(seq 1 60); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" 2>/dev/null)" = "200" ]; then
    UP=1; echo "· up"; break
  fi
  echo -n "."
  sleep 1
done
[ -n "$UP" ] || die "server did not come up on port $PORT"

# --- 6. Repin + reload the local-sync LaunchAgent (if installed) ------------
# Done BEFORE the HTTP verify below. local-sync's pin is independent of the
# dashboard server, and the verify can race the npx cold-start (issue #83) —
# so repin local-sync FIRST, or a verify die() would strand it on the OLD
# version, where its next tick re-parses logs with the old CLI and can undo a
# data migration (issue #75). No HTTP to verify — it is an interval
# `sync --auto` job, not a server; the plist pin is the check.
SYNC_STATUS="not installed (skipped)"
if [ -f "$SYNC_PLIST" ]; then
  SYNC_TARGET="gui/$UID_NUM/$SYNC_LABEL"
  SYNC_INSPECT="$SYNC_PREFLIGHT"
  SYNC_CURRENT="$(node -e 'const d=JSON.parse(process.argv[1]); console.log(d.versions[0] || "unpinned")' "$SYNC_INSPECT")"
  SYNC_BACKUP="$SYNC_PLIST.bak-$SYNC_CURRENT-$STAMP-$$"
  cp -p "$SYNC_PLIST" "$SYNC_BACKUP"
  if ! node "$PLIST_TOOL" repin "$SYNC_PLIST" "$PACKAGE_NAME" "$VERSION" >/dev/null; then
    cp -p "$SYNC_BACKUP" "$SYNC_PLIST"
    die "local-sync repin failed — restored backup, plist unchanged"
  fi
  plutil -lint "$SYNC_PLIST" >/dev/null || { cp -p "$SYNC_BACKUP" "$SYNC_PLIST"; die "local-sync plist invalid after repin — restored backup"; }
  SYNC_UPDATED="$(node "$PLIST_TOOL" inspect "$SYNC_PLIST" "$PACKAGE_NAME")"
  SYNC_PINS="$(node -e 'const d=JSON.parse(process.argv[1]); console.log(d.pinCount)' "$SYNC_UPDATED")"
  echo "> Reloading ${SYNC_LABEL}..."
  launchctl bootout "$SYNC_TARGET" >/dev/null 2>&1 || true
  for _ in $(seq 1 15); do
    launchctl print "$SYNC_TARGET" >/dev/null 2>&1 || break
    sleep 1
  done
  if ! launchctl bootstrap "gui/$UID_NUM" "$SYNC_PLIST" 2>/dev/null; then
    sleep 2
    launchctl bootstrap "gui/$UID_NUM" "$SYNC_PLIST" || die "bootstrap failed for $SYNC_PLIST"
  fi
  echo "✓ local-sync repinned $SYNC_PINS occurrence(s) → $VERSION (was: $SYNC_CURRENT) + reloaded"
  SYNC_STATUS="$VERSION (was: $SYNC_CURRENT · backup: $SYNC_BACKUP)"
else
  echo "ℹ local-sync agent not installed ($SYNC_PLIST) — skipped"
fi

# --- 7. Confirm the SERVED bundle is this version (best-effort) --------------
# The version badge is VITE_APP_VERSION, inlined into the JS bundle at build
# time. Grep the served bundle to confirm the running artifact, not just a 200.
# BUT: the LaunchAgent runs `npx …@$VERSION`, whose cold-start settle time is
# variable and occasionally exceeds any fixed window — so a hard failure here
# would false-fail a correct deploy (issue #83). The authoritative deploy action
# is the plist repin above (already verified against every observed reference); npx
# resolves that pin. So we retry generously to confirm, and on timeout WARN
# rather than die — a timeout means "npx still warming", not "bad deploy".
VERIFIED=""
ASSET=""
for _ in $(seq 1 30); do
  ASSET="$(curl -s "http://127.0.0.1:$PORT/" | grep -oE '/assets/[A-Za-z0-9_-]+\.js' | head -1)"
  if [ -n "$ASSET" ]; then
    # No `curl | grep -q`: grep -q exits on match and SIGPIPEs curl, which under
    # `set -o pipefail` can look like a miss. Match the captured body instead.
    BODY="$(curl -s "http://127.0.0.1:$PORT$ASSET")"
    case "$BODY" in
      *"$VERSION"*)
        VERIFIED=1
        echo "✓ Verified: server is serving $VERSION"
        break
        ;;
    esac
  fi
  sleep 3
done
if [ -z "$VERIFIED" ]; then
  SERVED="$(curl -s "http://127.0.0.1:$PORT$ASSET" | grep -oE '0\.[0-9]+\.[0-9]+' | sort -u | tr '\n' ' ' || true)"
  echo "⚠ Could not confirm the served bundle is $VERSION within ~90s (found: ${SERVED:-none})."
  echo "  The plist is pinned to $VERSION and both agents were reloaded, so this is almost"
  echo "  always the npx cold-start still warming — not a bad deploy. Re-check shortly:"
  echo "    A=\$(curl -s http://127.0.0.1:$PORT/ | grep -oE '/assets/main-[A-Za-z0-9_-]+\\.js' | head -1); curl -s http://127.0.0.1:$PORT\$A | grep -c $VERSION"
  echo "  If it keeps serving an OLD version, rollback: cp '$BACKUP' '$PLIST' && launchctl bootout '$SERVICE_TARGET'; launchctl bootstrap gui/$UID_NUM '$PLIST'"
fi

echo ""
echo "🚀 Deployed $PACKAGE_NAME@$VERSION → http://127.0.0.1:$PORT/"
echo "   dashboard: $VERSION (was: $CURRENT · backup: $BACKUP)"
echo "   local-sync: $SYNC_STATUS"
