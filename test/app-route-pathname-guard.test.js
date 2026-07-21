const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { transform } = require("esbuild");

const repoRoot = path.join(__dirname, "..");

async function parseDashboardFile(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const source = fs.readFileSync(absolutePath, "utf8");
  await transform(source, {
    loader: "jsx",
    sourcefile: relativePath,
  });
}

test("App.jsx parses without duplicate identifier errors", async () => {
  await assert.doesNotReject(parseDashboardFile("dashboard/src/App.jsx"));
});

// Inverted deliberately. These used to assert the routes EXIST; the Leaderboard
// and Login pages were removed when TokenTracker became local-only, so the
// useful assertion now is that they do not come back — a deleted test would
// have pinned nothing.
test("App.jsx has no cloud-era routes (leaderboard, login, device)", () => {
  const appPath = path.join(repoRoot, "dashboard/src/App.jsx");
  const source = fs.readFileSync(appPath, "utf8");
  for (const gone of ['"/leaderboard"', '"/rankings"', '"/login"', '"/device"']) {
    assert.equal(source.includes(gone), false, `${gone} route must stay removed`);
  }
  for (const gone of ["LeaderboardPage", "LoginPage", "DevicePage", "NativeAuthCallbackPage"]) {
    assert.equal(source.includes(gone), false, `${gone} must stay removed`);
  }
});

test("App.jsx serves the dashboard at the root path", () => {
  const appPath = path.join(repoRoot, "dashboard/src/App.jsx");
  const source = fs.readFileSync(appPath, "utf8");
  assert.equal(source.includes("LandingPage"), false, "the marketing landing is removed");
  // App.jsx dispatches on the normalized pathname rather than <Route path>,
  // so assert against that style — the same way the /widgets check below does.
  assert.ok(
    source.includes('normalizedPath === "/"'),
    "the root path must resolve to the dashboard so it is reachable at localhost:7680/",
  );
});

test("App.jsx keeps menu bar configuration inside /widgets", () => {
  const appPath = path.join(repoRoot, "dashboard/src/App.jsx");
  const source = fs.readFileSync(appPath, "utf8");
  assert.equal(source.includes('"/widgets"'), true, "/widgets route should exist");
  assert.equal(source.includes("WidgetsPage"), true, "WidgetsPage should be referenced");
  assert.equal(source.includes('"/menubar"'), false, "/menubar should not be a separate route");
  assert.equal(source.includes("MenuBarPage"), false, "MenuBarPage should not be referenced");
});
