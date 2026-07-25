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
