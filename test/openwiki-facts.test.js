const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const { extractFacts, extractLocalApiMethodAllowlist } = require("../scripts/openwiki-extract-facts.cjs");
const {
  checkFacts,
  collectFindings,
  collectLocalApiMethodFindings,
  readRootDocs,
} = require("../scripts/openwiki-check-facts.cjs");

test("OpenWiki facts expose TokenTracker's public command, API, route, and parser contracts", () => {
  const facts = extractFacts();
  assert.ok(facts.cli.commands.some((command) => command.name === "serve"));
  assert.ok(facts.local_api.endpoints.some((endpoint) => endpoint.path === "/functions/tokentracker-usage-limits"));
  assert.ok(facts.local_api.endpoints.some((endpoint) => endpoint.path === "/api/local-auth"));
  assert.ok(facts.local_api.endpoints.some((endpoint) => endpoint.path === "/api/avatar-proxy"));
  assert.ok(facts.local_api.endpoints.some((endpoint) => endpoint.path === "/proxy/ipcheck"));
  assert.ok(facts.dashboard.routes.some((route) => route.path === "/limits"));
  assert.ok(facts.providers.parsers.some((parser) => parser.name === "parseClaudeIncremental"));
});

test("OpenWiki facts derive endpoint methods from the enforced allowlist", () => {
  const source = `
    const LOCAL_API_METHODS = new Map([
      ["/functions/tokentracker-read", ["GET"]],
      ["/functions/tokentracker-write", ["POST"]],
      ["/functions/tokentracker-both", ["GET", "POST"]],
    ]);
  `;
  assert.deepEqual(
    extractLocalApiMethodAllowlist(source),
    new Map([
      ["/functions/tokentracker-read", ["GET"]],
      ["/functions/tokentracker-write", ["POST"]],
      ["/functions/tokentracker-both", ["GET", "POST"]],
    ]),
  );
});

test("OpenWiki checker rejects a documented endpoint method that differs from source facts", () => {
  const facts = {
    local_api: {
      endpoints: [{ path: "/functions/tokentracker-read", methods: ["GET"] }],
    },
  };
  const file = (content) => ({
    path: `${process.cwd()}/openwiki/local-api.md`,
    content,
  });
  const findings = collectLocalApiMethodFindings({
    facts,
    file: file("| POST | `/functions/tokentracker-read` |\n"),
    root: process.cwd(),
  });

  assert.deepEqual(findings, [
    "openwiki/local-api.md:1 method mismatch for '/functions/tokentracker-read': documented POST; source GET",
  ]);

  const duplicate = collectLocalApiMethodFindings({
    facts,
    file: file([
      "| POST | `/functions/tokentracker-read` |",
      "| GET | `/functions/tokentracker-read` |",
    ].join("\n")),
    root: process.cwd(),
  });
  assert.ok(duplicate.some((finding) => finding.includes("duplicate method row")));

  for (const duplicateRow of [
    "   | POST | `/functions/tokentracker-read` |",
    "POST | `/functions/tokentracker-read` |",
    "\t| POST | `/functions/tokentracker-read` |",
    "| | `/functions/tokentracker-read` |",
  ]) {
    const adversarialDuplicate = collectLocalApiMethodFindings({
      facts,
      file: file(`| GET | \`/functions/tokentracker-read\` |\n${duplicateRow}\n`),
      root: process.cwd(),
    });
    assert.ok(
      adversarialDuplicate.some((finding) => finding.includes("duplicate method row")),
      `expected duplicate finding for row: ${duplicateRow}`,
    );
  }

  const malformedMethod = collectLocalApiMethodFindings({
    facts,
    file: file("| get | `/functions/tokentracker-read` |\n"),
    root: process.cwd(),
  });
  assert.ok(malformedMethod.some((finding) => finding.includes("invalid method cell")));

  const malformedPath = collectLocalApiMethodFindings({
    facts,
    file: file("| GET | /functions/tokentracker-read |\n"),
    root: process.cwd(),
  });
  assert.ok(malformedPath.some((finding) => finding.includes("invalid path cell")));
});

test("OpenWiki fact checker rejects unsupported concrete claims", () => {
  const facts = extractFacts();
  const findings = collectFindings({
    facts,
    root: process.cwd(),
    files: [{
      path: `${process.cwd()}/openwiki/example.md`,
      content: "`tokentracker imaginary`\n/functions/tokentracker-imaginary\n`/rankings`\nparseImaginaryIncremental\n",
    }],
  });
  assert.equal(findings.filter((finding) => finding.includes("unknown")).length, 4);
});

test("the fact checker reads the front-door docs, not only openwiki/", () => {
  // README.md told users with a broken install to run a repair command the CLI
  // has never had. The checker that would have caught it existed the whole time;
  // it just wasn't looking at the file users actually follow.
  //
  // Asserted through readRootDocs rather than by writing a fake command into the
  // real README: a killed process or a CI timeout would skip the restore, and
  // the recovery path is `git add README.md` — which would silently re-commit
  // the exact falsehood this check exists to prevent.
  const scanned = readRootDocs(process.cwd()).map((file) => path.basename(file.path));
  assert.deepEqual(scanned.sort(), ["CONTRIBUTING.md", "README.md"]);
  assert.deepEqual(checkFacts(), [], "repo docs are clean as committed");

  const facts = extractFacts();
  const findings = collectFindings({
    facts,
    root: process.cwd(),
    files: [{ path: `${process.cwd()}/README.md`, content: "Run `tokentracker activate-if-needed` to fix.\n" }],
  });
  assert.ok(
    findings.some((f) => f.startsWith("README.md:") && f.includes("activate-if-needed")),
    `expected the fake command to be rejected, got: ${JSON.stringify(findings)}`,
  );
});

test("the front-door docs do not owe openwiki's completeness obligation", () => {
  // README is a front door, not a manifest. Documenting a command there must not
  // satisfy openwiki's "every command is documented" check, or extending the
  // scan would have quietly weakened the coverage half of the same validator.
  const facts = extractFacts();
  const findings = collectFindings({
    facts,
    root: process.cwd(),
    files: [
      { path: `${process.cwd()}/README.md`, content: "`tokentracker doctor`\n" },
      { path: `${process.cwd()}/openwiki/example.md`, content: "nothing documented here\n" },
    ],
    coverageFiles: [{ path: `${process.cwd()}/openwiki/example.md`, content: "nothing documented here\n" }],
  });
  assert.ok(
    findings.includes("openwiki/ missing CLI command 'doctor'"),
    "a command documented only in README must still count as undocumented in openwiki",
  );
});
