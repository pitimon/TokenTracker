// Three files carry the release version, and all three are edited by hand:
//
//   package.json                            "version"
//   TokenTrackerBar/project.yml             MARKETING_VERSION  (app + widget)
//   TokenTrackerWin/TokenTrackerWin.csproj  <Version>
//
// release-dmg.yml and release-windows.yml already refuse to build when they
// disagree — but that gate only fires when someone dispatches a release, and a
// workflow nobody dispatched reports nothing. package.json reached 0.39.42
// while the other two sat at 0.39.38, so every desktop release from 0.39.39 on
// was impossible and the tags stopped with it. Nothing said so for four
// releases.
//
// This runs the same check in `ci:local`, where it is seen on every PR. It is
// the same reasoning ci.yml records for moving the test gate in front of the
// merge instead of after it.
//
// What this does NOT claim: that a desktop build ships with every npm release.
// The README is explicit that the desktop apps are cut less often. This is
// about the version recorded in the *source* — keeping it in step is what makes
// a desktop release possible at any time, rather than a version bump away.

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

const MARKETING_VERSION_RE = /^[ \t]*MARKETING_VERSION:[ \t]*"([^"]+)"/gm;
const CSPROJ_VERSION_RE = /<Version>([^<]+)<\/Version>/g;

function readIfPresent(root, relative) {
  const filePath = path.join(root, relative);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
}

// Returns [{ file, version }] for every version literal found, so a file with
// two targets contributes two entries and a mismatch between them is caught
// too — that is the defect this file's comment in release-dmg.yml describes.
function collectVersions(root = ROOT) {
  const found = [];
  const projectYml = readIfPresent(root, "TokenTrackerBar/project.yml");
  if (projectYml) {
    for (const match of projectYml.matchAll(MARKETING_VERSION_RE)) {
      found.push({ file: "TokenTrackerBar/project.yml", version: match[1] });
    }
  }
  const csproj = readIfPresent(root, "TokenTrackerWin/TokenTrackerWin.csproj");
  if (csproj) {
    for (const match of csproj.matchAll(CSPROJ_VERSION_RE)) {
      found.push({ file: "TokenTrackerWin/TokenTrackerWin.csproj", version: match[1] });
    }
  }
  return found;
}

function checkVersionLockstep({ root = ROOT } = {}) {
  const pkgPath = path.join(root, "package.json");
  if (!fs.existsSync(pkgPath)) return ["package.json not found"];
  const expected = JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;
  if (!expected) return ["package.json has no version"];

  const found = collectVersions(root);
  if (found.length === 0) {
    // Neither desktop project is present. Not an error — the CLI is publishable
    // on its own, and a checkout without them should not fail this gate.
    return [];
  }

  return found
    .filter((entry) => entry.version !== expected)
    .map(
      (entry) =>
        `${entry.file} declares ${entry.version}, but package.json is ${expected}` +
        ` — run \`node scripts/sync-desktop-version.cjs\` and commit the result.` +
        ` The desktop apps do not have to ship every release, but their recorded` +
        ` version has to match, or release-dmg.yml / release-windows.yml refuse to build.`,
    );
}

function main() {
  const findings = checkVersionLockstep();
  if (findings.length === 0) {
    console.log("Version lockstep ok: desktop projects match package.json.");
    return;
  }
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { checkVersionLockstep, collectVersions };
