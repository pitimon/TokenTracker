"use strict";

// The writer half of #102's mixed-era risk. The reader half is in
// test/project-usage-filters.test.js; this covers what happens to the bucket
// state carried in cursors.json when the key gains a model.

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  projectBucketKey,
  migrateProjectBucketsToModelKey,
  normalizeProjectState,
  PROJECT_MODEL_UNATTRIBUTED,
} = require("../src/lib/rollout");

const LEGACY_KEY = "acme/api|claude|2026-05-14T09:00:00.000Z";
const legacyState = () => ({
  version: 2,
  buckets: {
    [LEGACY_KEY]: {
      totals: { total_tokens: 700, input_tokens: 700 },
      queuedKey: "x",
      project_key: "acme/api",
      project_ref: "https://github.com/acme/api",
      source: "claude",
      hour_start: "2026-05-14T09:00:00.000Z",
    },
  },
  projects: {},
});

test("the key gains a model, and a missing one is the unattributed slot", () => {
  assert.equal(
    projectBucketKey("acme/api", "claude", "claude-sonnet-5", "2026-05-14T09:00:00.000Z"),
    "acme/api|claude|claude-sonnet-5|2026-05-14T09:00:00.000Z",
  );
  assert.equal(
    projectBucketKey("acme/api", "claude", null, "2026-05-14T09:00:00.000Z"),
    `acme/api|claude|${PROJECT_MODEL_UNATTRIBUTED}|2026-05-14T09:00:00.000Z`,
  );
});

test("a stranded pre-model bucket is re-keyed rather than left behind", () => {
  // Left behind, its key never matches again: new usage in that hour starts from
  // zero under the model key while the reader still sees the old row, and the
  // two sum to more than really happened.
  const state = legacyState();
  assert.equal(migrateProjectBucketsToModelKey(state), 1);
  assert.deepEqual(Object.keys(state.buckets), [
    `acme/api|claude|${PROJECT_MODEL_UNATTRIBUTED}|2026-05-14T09:00:00.000Z`,
  ]);
});

test("the running total survives the re-key — nothing is reset", () => {
  const state = legacyState();
  migrateProjectBucketsToModelKey(state);
  const bucket = Object.values(state.buckets)[0];
  assert.equal(bucket.totals.total_tokens, 700, "the pre-upgrade total must carry over");
  assert.equal(bucket.model, PROJECT_MODEL_UNATTRIBUTED);
  assert.equal(bucket.project_ref, "https://github.com/acme/api");
  assert.equal(bucket.queuedKey, "x", "the dedup marker must survive, or the row re-appends");
});

test("running it twice changes nothing", () => {
  // It runs on every normalizeProjectState, which is every sync.
  const state = legacyState();
  migrateProjectBucketsToModelKey(state);
  const after = JSON.stringify(state.buckets);
  assert.equal(migrateProjectBucketsToModelKey(state), 0);
  assert.equal(JSON.stringify(state.buckets), after);
});

test("a model-keyed bucket is left alone", () => {
  const state = {
    buckets: {
      "acme/api|claude|claude-sonnet-5|2026-05-14T09:00:00.000Z": { totals: {}, model: "claude-sonnet-5" },
    },
  };
  const before = JSON.stringify(state.buckets);
  assert.equal(migrateProjectBucketsToModelKey(state), 0);
  assert.equal(JSON.stringify(state.buckets), before);
});

test("an existing unattributed bucket is not clobbered by the migration", () => {
  // Both keys present at once should not silently discard the newer one.
  const state = legacyState();
  const targetKey = `acme/api|claude|${PROJECT_MODEL_UNATTRIBUTED}|2026-05-14T09:00:00.000Z`;
  state.buckets[targetKey] = { totals: { total_tokens: 42 }, model: PROJECT_MODEL_UNATTRIBUTED };
  migrateProjectBucketsToModelKey(state);
  assert.equal(state.buckets[targetKey].totals.total_tokens, 42, "the existing bucket wins");
  assert.ok(state.buckets[LEGACY_KEY], "and the legacy one is left for a human to look at");
});

test("normalizeProjectState runs the migration and bumps the version", () => {
  const state = normalizeProjectState(legacyState());
  assert.equal(state.version, 3);
  assert.deepEqual(Object.keys(state.buckets), [
    `acme/api|claude|${PROJECT_MODEL_UNATTRIBUTED}|2026-05-14T09:00:00.000Z`,
  ]);
});

test("garbage state does not throw", () => {
  for (const raw of [null, undefined, {}, { buckets: null }, { buckets: "nope" }]) {
    assert.equal(migrateProjectBucketsToModelKey(raw), 0);
  }
});
