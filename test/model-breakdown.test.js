const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { loadDashboardModule } = require("./helpers/load-dashboard-module");

// ─────────────────────────────────────────────────────────────────────────────
// Local-api handler under test — only loaded when the pricing / consumer-
// boundary tests below need it; kept lazy so module-load cost isn't paid
// by the existing dashboard-only tests.
// ─────────────────────────────────────────────────────────────────────────────
const localApi = require("../src/lib/local-api");

test("buildFleetData keeps usage tokens for fleet rows", async () => {
  const mod = await loadDashboardModule("dashboard/src/lib/model-breakdown.ts");
  const buildFleetData = mod.buildFleetData;

  const modelBreakdown = {
    pricing: { pricing_mode: "list" },
    sources: [
      {
        source: "cli",
        totals: { total_tokens: 1200, total_cost_usd: 1.2 },
        models: [
          {
            model: "gpt-4o",
            model_id: "gpt-4o",
            totals: { total_tokens: 1200 },
          },
        ],
      },
      {
        source: "api",
        totals: { total_tokens: 0, total_cost_usd: 0 },
        models: [],
      },
    ],
  };

  assert.equal(typeof buildFleetData, "function");

  const fleetData = buildFleetData(modelBreakdown);

  assert.equal(fleetData.length, 1);
  assert.equal(fleetData[0].label, "CLI");
  assert.equal(fleetData[0].usage, 1200);
  assert.equal(fleetData[0].totalPercent, "100.0");
});

test("buildFleetData returns model ids for stable keys", async () => {
  const mod = await loadDashboardModule("dashboard/src/lib/model-breakdown.ts");
  const buildFleetData = mod.buildFleetData;

  const modelBreakdown = {
    pricing: { pricing_mode: "list" },
    sources: [
      {
        source: "cli",
        totals: { total_tokens: 1200, total_cost_usd: 1.2 },
        models: [
          {
            model: "GPT-4o",
            model_id: "gpt-4o",
            totals: { total_tokens: 1200 },
          },
        ],
      },
    ],
  };

  const fleetData = buildFleetData(modelBreakdown);

  assert.equal(fleetData[0].models[0].id, "gpt-4o");
});

test("buildFleetData uses explicit per-model cost instead of proportional source allocation", async () => {
  const mod = await loadDashboardModule("dashboard/src/lib/model-breakdown.ts");
  const buildFleetData = mod.buildFleetData;

  const modelBreakdown = {
    sources: [
      {
        source: "antigravity",
        totals: { billable_total_tokens: 143_140_984, total_cost_usd: "43.260712" },
        models: [
          {
            model: "gemini-3.5-flash",
            model_id: "gemini-3.5-flash",
            totals: { billable_total_tokens: 143_100_440, total_cost_usd: "43.185541" },
          },
          {
            model: "gemini-3.1-pro",
            model_id: "gemini-3.1-pro",
            totals: { billable_total_tokens: 40_544, total_cost_usd: "0.075171" },
          },
        ],
      },
    ],
  };

  const fleetData = buildFleetData(modelBreakdown);

  assert.equal(fleetData[0].usd, 43.260712);
  assert.equal(fleetData[0].models[0].cost, 43.185541);
  assert.equal(fleetData[0].models[1].cost, 0.075171);
});

