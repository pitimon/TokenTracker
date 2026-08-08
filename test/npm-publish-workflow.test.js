const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const WORKFLOW_PATH = path.join(
  __dirname,
  "..",
  ".github",
  "workflows",
  "npm-publish.yml"
);

function loadWorkflow() {
  return fs.readFileSync(WORKFLOW_PATH, "utf8");
}

test("npm-publish workflow file exists", () => {
  assert.ok(fs.existsSync(WORKFLOW_PATH), "workflow file should exist");
});

test("workflow triggers on push to main", () => {
  const content = loadWorkflow();
  assert.ok(content.includes("push:"), "should trigger on push");
  assert.ok(
    content.includes("branches: [main]"),
    "should target main branch only"
  );
});

test("publish job uses a Trusted Publishing-capable Node/npm runtime", () => {
  const content = loadWorkflow();
  assert.ok(
    content.includes("node-version: 24"),
    "publish job should use Node 24, which bundles npm >=11.5.1 required by Trusted Publishing"
  );
});

test("workflow sets npm registry URL", () => {
  const content = loadWorkflow();
  assert.ok(
    content.includes("registry-url: https://registry.npmjs.org"),
    "should configure npm registry"
  );
});

test("workflow checks version before publishing", () => {
  const content = loadWorkflow();
  assert.ok(
    content.includes("npm view @ipv9/tokentracker-cli"),
    "should check if version already exists on npm"
  );
});

test("workflow builds dashboard before publish", () => {
  const content = loadWorkflow();
  const buildIndex = content.indexOf("dashboard:build");
  const publishIndex = content.indexOf("run: npm publish --access public");
  assert.ok(buildIndex > 0, "should build dashboard");
  assert.ok(publishIndex > 0, "should run npm publish");
  assert.ok(
    buildIndex < publishIndex,
    "dashboard build must come before npm publish"
  );
});

test("package prepublish rebuilds dashboard before pricing seed", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")
  );
  const command = pkg.scripts.prepublishOnly;
  const dashboardIndex = command.indexOf("npm run dashboard:build");
  const pricingIndex = command.indexOf("node scripts/build-pricing-seed.cjs");
  assert.ok(dashboardIndex >= 0, "manual npm publish must rebuild dashboard/dist");
  assert.ok(pricingIndex >= 0, "prepublish must still rebuild pricing seed");
  assert.ok(dashboardIndex < pricingIndex, "dashboard build must precede pricing seed generation");
});

test("package publishes under the ipv9 npm scope", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")
  );
  assert.equal(pkg.name, "@ipv9/tokentracker-cli");
  assert.equal(pkg.publishConfig.access, "public");
});

test("workflow uses npm Trusted Publishing rather than a long-lived token", () => {
  const content = loadWorkflow();
  assert.match(
    content,
    /publish:\n(?:.*\n)*?    permissions:\n(?:.*\n)*?      id-token: write/m,
    "publish job must grant an OIDC identity token"
  );
  assert.doesNotMatch(
    content,
    /NODE_AUTH_TOKEN|secrets\.NPM_TOKEN/,
    "Trusted Publishing must not inject a long-lived npm token"
  );
});

test("workflow skips all steps when version already published", () => {
  const content = loadWorkflow();
  const conditionalSteps = (content.match(/if:.*version-check.*false/g) || [])
    .length;
  // install root, install dashboard, build, publish = 4 conditional steps
  assert.ok(
    conditionalSteps >= 4,
    `should have at least 4 steps gated on version check, found ${conditionalSteps}`
  );
});

test("workflow has concurrency guard to prevent parallel publishes", () => {
  const content = loadWorkflow();
  assert.ok(
    content.includes("concurrency:"),
    "should have concurrency config"
  );
  assert.ok(
    content.includes("cancel-in-progress: false"),
    "should not cancel in-progress publish"
  );
});

test("workflow installs dashboard dependencies separately", () => {
  const content = loadWorkflow();
  assert.ok(
    content.includes("npm ci --prefix dashboard"),
    "should install dashboard deps with --prefix"
  );
});

test("package.json files array includes dashboard/dist", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")
  );
  assert.ok(
    pkg.files.includes("dashboard/dist/"),
    "published package must include dashboard/dist/"
  );
  assert.ok(
    pkg.files.includes("scripts/install-local-service.sh"),
    "published package must include macOS service installer"
  );
  assert.ok(
    pkg.files.includes("scripts/uninstall-local-service.sh"),
    "published package must include macOS service uninstaller"
  );
});
