const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { checkVersionLockstep, collectVersions } = require("../scripts/validate-version-lockstep.cjs");
const { syncDesktopVersion } = require("../scripts/sync-desktop-version.cjs");

// Builds a throwaway repo shaped like this one, so the tests never touch the
// real project files — a validator that edits the tree it validates is how you
// get a green run that proves nothing.
function fixture({ pkg, bar, win }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tt-lockstep-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: pkg }));
  if (bar) {
    fs.mkdirSync(path.join(root, "TokenTrackerBar"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "TokenTrackerBar/project.yml"),
      // Two targets, matching the real file: app and widget each carry a copy.
      `settings:\n    base:\n        MARKETING_VERSION: "${bar[0]}"\n` +
        `targets:\n    widget:\n        MARKETING_VERSION: "${bar[1]}"\n`,
    );
  }
  if (win) {
    fs.mkdirSync(path.join(root, "TokenTrackerWin"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "TokenTrackerWin/TokenTrackerWin.csproj"),
      `<Project>\n  <PropertyGroup>\n    <Version>${win}</Version>\n  </PropertyGroup>\n</Project>\n`,
    );
  }
  return root;
}

test("the repo as committed is in lockstep", () => {
  assert.deepEqual(checkVersionLockstep(), []);
});

test("a desktop project left behind by an npm bump is reported", () => {
  // The actual history: package.json went 0.39.39 → 0.39.42 while both desktop
  // projects stayed at 0.39.38, so every desktop release in between was
  // impossible — and nothing said so, because the only check lived in a
  // workflow nobody dispatched.
  const root = fixture({ pkg: "0.39.42", bar: ["0.39.38", "0.39.38"], win: "0.39.38" });
  const findings = checkVersionLockstep({ root });
  assert.equal(findings.length, 3, "two project.yml targets plus the csproj");
  assert.ok(findings.every((f) => f.includes("0.39.38") && f.includes("0.39.42")));
  assert.ok(
    findings.some((f) => f.includes("TokenTrackerWin/TokenTrackerWin.csproj")),
    "the Windows project must be checked too, not just the macOS one",
  );
});

test("one target updated and the other missed is still a mismatch", () => {
  // release-dmg.yml records shipping a DMG whose Info.plist advertised the
  // previous version because only one MARKETING_VERSION was bumped. Both
  // targets are collected separately so that case cannot pass.
  const root = fixture({ pkg: "1.2.3", bar: ["1.2.3", "1.2.2"], win: "1.2.3" });
  const findings = checkVersionLockstep({ root });
  assert.equal(findings.length, 1);
  assert.ok(findings[0].includes("1.2.2"));
});

test("a checkout without the desktop projects is not a failure", () => {
  // The CLI is publishable on its own; a sparse checkout must not fail the gate.
  const root = fixture({ pkg: "1.2.3" });
  assert.deepEqual(collectVersions(root), []);
  assert.deepEqual(checkVersionLockstep({ root }), []);
});

test("sync rewrites every version literal and satisfies the validator", () => {
  const root = fixture({ pkg: "9.9.9", bar: ["0.0.1", "0.0.2"], win: "0.0.3" });
  assert.equal(checkVersionLockstep({ root }).length, 3);

  const { version, changed } = syncDesktopVersion({ root });
  assert.equal(version, "9.9.9");
  assert.deepEqual(changed.sort(), [
    "TokenTrackerBar/project.yml",
    "TokenTrackerWin/TokenTrackerWin.csproj",
  ]);
  assert.deepEqual(checkVersionLockstep({ root }), [], "sync must close what the validator opens");

  // Idempotent: a second run reports nothing changed rather than rewriting.
  assert.deepEqual(syncDesktopVersion({ root }).changed, []);
});

test("sync only touches the version, leaving the rest of the file intact", () => {
  const root = fixture({ pkg: "9.9.9", bar: ["0.0.1", "0.0.2"], win: "0.0.3" });
  syncDesktopVersion({ root });
  const csproj = fs.readFileSync(path.join(root, "TokenTrackerWin/TokenTrackerWin.csproj"), "utf8");
  assert.ok(csproj.includes("<PropertyGroup>") && csproj.includes("</Project>"));
  const yml = fs.readFileSync(path.join(root, "TokenTrackerBar/project.yml"), "utf8");
  assert.ok(yml.includes("settings:") && yml.includes("targets:"));
  assert.equal((yml.match(/MARKETING_VERSION: "9\.9\.9"/g) || []).length, 2);
});