test("buildFleetData exposes top cost and missing-pricing metadata for collapsed provider cards", async () => {
  const mod = await loadDashboardModule("dashboard/src/lib/model-breakdown.ts");
  const { buildFleetData, buildUsageInsights, enrichDailyRows } = mod;

  const modelBreakdown = {
    sources: [
      {
        source: "claude",
        totals: { billable_total_tokens: 3000, total_cost_usd: "12.5" },
        models: [
          {
            model: "claude-fable-5",
            model_id: "claude-fable-5",
            totals: { billable_total_tokens: 1000, total_cost_usd: "10.5" },
          },
          {
            model: "claude-sonnet-new",
            model_id: "claude-sonnet-new",
            totals: { billable_total_tokens: 2000, total_cost_usd: "0" },
          },
        ],
      },
    ],
  };

  const fleetData = buildFleetData(modelBreakdown);
  assert.equal(fleetData[0].topCostModel.name, "claude-fable-5");
  assert.equal(fleetData[0].missingPricingModels.length, 1);
  assert.equal(fleetData[0].missingPricingModels[0].name, "claude-sonnet-new");

  const insights = buildUsageInsights(modelBreakdown);
  assert.equal(insights.topCostModel.name, "claude-fable-5");
  assert.equal(insights.topUsageModel.name, "claude-sonnet-new");
  assert.equal(insights.missingPricingModels.length, 1);
  assert.equal(insights.costPerMillionTokens, 4166.666666666667);

  const daily = enrichDailyRows([
    {
      day: "2026-07-03",
      billable_total_tokens: 2_000_000,
      total_cost_usd: "4",
      models: { "claude-fable-5": 1_500_000, "claude-sonnet-5": 500_000 },
    },
    {
      day: "2026-07-02",
      billable_total_tokens: 2_000_000,
      total_cost_usd: "1",
      models: { "claude-sonnet-5": 2_000_000 },
    },
  ]);
  assert.equal(daily[0].top_model, "claude-fable-5");
  assert.equal(daily[0].cost_per_million_tokens, 2);
  assert.equal(daily[0].cost_per_million_status, "high");
  assert.equal(daily[1].cost_per_million_status, "normal");
});

test("buildTopModels aggregates by model name across sources", async () => {
  const mod = await loadDashboardModule("dashboard/src/lib/model-breakdown.ts");
  const buildTopModels = mod.buildTopModels;

  const modelBreakdown = {
    sources: [
      {
        source: "cli",
        models: [{ model: "GPT-4o", totals: { billable_total_tokens: 70 } }],
      },
      {
        source: "api",
        models: [
          { model: "gpt-4o", totals: { billable_total_tokens: 50 } },
          { model: "GPT-4o-mini", totals: { billable_total_tokens: 30 } },
        ],
      },
    ],
  };

  assert.equal(typeof buildTopModels, "function");

  const topModels = buildTopModels(modelBreakdown, { limit: 3 });

  assert.equal(topModels.length, 2);
  assert.equal(topModels[0].id, "gpt-4o");
  assert.equal(topModels[0].name, "GPT-4o");
  assert.equal(topModels[0].percent, "80.0");
  assert.equal(topModels[1].id, "gpt-4o-mini");
  assert.equal(topModels[1].percent, "20.0");
});

test("buildTopModels computes percent using billable tokens across all models", async () => {
  const mod = await loadDashboardModule("dashboard/src/lib/model-breakdown.ts");
  const buildTopModels = mod.buildTopModels;

  const modelBreakdown = {
    sources: [
      {
        source: "cli",
        models: [
          { model: "legacy-model", totals: { billable_total_tokens: 20, total_tokens: 999 } },
        ],
      },
      {
        source: "api",
        models: [{ model: "GPT-4o", totals: { billable_total_tokens: 80, total_tokens: 999 } }],
      },
    ],
  };

  const topModels = buildTopModels(modelBreakdown, { limit: 1 });

  assert.equal(topModels.length, 1);
  assert.equal(topModels[0].id, "gpt-4o");
  assert.equal(topModels[0].percent, "80.0");
});

test("Cursor display data falls back to total tokens when billable tokens are zero", async () => {
  const mod = await loadDashboardModule("dashboard/src/lib/model-breakdown.ts");
  const { buildFleetData, buildTopModels, resolveDisplayTokens } = mod;

  const modelBreakdown = {
    sources: [
      {
        source: "cursor",
        totals: {
          total_tokens: 12345,
          billable_total_tokens: 0,
          total_cost_usd: "0.165051",
        },
        models: [
          {
            model: "auto",
            model_id: "auto",
            totals: {
              total_tokens: 12345,
              billable_total_tokens: 0,
            },
          },
        ],
      },
    ],
  };

  assert.equal(resolveDisplayTokens(modelBreakdown.sources[0].totals), 12345);

  const fleetData = buildFleetData(modelBreakdown);
  assert.equal(fleetData.length, 1);
  assert.equal(fleetData[0].source, "cursor");
  assert.equal(fleetData[0].usage, 12345);
  assert.equal(fleetData[0].models.length, 1);
  assert.equal(fleetData[0].models[0].usage, 12345);

  const topModels = buildTopModels(modelBreakdown, { limit: 3 });
  assert.equal(topModels.length, 1);
  assert.equal(topModels[0].id, "auto");
  assert.equal(topModels[0].tokens, 12345);
});

