// Guard against MODEL_PRICING drift across the InsForge edge patches. All
// five edge functions embed their own copy of MODEL_PRICING (Deno edge
// functions can't share a module with the Node local-api), so a pricing edit
// applied to only one file silently desyncs the others. This test extracts
// each file's MODEL_PRICING table and asserts they are all deep-equal.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const EDGE_PATCH_FILES = [
  "dashboard/edge-patches/tokentracker-account-daily.ts",
  "dashboard/edge-patches/tokentracker-account-model-breakdown.ts",
  "dashboard/edge-patches/tokentracker-account-summary.ts",
  "dashboard/edge-patches/tokentracker-leaderboard-profile.ts",
  "dashboard/edge-patches/tokentracker-leaderboard-refresh.ts",
];

// Matches entries like:
//   "claude-fable-5": { input: 10, output: 50, cache_read: 1, cache_write: 12.5 },
//   "gpt-5.5": { input: 5, output: 30, cache_read: 0.5 },
const PRICING_ENTRY_RE =
  /"([^"]+)":\s*\{\s*input:\s*([\d.]+),\s*output:\s*([\d.]+),\s*cache_read:\s*([\d.]+)(?:,\s*cache_write:\s*([\d.]+))?\s*\}/g;

function extractModelPricingBlock(source) {
  const declIndex = source.indexOf("const MODEL_PRICING");
  assert.ok(declIndex !== -1, "MODEL_PRICING declaration not found");
  const eqIndex = source.indexOf("=", declIndex);
  const braceStart = source.indexOf("{", eqIndex);
  let depth = 0;
  let braceEnd = -1;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        braceEnd = i;
        break;
      }
    }
  }
  assert.ok(braceEnd !== -1, "unterminated MODEL_PRICING object literal");
  return source.slice(braceStart, braceEnd + 1);
}

function parseModelPricingTable(source) {
  const block = extractModelPricingBlock(source);
  const table = {};
  let match;
  PRICING_ENTRY_RE.lastIndex = 0;
  while ((match = PRICING_ENTRY_RE.exec(block))) {
    const [, name, input, output, cacheRead, cacheWrite] = match;
    table[name] = {
      input: Number(input),
      output: Number(output),
      cache_read: Number(cacheRead),
      ...(cacheWrite !== undefined ? { cache_write: Number(cacheWrite) } : {}),
    };
  }
  return table;
}

function loadPricingTables() {
  return EDGE_PATCH_FILES.map((relativePath) => {
    const absolutePath = path.resolve(__dirname, "..", relativePath);
    const source = fs.readFileSync(absolutePath, "utf8");
    return { file: relativePath, table: parseModelPricingTable(source) };
  });
}

test("all edge-patch MODEL_PRICING tables parse to non-empty objects", () => {
  const tables = loadPricingTables();
  for (const { file, table } of tables) {
    assert.ok(
      Object.keys(table).length >= 40,
      `${file}: MODEL_PRICING parsed only ${Object.keys(table).length} entries — parser regression or gutted table (expect ~90)`,
    );
  }
});

test("edge-patch MODEL_PRICING tables are deep-equal across all five files", () => {
  const tables = loadPricingTables();
  const [reference, ...rest] = tables;

  for (const candidate of rest) {
    assert.deepEqual(
      candidate.table,
      reference.table,
      `MODEL_PRICING in ${candidate.file} has drifted from ${reference.file}. ` +
        "Keep pricing edits in lockstep across all edge patches (see feedback_model_pricing_sync).",
    );
  }
});
