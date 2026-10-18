const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
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

test("local service reinstall retains dedicated npm cache for both LaunchAgents", { skip: process.platform !== "darwin" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-service-install-"));
  try {
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "launchctl"), '#!/bin/bash\nprintf "%s\\n" "$@" >> "$HOME/launchctl.calls"\n', { mode: 0o755 });
    for (const name of ["home", "home with spaces & <xml> \"quotes\" 'apostrophe'"]) {
      const home = path.join(dir, name);
      const cache = path.join(home, ".cache", "tokentracker-npm");
      fs.mkdirSync(cache, { recursive: true });
      const marker = path.join(cache, "retained");
      fs.writeFileSync(marker, "existing cache\n");
      const tools = path.join(home, "bin & <tools>");
      fs.mkdirSync(tools);
      const servicePath = `${tools}:/usr/bin:/bin:/usr/sbin:/sbin`;
      const env = {
        HOME: home,
        TOKENTRACKER_SERVICE_PATH: servicePath,
        PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
        TOKENTRACKER_NPM_PACKAGE: `${PACKAGE}@0.39.50`,
        NPM_CONFIG_CACHE: path.join(dir, "unrelated-shell-cache"),
      };
      for (let install = 0; install < 2; install += 1) {
        const result = spawnSync("/bin/bash", [path.join(ROOT, "scripts", "install-local-service.sh")], { env, encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
        for (const service of ["dashboard", "local-sync"]) {
          const file = path.join(home, "Library", "LaunchAgents", `com.pitimon.tokentracker.${service}.plist`);
          const xml = fs.readFileSync(file, "utf8");
          assert.match(xml, /<key>NPM_CONFIG_CACHE<\/key>/, `${service} missing dedicated npm cache`);
          const parsed = spawnSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", "--", file], { encoding: "utf8" });
          assert.equal(parsed.status, 0, parsed.stdout + parsed.stderr);
          const plist = JSON.parse(parsed.stdout);
          assert.equal(plist.EnvironmentVariables.PATH, servicePath);
          assert.equal(plist.EnvironmentVariables.NPM_CONFIG_CACHE, cache);
          assert.equal(plist.EnvironmentVariables.TOKENTRACKER_NPM_PACKAGE, env.TOKENTRACKER_NPM_PACKAGE);
          assert.equal(plist.WorkingDirectory, home);
          assert.equal(plist.StandardOutPath, path.join(home, ".tokentracker", "tracker", "logs", `${service}.log`));
          assert.equal(plist.StandardErrorPath, path.join(home, ".tokentracker", "tracker", "logs", `${service}.err.log`));
          if (service === "local-sync") {
            assert.equal(plist.EnvironmentVariables.TOKENTRACKER_SERVICE_PATH, servicePath);
            assert.equal(plist.ProgramArguments[0], path.join(home, ".tokentracker", "bin", "tokentracker-local-sync-service.sh"));
            const syntax = spawnSync("/bin/bash", ["-n", plist.ProgramArguments[0]], { encoding: "utf8" });
            assert.equal(syntax.status, 0, syntax.stderr);
          }
        }
        assert.equal(fs.readFileSync(marker, "utf8"), "existing cache\n");
      }
      const calls = fs.readFileSync(path.join(home, "launchctl.calls"), "utf8");
      assert.equal(calls.split("\n").filter((line) => line === "bootstrap").length, 4);
      assert.equal(calls.split("\n").filter((line) => line === "bootout").length, 4);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