// ─────────────────────────────────────────────────────────────────────────────
// TASK-007: Kiro pricing in local-api MODEL_PRICING + byte-equivalence with
// dashboard/edge-patches/tokentracker-leaderboard-refresh.ts.
// ─────────────────────────────────────────────────────────────────────────────

test("getModelPricing returns non-zero rates for kiro-agent and kiro-cli-agent", () => {
  const kiroAgent = localApi.getModelPricing("kiro-agent");
  const kiroCliAgent = localApi.getModelPricing("kiro-cli-agent");
  assert.ok(kiroAgent.input > 0, "kiro-agent must price non-zero input");
  assert.ok(kiroAgent.output > 0, "kiro-agent must price non-zero output");
  assert.ok(kiroCliAgent.input > 0, "kiro-cli-agent must price non-zero input");
  assert.ok(kiroCliAgent.output > 0, "kiro-cli-agent must price non-zero output");
});

test("getModelPricing fuzzy-matches unknown kiro-* strings to non-zero", () => {
  const unknown = localApi.getModelPricing("kiro-future-model-xyz");
  assert.ok(unknown.input > 0, "fuzzy rule must catch kiro-* prefix");
  assert.ok(unknown.output > 0, "fuzzy rule must catch kiro-* prefix");
});

test("computeRowCost on kiro-cli-agent row is non-zero and matches claude-sonnet-4 rate", () => {
  const row = {
    model: "kiro-cli-agent",
    input_tokens: 1000,
    output_tokens: 500,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
  };
  const cost = localApi.computeRowCost(row);
  assert.ok(cost > 0, "kiro-cli-agent row must have non-zero cost");

  const sonnetCost = localApi.computeRowCost({ ...row, model: "claude-sonnet-4-6" });
  assert.equal(
    cost,
    sonnetCost,
    "kiro-cli-agent rate MUST equal claude-sonnet-4-6 (documented decision: Kiro routes through Bedrock sonnet)",
  );
});

test("computeRowCost on Codex row matches ccusage-style math on a cache-heavy turn", () => {
  // Anchor: a realistic gpt-5.4 turn where the prompt is 95% cached.
  // ccusage-equivalent formula (non_cached = input - cached, reasoning folded
  // into output) is the source of truth here; our schema stores input as
  // pre-subtracted non-cached, so the stored row looks like this:
  const row = {
    source: "codex",
    model: "gpt-5.4",
    input_tokens: 50_000, // non-cached (950_000 cached already removed upstream)
    cached_input_tokens: 950_000,
    cache_creation_input_tokens: 0,
    output_tokens: 10_000,
    reasoning_output_tokens: 4_000, // informational; must NOT be billed again
  };
  const cost = localApi.computeRowCost(row);

  // gpt-5.4: input=$2.50, cache_read=$0.25, output=$15 per 1M.
  // 50_000 * 2.5/1e6   = 0.125
  // 950_000 * 0.25/1e6 = 0.2375
  // 10_000 * 15/1e6    = 0.15
  // reasoning term     = 0  (folded into output_tokens)
  const expected = 0.125 + 0.2375 + 0.15;
  assert.ok(
    Math.abs(cost - expected) < 1e-9,
    `expected ${expected}, got ${cost} (reasoning term must NOT be added for Codex)`,
  );

  // Sanity: if reasoning were double-counted, cost would jump by
  // 4_000 * 15/1e6 = 0.06 — assert we're NOT seeing that.
  assert.ok(cost < expected + 0.01, "reasoning_output_tokens must not be billed on Codex rows");
});

