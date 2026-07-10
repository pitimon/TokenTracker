const assert = require("node:assert/strict");
const { test } = require("node:test");

const { extractFacts } = require("../scripts/openwiki-extract-facts.cjs");
const { collectFindings } = require("../scripts/openwiki-check-facts.cjs");

test("OpenWiki facts expose TokenTracker's public command, API, route, and parser contracts", () => {
  const facts = extractFacts();
  assert.ok(facts.cli.commands.some((command) => command.name === "serve"));
  assert.ok(facts.local_api.endpoints.some((endpoint) => endpoint.path === "/functions/tokentracker-usage-limits"));
  assert.ok(facts.dashboard.routes.some((route) => route.path === "/limits"));
  assert.ok(facts.providers.parsers.some((parser) => parser.name === "parseClaudeIncremental"));
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
