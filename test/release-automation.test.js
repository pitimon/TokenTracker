const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const {
  inspectPlistXml,
  repinPlistXml,
} = require("../scripts/lib/launchagent-plist.cjs");
const {
  verifyInstalledPackage,
} = require("../scripts/verify-registry-package.cjs");

const PACKAGE = "@ipv9/tokentracker-cli";

function plist(strings, envPackage = null) {
  const args = strings.map((value) => `      <string>${value}</string>`).join("\n");
  const env = envPackage === null ? "" : `
  <key>EnvironmentVariables</key>
  <dict>
    <key>TOKENTRACKER_NPM_PACKAGE</key>
    <string>${envPackage}</string>
  </dict>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>${env}
</dict></plist>\n`;
}

test("current one-pin shell-wrapper plist is inspected and repinned", () => {
  const xml = plist(
    ["/bin/zsh", "-lc", "exec npx --yes ${TOKENTRACKER_NPM_PACKAGE} serve --port 17680"],
    `${PACKAGE}@0.39.48`
  );
  assert.deepEqual(inspectPlistXml(xml, PACKAGE), {
    versions: ["0.39.48"],
    pinCount: 1,
    port: 17680,
  });
  const updated = repinPlistXml(xml, PACKAGE, "0.39.50");
  assert.deepEqual(inspectPlistXml(updated, PACKAGE), {
    versions: ["0.39.50"],
    pinCount: 1,
    port: 17680,
  });
});

test("legacy literal pins and split port are all repinned", () => {
  const xml = plist(
    ["npx", "--yes", `${PACKAGE}@0.39.48`, "serve", "--port", "7680"],
    `${PACKAGE}@0.39.48`
  );
  assert.deepEqual(inspectPlistXml(xml, PACKAGE), {
    versions: ["0.39.48"],
    pinCount: 2,
    port: 7680,
  });
  const updated = repinPlistXml(xml, PACKAGE, "0.39.50");
  assert.deepEqual(inspectPlistXml(updated, PACKAGE), {
    versions: ["0.39.50"],
    pinCount: 2,
    port: 7680,
  });
});

test("bare and tag package references are counted and cleanly repinned", () => {
  for (const current of [PACKAGE, `${PACKAGE}@latest`, `${PACKAGE}@next`]) {
    const xml = plist(["npx", current, "serve", "--port=17680"]);
    assert.equal(inspectPlistXml(xml, PACKAGE).pinCount, 1);
    const updated = repinPlistXml(xml, PACKAGE, "0.39.50");
    assert.match(updated, /@ipv9\/tokentracker-cli@0\.39\.50<\/string>/);
    assert.doesNotMatch(updated, /0\.39\.50@(latest|next)/);
    assert.deepEqual(inspectPlistXml(updated, PACKAGE).versions, ["0.39.50"]);
  }
  assert.equal(inspectPlistXml(plist([`${PACKAGE}-extra`]), PACKAGE).pinCount, 0);
});

test("shell-wrapper equals-form port is detected", () => {
  const xml = plist([`exec npx ${PACKAGE}@0.39.48 serve --port=17680`]);
  assert.equal(inspectPlistXml(xml, PACKAGE).port, 17680);
});

test("release helper uses structural plist tooling and unique backups", () => {
  const content = fs.readFileSync(path.join(ROOT, "scripts", "release.sh"), "utf8");
  assert.match(content, /launchagent-plist\.cjs/);
  assert.match(content, /date \+%Y%m%d-%H%M%S/);
  assert.match(content, /-\$STAMP-\$\$/);
  assert.doesNotMatch(content, /expected to repin 2 occurrences/);
  const syncPreflight = content.indexOf("SYNC_PREFLIGHT=");
  const dashboardMutation = content.indexOf('repin "$PLIST"');
  assert.ok(syncPreflight >= 0 && syncPreflight < dashboardMutation, "local-sync must be validated before dashboard mutation");
});

test("registry verifier accepts target dashboard and rejects stale bundle", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-registry-fixture-"));
  try {
    fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
    fs.mkdirSync(path.join(dir, "dashboard", "dist", "assets"), { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: "0.39.50" }));
    fs.writeFileSync(path.join(dir, "bin", "tracker.js"), "console.log('Usage: tracker')\n");
    fs.writeFileSync(path.join(dir, "dashboard", "dist", "index.html"), "<html></html>\n");
    const asset = path.join(dir, "dashboard", "dist", "assets", "main.js");
    fs.writeFileSync(asset, "const version='0.39.50';\n");
    const receipt = verifyInstalledPackage(dir, "0.39.50");
    assert.equal(receipt.version, "0.39.50");
    assert.equal(receipt.assetCount, 1);

    fs.writeFileSync(asset, "const version='0.39.49';\n");
    assert.throws(() => verifyInstalledPackage(dir, "0.39.50"), /target version/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("npm workflow smoke-tests the exact registry version after publish", () => {
  const content = fs.readFileSync(path.join(ROOT, ".github", "workflows", "npm-publish.yml"), "utf8");
  const publishIndex = content.indexOf("run: npm publish --access public");
  const smokeIndex = content.indexOf("node scripts/verify-registry-package.cjs");
  assert.ok(publishIndex >= 0);
  assert.ok(smokeIndex > publishIndex, "registry smoke must run after publication");
});