test("computeRowCost still bills reasoning for non-Codex sources (e.g. gemini)", () => {
  // Guard against accidentally dropping the reasoning term for sources where
  // reasoning is not folded into output_tokens. Uses gemini-2.5-pro which has
  // an output rate; a non-zero reasoning bucket must contribute.
  const baseRow = {
    source: "gemini",
    model: "gemini-2.5-pro",
    input_tokens: 1_000,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 1_000,
    reasoning_output_tokens: 0,
  };
  const withoutReasoning = localApi.computeRowCost(baseRow);
  const withReasoning = localApi.computeRowCost({ ...baseRow, reasoning_output_tokens: 5_000 });
  assert.ok(
    withReasoning > withoutReasoning,
    "non-Codex source must still bill reasoning_output_tokens at the output rate",
  );
});

test("pricing covers production MiniMax and DeepSeek model ids used by leaderboard", () => {
  // This test is about the LOOKUP PATH — that these ids resolve at all, and that
  // prefixed/lower-cased variants resolve to the same entry, rather than falling
  // back to ZERO_PRICING. It deliberately reads the expected rates from the
  // curated table instead of duplicating literals: a copy of the numbers here
  // just means a legitimate price correction fails an unrelated test. The rates
  // themselves are pinned once, in test/curated-expiry.test.js (issue #87).
  const curated = require("../src/lib/pricing/curated-overrides.json").exact;
  const models = ["MiniMax-M2.7", "MiniMax-M2.7-highspeed", "deepseek-v4-flash", "deepseek-v4-pro"];

  for (const model of models) {
    const pricing = localApi.getModelPricing(model);
    assert.ok(
      pricing.input > 0 && pricing.output > 0,
      `${model} must not fall back to zero pricing`,
    );
    for (const field of ["input", "output", "cache_read", "cache_write"]) {
      assert.equal(pricing[field], curated[model][field], `${model}.${field} must match the curated table`);
    }
  }

  // DB rows can arrive with provider/model prefixes or lower-cased aliases.
  assert.deepEqual(localApi.getModelPricing("openrouter/minimax-m2.7"), localApi.getModelPricing("MiniMax-M2.7"));
  assert.deepEqual(localApi.getModelPricing("DeepSeek-V4-Pro"), localApi.getModelPricing("deepseek-v4-pro"));
});

// ─────────────────────────────────────────────────────────────────────────────
// TASK-006: Consumer-boundary test against the REAL grouped shape
// (/functions/tokentracker-usage-model-breakdown) + buildFleetData. The
// buildTopModels assertions are flat-ranker sanity only — buildTopModels
// returns { id, name, tokens, percent } with NO source field.
// ─────────────────────────────────────────────────────────────────────────────

