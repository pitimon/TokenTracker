"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { buildProjectUsageSummary } = require("../src/lib/local-api");

// The panel is where the README's central argument lands, and it was the least
// finished surface in the product: the client had always sent from/to/source/
// limit/timeZone, and the handler read none of them. Pick "24h" and every other
// card narrowed while Projects kept showing all-time totals, with nothing on
// screen saying so.

function fixture({ projectRows = [], queueRows = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-projects-"));
  const queuePath = path.join(dir, "queue.jsonl");
  const projectQueuePath = path.join(dir, "project.queue.jsonl");
  const write = (file, rows) =>
    fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
  write(queuePath, queueRows);
  write(projectQueuePath, projectRows);
  return { queuePath, projectQueuePath };
}

const query = (params = {}) =>
  new URL(`http://localhost/functions/x?${new URLSearchParams(params).toString()}`);

const projectRow = (over = {}) => ({
  project_key: "acme/api",
  project_ref: "https://github.com/acme/api",
  source: "claude",
  hour_start: "2026-05-14T09:00:00.000Z",
  total_tokens: 100,
  ...over,
});

const queueRow = (over = {}) => ({
  source: "claude",
  model: "claude-sonnet-5",
  hour_start: "2026-05-14T09:00:00.000Z",
  total_tokens: 100,
  ...over,
});

const run = (paths, params) => buildProjectUsageSummary({ url: query(params), ...paths });

test("a date window narrows the panel — it used to be ignored entirely", () => {
  const paths = fixture({
    projectRows: [
      projectRow({ hour_start: "2026-05-14T09:00:00.000Z", total_tokens: 100 }),
      projectRow({ hour_start: "2026-05-01T09:00:00.000Z", total_tokens: 900 }),
    ],
  });

  const all = run(paths, {});
  assert.equal(all.entries[0].total_tokens, "1000", "with no window, everything counts");

  const window = run(paths, { from: "2026-05-14", to: "2026-05-14", timeZone: "UTC" });
  assert.equal(
    window.entries[0].total_tokens,
    "100",
    "the older bucket must be excluded, not silently added in",
  );
});

test("an absent bound means no bound, not an empty result", () => {
  // The other range-filtered handlers compare against "" directly, which is
  // safe there because the client always sends both. Here it does not, and
  // `day <= ""` is false for every day — the panel would have gone blank.
  const paths = fixture({ projectRows: [projectRow()] });
  assert.equal(run(paths, { from: "2026-01-01", timeZone: "UTC" }).entries.length, 1);
  assert.equal(run(paths, { to: "2026-12-31", timeZone: "UTC" }).entries.length, 1);
  assert.equal(run(paths, {}).entries.length, 1);
});

test("the source filter is honoured", () => {
  const paths = fixture({
    projectRows: [
      projectRow({ source: "claude", project_key: "acme/api", total_tokens: 100 }),
      projectRow({ source: "codex", project_key: "acme/web", total_tokens: 700 }),
    ],
  });
  const only = run(paths, { source: "codex" });
  assert.equal(only.entries.length, 1);
  assert.equal(only.entries[0].project_key, "acme/web");
});

test("limit truncates AFTER ranking, so it keeps the biggest", () => {
  const paths = fixture({
    projectRows: [
      projectRow({ project_key: "small", total_tokens: 1 }),
      projectRow({ project_key: "big", total_tokens: 900 }),
      projectRow({ project_key: "middle", total_tokens: 50 }),
    ],
  });
  const limited = run(paths, { limit: "2" });
  assert.deepEqual(
    limited.entries.map((e) => e.project_key),
    ["big", "middle"],
  );
});

test("a nonsense limit is ignored rather than emptying the panel", () => {
  const paths = fixture({ projectRows: [projectRow()] });
  for (const limit of ["0", "-3", "abc", ""]) {
    assert.equal(run(paths, { limit }).entries.length, 1, `limit=${JSON.stringify(limit)}`);
  }
});

test("sources with usage but no project attribution are NAMED, not silently dropped", () => {
  // `projectBucketsQueued` exists in 7 parsers. Cursor, Copilot, Zed, Goose and
  // Kiro have no per-repo story at all, and their absence read as "that tool
  // cost nothing here".
  const paths = fixture({
    projectRows: [projectRow({ source: "claude" })],
    queueRows: [
      queueRow({ source: "claude" }),
      queueRow({ source: "cursor" }),
      queueRow({ source: "zed" }),
    ],
  });
  const result = run(paths, {});
  assert.deepEqual(result.unattributed_sources, ["cursor", "zed"]);
  assert.ok(
    !result.unattributed_sources.includes("claude"),
    "a source that IS attributed must not be listed",
  );
});

test("the unattributed list respects the same window as the entries", () => {
  // Otherwise the panel names a tool as unaccounted-for in a window where it
  // contributed nothing, which is its own kind of wrong.
  const paths = fixture({
    projectRows: [projectRow({ hour_start: "2026-05-14T09:00:00.000Z" })],
    queueRows: [
      queueRow({ source: "claude", hour_start: "2026-05-14T09:00:00.000Z" }),
      queueRow({ source: "cursor", hour_start: "2026-01-02T09:00:00.000Z" }),
    ],
  });
  assert.deepEqual(run(paths, {}).unattributed_sources, ["cursor"]);
  assert.deepEqual(
    run(paths, { from: "2026-05-14", to: "2026-05-14", timeZone: "UTC" }).unattributed_sources,
    [],
    "cursor contributed nothing in this window, so it is not unaccounted-for here",
  );
});

test("the per-source fallback is filtered too, not just the project path", () => {
  // With no project rows at all the panel falls back to per-source totals. That
  // path ignored the window as well.
  const paths = fixture({
    queueRows: [
      queueRow({ source: "claude", hour_start: "2026-05-14T09:00:00.000Z", total_tokens: 100 }),
      queueRow({ source: "claude", hour_start: "2026-01-02T09:00:00.000Z", total_tokens: 900 }),
    ],
  });
  assert.equal(run(paths, {}).entries[0].total_tokens, "1000");
  assert.equal(
    run(paths, { from: "2026-05-14", to: "2026-05-14", timeZone: "UTC" }).entries[0].total_tokens,
    "100",
  );
});

test("the fallback still refuses to fabricate a project_ref", () => {
  // `https://${src}.ai` resolves to unrelated domains and was once sent to the
  // dashboard as a clickable href.
  const paths = fixture({ queueRows: [queueRow({ source: "codex" })] });
  assert.equal(run(paths, {}).entries[0].project_ref, "");
});

test("an empty window returns no entries rather than falling back to everything", () => {
  // The dangerous failure here is not an empty panel, it is a panel that
  // quietly shows all-time numbers when the window matched nothing.
  const paths = fixture({
    projectRows: [projectRow({ hour_start: "2026-05-14T09:00:00.000Z", total_tokens: 100 })],
    queueRows: [queueRow({ hour_start: "2026-05-14T09:00:00.000Z", total_tokens: 100 })],
  });
  const result = run(paths, { from: "2026-07-01", to: "2026-07-02", timeZone: "UTC" });
  assert.deepEqual(result.entries, []);
});

// --- Mixed-era rows (#102's stated risk) --------------------------------------
// Legacy `project|source|hour` and new `project|source|model|hour` describe the
// same bucket at different granularity. Summing both double-counts; dropping
// either loses real usage. This is the part of the change that can be wrong in a
// way nobody notices, so it gets the most tests.

const legacyRow = (over = {}) => {
  const row = projectRow(over);
  delete row.model;
  return row;
};

const modelRow = (over = {}) => projectRow({ model: "claude-sonnet-5", ...over });

test("a legacy row and a model row for the same bucket both count, exactly once", () => {
  // The pre-upgrade total is frozen in the legacy row; new usage in that same
  // hour accumulates under the model key. They are different slots on purpose,
  // and the sum is the true total.
  const paths = fixture({
    projectRows: [legacyRow({ total_tokens: 700 }), modelRow({ total_tokens: 300 })],
  });
  const entries = run(paths, {}).entries;
  assert.equal(entries.length, 1, "one repo, one row");
  assert.equal(entries[0].total_tokens, "1000", "700 pre-upgrade + 300 after");
});

test("repeated appends of the SAME key still collapse to the last one", () => {
  // The append-only store writes cumulative totals per bucket, so several rows
  // with one key are normal and only the last is real. Adding model to the key
  // must not break that.
  const paths = fixture({
    projectRows: [
      modelRow({ total_tokens: 100 }),
      modelRow({ total_tokens: 250 }),
      modelRow({ total_tokens: 400 }),
    ],
  });
  assert.equal(run(paths, {}).entries[0].total_tokens, "400");
});

test("two models in one hour are two slots, not one overwriting the other", () => {
  const paths = fixture({
    projectRows: [
      modelRow({ model: "claude-sonnet-5", total_tokens: 100 }),
      modelRow({ model: "claude-opus-5", total_tokens: 40 }),
    ],
  });
  assert.equal(run(paths, {}).entries[0].total_tokens, "140");
});

test("legacy rows repeat-append too, and still collapse", () => {
  // A user who has not synced since the upgrade has only legacy rows, several
  // per bucket. They must not sum.
  const paths = fixture({
    projectRows: [legacyRow({ total_tokens: 100 }), legacyRow({ total_tokens: 900 })],
  });
  assert.equal(run(paths, {}).entries[0].total_tokens, "900");
});

// --- Per-repo cost -------------------------------------------------------------

test("cost is computed per repo, from the model on the row", () => {
  const paths = fixture({
    projectRows: [
      modelRow({
        model: "claude-sonnet-5",
        input_tokens: 1_000_000,
        output_tokens: 0,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: 1_000_000,
      }),
    ],
  });
  const entry = run(paths, {}).entries[0];
  assert.ok(Number(entry.total_cost_usd) > 0, `expected a priced cost, got ${entry.total_cost_usd}`);
  assert.equal(entry.unattributed_tokens, "0");
});

test("a legacy row is UNATTRIBUTED, not a confident $0", () => {
  // The #94 tier doing what it was added for. Pricing a model-less row at zero
  // and folding it into the total would render "recorded before we recorded
  // models" as "this cost nothing".
  const paths = fixture({ projectRows: [legacyRow({ total_tokens: 5000 })] });
  const entry = run(paths, {}).entries[0];
  assert.equal(entry.total_cost_usd, "0.000000");
  assert.equal(entry.unattributed_tokens, "5000", "the tokens must be named as unpriced");
  assert.equal(entry.total_tokens, "5000", "and still counted in the token total");
});

test("a mixed repo reports the priced part and names the rest", () => {
  const paths = fixture({
    projectRows: [
      legacyRow({ total_tokens: 700 }),
      modelRow({
        model: "claude-sonnet-5",
        input_tokens: 1_000_000,
        output_tokens: 0,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: 1_000_000,
      }),
    ],
  });
  const entry = run(paths, {}).entries[0];
  assert.equal(entry.unattributed_tokens, "700");
  assert.ok(Number(entry.total_cost_usd) > 0);
  assert.equal(entry.total_tokens, "1000700");
});
