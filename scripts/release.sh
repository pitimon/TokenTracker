#!/usr/bin/env bash
#
# release.sh — redeploy the local dashboard LaunchAgent to a published version.
#
# This is a LOCAL redeploy, NOT an npm publish. It repins the dashboard
# LaunchAgent's plist to a specific published version, reloads the agent, waits
# for the server, and VERIFIES that the version the server actually serves
# matches the target (by grepping the served JS bundle — no false "success" on
# a stale bundle). Publish to npm first (`npm publish`), then run this.
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
#   TOKENTRACKER_NPM_PACKAGE   default @ipv9/tokentracker-cli
#   TOKENTRACKER_DASHBOARD_LABEL   default com.pitimon.tokentracker.dashboard
#
set -euo pipefail

PACKAGE_NAME="${TOKENTRACKER_NPM_PACKAGE:-@ipv9/tokentracker-cli}"
DASHBOARD_LABEL="${TOKENTRACKER_DASHBOARD_LABEL:-com.pitimon.tokentracker.dashboard}"
AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST="$AGENTS_DIR/$DASHBOARD_LABEL.plist"
UID_NUM="$(id -u)"
SERVICE_TARGET="gui/$UID_NUM/$DASHBOARD_LABEL"
TARGET_ARG="${1:-latest}"

die() { echo "❌ $*" >&2; exit 1; }

command -v npm >/dev/null 2>&1 || die "npm not found on PATH"
[ "$(uname -s)" = "Darwin" ] || die "this script drives launchctl and only runs on macOS"
[ -f "$PLIST" ] || die "plist not found: $PLIST (run scripts/install-local-service.sh first)"

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
CURRENT="$(grep -oE "${PACKAGE_NAME}@[0-9][0-9A-Za-z.-]*" "$PLIST" | head -1 | sed "s|^${PACKAGE_NAME}@||" || true)"
CURRENT="${CURRENT:-unpinned}"
# Port lives right after the --port arg in ProgramArguments.
PORT="$(awk '/<string>--port<\/string>/{getline; if (match($0,/[0-9]+/)) print substr($0,RSTART,RLENGTH); exit}' "$PLIST")"
PORT="${PORT:-7680}"
echo "→ Current pin: $CURRENT · port: $PORT"

if [ "$CURRENT" = "$VERSION" ]; then
  echo "ℹ Plist already pins $VERSION — reloading to be sure it is live."
fi

# --- 3. Back up, then repin both occurrences --------------------------------
BACKUP="$PLIST.bak-$CURRENT"
cp "$PLIST" "$BACKUP"
echo "✓ Backup: $BACKUP"

# Replace the package spec (pinned or unpinned) with the exact target version,
# in both ProgramArguments and the TOKENTRACKER_NPM_PACKAGE env value.
sed -i '' -E "s|<string>${PACKAGE_NAME}(@[^<]*)?</string>|<string>${PACKAGE_NAME}@${VERSION}</string>|g" "$PLIST"

PINS="$(grep -c "${PACKAGE_NAME}@${VERSION}" "$PLIST" || true)"
if [ "$PINS" -lt 2 ]; then
  cp "$BACKUP" "$PLIST"
  die "expected to repin 2 occurrences, found $PINS — restored backup, plist unchanged"
fi
echo "✓ Repinned $PINS occurrences → $VERSION"

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

# --- 6. Verify the SERVED bundle actually is this version -------------------
# The version badge is VITE_APP_VERSION, inlined into the JS bundle at build
# time. Grep the served bundle so we confirm the running artifact, not just a
# 200. A stale bundle would carry a different version and fail here.
ASSET="$(curl -s "http://127.0.0.1:$PORT/" | grep -oE '/assets/[A-Za-z0-9_-]+\.js' | head -1)"
[ -n "$ASSET" ] || die "could not find the dashboard JS asset to verify"
if curl -s "http://127.0.0.1:$PORT$ASSET" | grep -qF "$VERSION"; then
  echo "✓ Verified: server is serving $VERSION"
else
  SERVED="$(curl -s "http://127.0.0.1:$PORT$ASSET" | grep -oE '0\.[0-9]+\.[0-9]+' | sort -u | tr '\n' ' ')"
  die "served bundle does not report $VERSION (found: ${SERVED:-none}) — rollback: cp '$BACKUP' '$PLIST' && launchctl bootout '$SERVICE_TARGET'; launchctl bootstrap gui/$UID_NUM '$PLIST'"
fi

echo ""
echo "🚀 Deployed $PACKAGE_NAME@$VERSION → http://127.0.0.1:$PORT/"
echo "   (was: $CURRENT · backup: $BACKUP)"