async function writeQueue(queuePath, rows) {
  await fs.promises.writeFile(queuePath, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

async function callModelBreakdown(queuePath, from, to) {
  const handler = localApi.createLocalApiHandler({ queuePath });
  const chunks = [];
  let statusCode = null;
  const urlString = `http://localhost/functions/tokentracker-usage-model-breakdown?from=${from}&to=${to}&tz=UTC`;
  const url = new URL(urlString);
  const req = {
    method: "GET",
    url: url.pathname + url.search,
    headers: { host: "localhost" },
  };
  const res = {
    statusCode: 200,
    setHeader() {},
    writeHead(code) {
      statusCode = code;
    },
    end(body) {
      if (body) chunks.push(body);
    },
    write(chunk) {
      chunks.push(chunk);
    },
  };
  const handled = await handler(req, res, url);
  assert.ok(handled, "model-breakdown endpoint must handle the request");
  const body = chunks.join("");
  return { statusCode: statusCode || res.statusCode, body: JSON.parse(body) };
}

test("merged Kiro source: IDE + CLI rows produce ONE sources[] entry with distinct model rows", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-kirocli-merge-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    const rows = [
      // IDE-origin row
      {
        source: "kiro",
        model: "kiro-agent",
        hour_start: "2026-04-20T10:00:00.000Z",
        input_tokens: 1000,
        output_tokens: 200,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: 1200,
        conversation_count: 1,
      },
      // CLI-origin row (merged source, distinct model)
      {
        source: "kiro",
        model: "kiro-cli-agent",
        hour_start: "2026-04-20T10:30:00.000Z",
        input_tokens: 500,
        output_tokens: 100,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: 600,
        conversation_count: 1,
      },
    ];
    await writeQueue(queuePath, rows);

    const { body } = await callModelBreakdown(queuePath, "2026-04-20", "2026-04-20");

    // Server-side grouped shape
    assert.ok(Array.isArray(body.sources), "response must have sources[] array");
    const kiroSources = body.sources.filter((s) => s.source === "kiro");
    assert.equal(
      kiroSources.length,
      1,
      `exactly ONE kiro source entry expected; got ${kiroSources.length}`,
    );
    const kiro = kiroSources[0];
    assert.equal(kiro.totals.total_tokens, 1800, "total tokens must sum IDE + CLI rows");
    // total_cost_usd MUST be a STRING, not a Number (Swift decoder contract).
    assert.equal(typeof kiro.totals.total_cost_usd, "string");
    // Non-zero cost proves TASK-007 pricing is live (both models priced).
    assert.ok(
      parseFloat(kiro.totals.total_cost_usd) > 0,
      `kiro source total_cost_usd must be > 0 after TASK-007; got ${kiro.totals.total_cost_usd}`,
    );
    const models = kiro.models.map((m) => m.model).sort();
    assert.deepEqual(
      models,
      ["kiro-agent", "kiro-cli-agent"],
      "both IDE and CLI model rows must be preserved under the merged kiro source",
    );

    // Client-side grouped shape via buildFleetData
    const mod = await loadDashboardModule("dashboard/src/lib/model-breakdown.ts");
    const fleet = mod.buildFleetData(body);
    const kiroFleet = fleet.filter((f) => f.label === "KIRO");
    assert.equal(kiroFleet.length, 1, "buildFleetData must return exactly one KIRO entry");
    assert.equal(kiroFleet[0].usage, 1800);
    assert.equal(kiroFleet[0].models.length, 2);

    // Flat-ranker sanity — buildTopModels has NO source field; assert by name only.
    const top = mod.buildTopModels(body, { limit: 5 });
    const topNames = top.map((t) => t.name);
    assert.ok(topNames.some((n) => /kiro-agent/i.test(n)), "buildTopModels must expose kiro-agent");
    assert.ok(
      topNames.some((n) => /kiro-cli-agent/i.test(n)),
      "buildTopModels must expose kiro-cli-agent",
    );
    // Explicitly document buildTopModels's flat shape: no source attribution.
    for (const entry of top) {
      assert.equal(entry.source, undefined, "buildTopModels entries must NOT expose a .source field");
    }
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("(source, model) collapse: IDE + CLI both resolving to claude-sonnet-4 merge into ONE row", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-kirocli-collapse-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    const rows = [
      {
        source: "kiro",
        model: "claude-sonnet-4-20250514",
        hour_start: "2026-04-20T10:00:00.000Z",
        input_tokens: 1000,
        output_tokens: 200,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: 1200,
        conversation_count: 1,
      },
      {
        source: "kiro",
        model: "claude-sonnet-4-20250514",
        hour_start: "2026-04-20T10:30:00.000Z",
        input_tokens: 500,
        output_tokens: 100,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: 600,
        conversation_count: 1,
      },
    ];
    await writeQueue(queuePath, rows);

    const { body } = await callModelBreakdown(queuePath, "2026-04-20", "2026-04-20");
    const kiro = body.sources.find((s) => s.source === "kiro");
    assert.ok(kiro, "kiro source must exist");
    assert.equal(
      kiro.models.length,
      1,
      "identical (source, model) rows must collapse to ONE entry — intended merge behavior",
    );
    assert.equal(kiro.models[0].totals.total_tokens, 1800);

    // buildFleetData mirrors the server collapse
    const mod = await loadDashboardModule("dashboard/src/lib/model-breakdown.ts");
    const fleet = mod.buildFleetData(body);
    const kiroFleet = fleet.find((f) => f.label === "KIRO");
    assert.equal(kiroFleet.models.length, 1);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("buildFleetData treats GLM flash models with zero cost as known-zero-cost, not missing pricing", async () => {
  const mod = await loadDashboardModule("dashboard/src/lib/model-breakdown.ts");
  const buildFleetData = mod.buildFleetData;

  const modelBreakdown = {
    sources: [
      {
        source: "claude",
        totals: { billable_total_tokens: 3000, total_cost_usd: "0" },
        models: [
          {
            model: "glm-4.7-flash",
            model_id: "glm-4.7-flash",
            totals: { billable_total_tokens: 1000, total_cost_usd: "0" },
          },
          {
            model: "glm-4.5-flash",
            model_id: "glm-4.5-flash",
            totals: { billable_total_tokens: 1000, total_cost_usd: "0" },
          },
          {
            model: "glm-4.7-flashx",
            model_id: "glm-4.7-flashx",
            totals: { billable_total_tokens: 1000, total_cost_usd: "0" },
          },
          {
            model: "mystery-model",
            model_id: "mystery-model",
            totals: { billable_total_tokens: 1000, total_cost_usd: "0" },
          },
        ],
      },
    ],
  };

  const fleetData = buildFleetData(modelBreakdown);
  const models = fleetData[0].models;
  const glm47 = models.find((m) => m.name === "glm-4.7-flash");
  const glm45 = models.find((m) => m.name === "glm-4.5-flash");
  const mystery = models.find((m) => m.name === "mystery-model");
  const flashx = models.find((m) => m.name === "glm-4.7-flashx");

  assert.equal(
    glm47.pricingMissing,
    false,
    "glm-4.7-flash must not be flagged as missing pricing",
  );
  assert.equal(
    glm45.pricingMissing,
    false,
    "glm-4.5-flash must not be flagged as missing pricing",
  );
  assert.equal(
    mystery.pricingMissing,
    true,
    "unknown zero-cost models must still be flagged as missing pricing",
  );

  const missingNames = fleetData[0].missingPricingModels.map((m) => m.name);
  assert.ok(
    !missingNames.includes("glm-4.7-flash"),
    "glm-4.7-flash must not appear in missingPricingModels",
  );
  assert.ok(
    !missingNames.includes("glm-4.5-flash"),
    "glm-4.5-flash must not appear in missingPricingModels",
  );
  assert.ok(
    missingNames.includes("mystery-model"),
    "mystery-model must still appear in missingPricingModels",
  );
  assert.ok(
    flashx.pricingMissing,
    "glm-4.7-flashx is a PAID model — zero cost must be flagged as missing pricing",
  );
  assert.ok(
    missingNames.includes("glm-4.7-flashx"),
    "glm-4.7-flashx must appear in missingPricingModels",
  );
});

test("pricing_tier from the server beats the cost<=0 guess for missing pricing", async () => {
  const mod = await loadDashboardModule("dashboard/src/lib/model-breakdown.ts");
  const { buildFleetData, buildUsageInsights } = mod;

  const modelBreakdown = {
    sources: [
      {
        source: "claude",
        totals: { billable_total_tokens: 3000, total_cost_usd: "5" },
        models: [
          {
            // Costs nothing AND resolved exactly — a genuinely free model, not
            // an unpriced one. The old cost<=0 heuristic flagged this unless the
            // name happened to contain "free".
            model: "vendor-zero-rate",
            model_id: "vendor-zero-rate",
            pricing_tier: "litellm:exact",
            totals: { billable_total_tokens: 1000, total_cost_usd: "0" },
          },
          {
            // Priced, so the heuristic sees nothing wrong — but the price came
            // from a substring match and may belong to a different model.
            model: "acme-9-turbo",
            model_id: "acme-9-turbo",
            pricing_tier: "litellm:fuzzy",
            totals: { billable_total_tokens: 1000, total_cost_usd: "5" },
          },
          {
            model: "brand-new-model",
            model_id: "brand-new-model",
            pricing_tier: "miss",
            totals: { billable_total_tokens: 1000, total_cost_usd: "0" },
          },
          {
            model: "claude-auto-pilot-fable-v1-canary",
            model_id: "claude-auto-pilot-fable-v1-canary",
            pricing_tier: "routed-estimated",
            totals: { billable_total_tokens: 1000, total_cost_usd: "3" },
          },
        ],
      },
    ],
  };

  const [provider] = buildFleetData(modelBreakdown);
  assert.deepEqual(
    provider.missingPricingModels.map((m) => m.name),
    ["brand-new-model"],
    "only a true pricing miss is unpriced",
  );
  assert.deepEqual(
    provider.fuzzyPricingModels.map((m) => m.name),
    ["acme-9-turbo", "claude-auto-pilot-fable-v1-canary"],
    "both substring and routed estimates are surfaced as non-exact pricing",
  );

  const insights = buildUsageInsights(modelBreakdown);
  assert.deepEqual(
    insights.missingPricingModels.map((m) => m.name),
    ["brand-new-model"],
  );
  assert.deepEqual(
    insights.fuzzyPricingModels.map((m) => m.name),
    ["acme-9-turbo", "claude-auto-pilot-fable-v1-canary"],
  );
});

test("dashboard model data keeps Hermes authoritative cost provenance distinct from fuzzy pricing", async () => {
  const mod = await loadDashboardModule("dashboard/src/lib/model-breakdown.ts");
  const { buildFleetData } = mod;
  const [provider] = buildFleetData({
    sources: [
      {
        source: "hermes",
        totals: { billable_total_tokens: 1300, total_cost_usd: "0.012500" },
        models: [{
          model: "logical-gateway-route",
          model_id: "logical-gateway-route",
          pricing_tier: "hermes:actual",
          cost_provenance: "hermes-actual",
          totals: { billable_total_tokens: 1300, total_cost_usd: "0.012500" },
        }],
      },
    ],
  });

  assert.equal(provider.models[0].costProvenance, "hermes-actual");
  assert.equal(provider.models[0].pricingFuzzy, false);
  assert.deepEqual(provider.fuzzyPricingModels, []);
});

test("without pricing_tier the cost<=0 heuristic still applies (older server response)", async () => {
  const mod = await loadDashboardModule("dashboard/src/lib/model-breakdown.ts");
  const { buildFleetData } = mod;

  const [provider] = buildFleetData({
    sources: [
      {
        source: "claude",
        totals: { billable_total_tokens: 1000, total_cost_usd: "0" },
        models: [
          {
            model: "brand-new-model",
            model_id: "brand-new-model",
            totals: { billable_total_tokens: 1000, total_cost_usd: "0" },
          },
        ],
      },
    ],
  });

  assert.deepEqual(provider.missingPricingModels.map((m) => m.name), ["brand-new-model"]);
  assert.deepEqual(provider.fuzzyPricingModels, []);
});

test("an unattributed row still carries the unpriced caveat", async () => {
  const mod = await loadDashboardModule("dashboard/src/lib/model-breakdown.ts");
  const { buildFleetData } = mod;

  // The server excludes the "unknown" placeholder from unpriced_models — that
  // list names models needing a curated price, and a placeholder is not one.
  // The dashboard chip answers a different question: "are these tokens counted
  // at $0?" For an unattributed row they are, so it must still be flagged. On
  // this machine every such row currently has 0 tokens and is dropped earlier,
  // so only a synthesized row exercises the path.
  const [provider] = buildFleetData({
    sources: [
      {
        source: "claude",
        totals: { billable_total_tokens: 2000, total_cost_usd: "5" },
        models: [
          {
            model: "unknown",
            model_id: "unknown",
            pricing_tier: "unattributed",
            totals: { billable_total_tokens: 1000, total_cost_usd: "0" },
          },
          {
            model: "acme-1",
            model_id: "acme-1",
            pricing_tier: "litellm:exact",
            totals: { billable_total_tokens: 1000, total_cost_usd: "5" },
          },
        ],
      },
    ],
  });

  assert.deepEqual(provider.missingPricingModels.map((m) => m.name), ["unknown"]);
  assert.deepEqual(provider.fuzzyPricingModels, []);
});
