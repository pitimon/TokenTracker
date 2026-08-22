"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const ROOT = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const exists = (relative) => fs.existsSync(path.join(ROOT, relative));

test("active product authority is localhost browser plus CLI backend only", () => {
  for (const file of ["CLAUDE.md", "README.md", "CONTRIBUTING.md", "SECURITY.md"]) {
    const content = read(file);
    assert.match(content, /local web|local browser|browser dashboard/i, file);
    assert.match(content, /loopback|localhost|127\.0\.0\.1/i, file);
  }
  assert.match(read("CLAUDE.md"), /native macOS and Windows.*archived/i);
  assert.match(read("CLAUDE.md"), /hosted.*out of scope/i);
  assert.doesNotMatch(read("README.md"), /TokenTrackerBar\.dmg|TokenTracker-Setup\.exe/);
});

test("npm is the only active release path", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.version, "0.39.53");
  assert.equal(pkg.scripts.version, undefined);
  assert.equal(pkg.scripts["validate:version-lockstep"], undefined);
  assert.doesNotMatch(pkg.scripts["ci:local"], /version-lockstep/);

  assert.equal(exists(".github/workflows/release-dmg.yml"), false);
  assert.equal(exists(".github/workflows/release-windows.yml"), false);
  assert.equal(exists("archive/native-apps/workflows/release-dmg.yml"), true);
  assert.equal(exists("archive/native-apps/workflows/release-windows.yml"), true);
  assert.match(read("agent-os/standards/release/version-lockstep.md"), /npm.*sole active release/i);
});

test("browser UI has no active native-app entry points", () => {
  assert.doesNotMatch(read("dashboard/src/App.jsx"), /WidgetsPage|isWidgetsPath|\/widgets/);
  assert.doesNotMatch(read("dashboard/src/pages/SettingsPage.jsx"), /MenuBarSection|NativeAppFooter/);
  assert.doesNotMatch(read("dashboard/src/ui/dashboard/views/DashboardView.jsx"), /WidgetOnboardingCard/);
  const notice = read("dashboard/src/components/LocalOnlyNotice.jsx");
  assert.doesNotMatch(notice, /tokentracker:\/\/|releases\/latest|Mac app|openInApp/);
  assert.match(notice, /localhost|local CLI/i);
  assert.equal(exists("dashboard/src/lib/native-bridge.js"), false);
  assert.equal(exists("dashboard/pet.html"), false);
  assert.doesNotMatch(read("dashboard/index.html"), /nativeBridge|native-app/);
});

test("native implementation and its contracts are archived, not active", () => {
  for (const app of ["TokenTrackerBar", "TokenTrackerWin"]) {
    assert.deepEqual(
      fs.readdirSync(path.join(ROOT, app)),
      ["ARCHIVED.md"],
      `${app}/ must retain only its archive marker outside archive/native-apps`,
    );
    assert.match(read(`${app}/ARCHIVED.md`), /unsupported|archived/i);
    assert.equal(exists(`archive/native-apps/${app}`), true, `${app} source must be retained in archive`);
  }
  for (const file of [
    "release-dmg-workflow.test.js",
    "release-windows-workflow.test.js",
    "native-bridge-sync-feedback.test.js",
    "localization-regressions.test.js",
    "kiro-cli-native-contract.test.js",
    "version-lockstep.test.js",
  ]) {
    assert.equal(exists(`test/${file}`), false, `${file} must leave the active test glob`);
    assert.equal(exists(`archive/native-apps/tests/${file}`), true, `${file} must be retained in archive`);
  }
});
