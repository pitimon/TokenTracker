// Rewrites the desktop projects' version literals to match package.json.
//
// Wired to npm's `version` lifecycle, so `npm version 0.39.43` updates all
// three files. Be precise about what that buys: npm only *stages* files a
// version hook touched when it is also making the version commit, and this
// repo bumps with `npm version <v> --no-git-tag-version` (see
// docs/npm-publish-checklist.md), which makes no commit. So after bumping,
// these files are ordinary working-tree changes you still have to `git add`.
//
// The load-bearing guarantee is therefore validate-version-lockstep.cjs in
// `ci:local`, not this script. This just removes the typing.

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

const TARGETS = [
  {
    file: "TokenTrackerBar/project.yml",
    // Every target in the project file (app + widget) carries its own copy.
    pattern: /^([ \t]*MARKETING_VERSION:[ \t]*")[^"]+(")/gm,
  },
  {
    file: "TokenTrackerWin/TokenTrackerWin.csproj",
    pattern: /(<Version>)[^<]+(<\/Version>)/g,
  },
];

function syncDesktopVersion({ root = ROOT, write = true } = {}) {
  const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  const changed = [];
  for (const target of TARGETS) {
    const filePath = path.join(root, target.file);
    if (!fs.existsSync(filePath)) continue;
    const before = fs.readFileSync(filePath, "utf8");
    const after = before.replace(target.pattern, `$1${version}$2`);
    if (after === before) continue;
    if (write) fs.writeFileSync(filePath, after);
    changed.push(target.file);
  }
  return { version, changed };
}

function main() {
  const { version, changed } = syncDesktopVersion();
  if (changed.length === 0) {
    console.log(`Desktop versions already at ${version}.`);
    return;
  }
  console.log(`Set ${version} in: ${changed.join(", ")}`);
  console.log("These are unstaged working-tree edits — `git add` them with the version bump.");
}

if (require.main === module) main();

module.exports = { syncDesktopVersion };
