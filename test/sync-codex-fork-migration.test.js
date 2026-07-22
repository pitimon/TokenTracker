// Acceptance tests for the issue #75 one-time rebuild migration
// (migrateCodexForkOvercountRebuild). The parser fix (PR #77) only corrects
// go-forward parsing; this migration retracts the already-inflated Codex/
// every-code aggregates and forces a clean re-parse so the dashboard read path
// (queue.jsonl / project.queue.jsonl, keep-last per bucket) shows corrected
// numbers. Everything here is strictly local — no network, no cloud.

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  cmdSync,
  migrateCodexForkOvercountRebuild,
  CODEX_FORK_OVERCOUNT_MIGRATION_KEY,
  ROLLOUT_CUMULATIVE_DELTA_MIGRATION_KEY,
} = require("../src/commands/sync");

async function makeTempDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "tt-fork-mig-"));
}

// keep-last per source|model|hour_start — mirrors local-api.js readQueueData.
function keepLastQueue(text) {
  const seen = new Map();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    seen.set(`${r.source}|${r.model}|${r.hour_start}`, r);
  }
  return Array.from(seen.values());
}
// keep-last per project_key|source|hour_start — mirrors readProjectQueueData.
function keepLastProjectQueue(text) {
  const seen = new Map();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    seen.set(`${r.project_key || ""}|${r.source || ""}|${r.hour_start || ""}`, r);
  }
  return Array.from(seen.values());
}

// --- unit: direct migration call ------------------------------------------

describe("migrateCodexForkOvercountRebuild", () => {
  it("retracts codex/every-code hourly + project buckets and file cursors, leaves other providers untouched", async () => {
    const dir = await makeTempDir();
    try {
      const queuePath = path.join(dir, "queue.jsonl");
      const projectQueuePath = path.join(dir, "project.queue.jsonl");
      const codexPath = path.join(dir, ".codex", "sessions", "rollout-codex.jsonl");
      const everyCodePath = path.join(dir, ".code", "sessions", "rollout-every.jsonl");
      const claudePath = path.join(dir, ".claude", "projects", "session.jsonl");

      const cursors = {
        files: {
          [codexPath]: { offset: 100, codexFork: "child" },
          [everyCodePath]: { offset: 200 },
          [claudePath]: { offset: 300 },
        },
        hourly: {
          groupQueued: {
            "codex|2026-07-01T00:00:00.000Z": "old-codex",
            "every-code|2026-07-01T00:30:00.000Z": "old-every",
            "claude|2026-07-01T00:00:00.000Z": "old-claude",
          },
          buckets: {
            "codex|gpt-5.5|2026-07-01T00:00:00.000Z": { totals: { total_tokens: 9_000_000, cached_input_tokens: 8_000_000 } },
            "every-code|gpt-5.5|2026-07-01T00:30:00.000Z": { totals: { total_tokens: 50 } },
            "claude|opus|2026-07-01T00:00:00.000Z": { totals: { total_tokens: 25 } },
          },
        },
        projectHourly: {
          buckets: {
            "proj-a|codex|2026-07-01T00:00:00.000Z": {
              totals: { total_tokens: 9_000_000, cached_input_tokens: 8_000_000 },
              project_ref: "github.com/x/a",
              project_key: "proj-a",
              source: "codex",
              hour_start: "2026-07-01T00:00:00.000Z",
            },
            "proj-b|claude|2026-07-01T00:00:00.000Z": {
              totals: { total_tokens: 25 },
              project_ref: "github.com/x/b",
              project_key: "proj-b",
              source: "claude",
              hour_start: "2026-07-01T00:00:00.000Z",
            },
          },
        },
      };

      await migrateCodexForkOvercountRebuild({
        cursors,
        queuePath,
        projectQueuePath,
        rolloutFiles: [
          { path: codexPath, source: "codex" },
          { path: everyCodePath, source: "every-code" },
        ],
      });

      // file cursors: codex/every-code dropped, claude kept.
      assert.equal(cursors.files[codexPath], undefined);
      assert.equal(cursors.files[everyCodePath], undefined);
      assert.equal(cursors.files[claudePath].offset, 300);

      // hourly buckets: codex/every-code deleted, claude untouched.
      assert.equal(cursors.hourly.buckets["codex|gpt-5.5|2026-07-01T00:00:00.000Z"], undefined);
      assert.equal(cursors.hourly.buckets["every-code|gpt-5.5|2026-07-01T00:30:00.000Z"], undefined);
      assert.ok(cursors.hourly.buckets["claude|opus|2026-07-01T00:00:00.000Z"]);
      assert.equal(cursors.hourly.buckets["claude|opus|2026-07-01T00:00:00.000Z"].totals.total_tokens, 25);

      // groupQueued: codex/every-code cleared, claude kept.
      assert.equal(cursors.hourly.groupQueued["codex|2026-07-01T00:00:00.000Z"], undefined);
      assert.equal(cursors.hourly.groupQueued["every-code|2026-07-01T00:30:00.000Z"], undefined);
      assert.equal(cursors.hourly.groupQueued["claude|2026-07-01T00:00:00.000Z"], "old-claude");

      // project accumulator buckets: codex reset, claude untouched.
      assert.equal(cursors.projectHourly.buckets["proj-a|codex|2026-07-01T00:00:00.000Z"], undefined);
      assert.ok(cursors.projectHourly.buckets["proj-b|claude|2026-07-01T00:00:00.000Z"]);

      assert.ok(cursors.migrations[CODEX_FORK_OVERCOUNT_MIGRATION_KEY]);

      // queue.jsonl: exactly two zero-retraction rows (codex + every-code).
      const qRows = keepLastQueue(await fs.readFile(queuePath, "utf8"));
      assert.deepEqual(
        qRows.map((r) => `${r.source}|${r.model}|${r.total_tokens}|${r.cached_input_tokens}`).sort(),
        ["codex|gpt-5.5|0|0", "every-code|gpt-5.5|0|0"],
      );

      // project.queue.jsonl is NOT written — the migration never zeroes project
      // rows (conservative: files still on disk rebuild via re-parse; orphaned
      // ones keep their prior value rather than losing it). No file created.
      assert.equal(
        await fs.access(projectQueuePath).then(() => true).catch(() => false),
        false,
        "migration must not write project.queue.jsonl",
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("does not zero an orphaned codex project bucket — its queue row is preserved (no loss)", async () => {
    const dir = await makeTempDir();
    try {
      const queuePath = path.join(dir, "queue.jsonl");
      const projectQueuePath = path.join(dir, "project.queue.jsonl");
      // A codex project bucket whose session file is no longer on disk (absent
      // from rolloutFiles) — the loss-mode the review flagged. Its prior queue
      // row (possibly fork-inflated) must survive rather than be zeroed, since
      // it can no longer be recomputed.
      const orphanRow = {
        project_ref: "github.com/x/orphan",
        project_key: "proj-orphan",
        source: "codex",
        hour_start: "2026-07-01T00:00:00.000Z",
        input_tokens: 500,
        cached_input_tokens: 9_000_000,
        cache_creation_input_tokens: 0,
        output_tokens: 40,
        reasoning_output_tokens: 0,
        total_tokens: 9_000_540,
        billable_total_tokens: 9_000_540,
        conversation_count: 3,
      };
      const geminiRow = { ...orphanRow, project_key: "proj-g", project_ref: "github.com/x/g", source: "gemini", total_tokens: 7 };
      const existingQueue = [JSON.stringify(orphanRow), JSON.stringify(geminiRow)].join("\n") + "\n";
      await fs.writeFile(projectQueuePath, existingQueue, "utf8");

      const cursors = {
        files: {},
        hourly: { buckets: {} },
        projectHourly: {
          buckets: {
            "proj-orphan|codex|2026-07-01T00:00:00.000Z": {
              totals: { total_tokens: 9_000_540, cached_input_tokens: 9_000_000 },
              project_ref: "github.com/x/orphan",
              project_key: "proj-orphan",
              source: "codex",
              hour_start: "2026-07-01T00:00:00.000Z",
            },
          },
        },
      };

      await migrateCodexForkOvercountRebuild({
        cursors,
        queuePath,
        projectQueuePath,
        rolloutFiles: [], // orphan: the file backing the bucket is gone
      });

      // Accumulator bucket is reset (so a returning file can't double-count)...
      assert.equal(cursors.projectHourly.buckets["proj-orphan|codex|2026-07-01T00:00:00.000Z"], undefined);
      // ...but project.queue.jsonl is byte-identical — nothing zeroed, no loss.
      assert.equal(await fs.readFile(projectQueuePath, "utf8"), existingQueue);
      const pRows = keepLastProjectQueue(existingQueue);
      assert.equal(pRows.find((r) => r.project_key === "proj-orphan").total_tokens, 9_000_540);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("is idempotent — the sentinel blocks a second run", async () => {
    const dir = await makeTempDir();
    try {
      const queuePath = path.join(dir, "queue.jsonl");
      const projectQueuePath = path.join(dir, "project.queue.jsonl");
      const cursors = {
        files: {},
        hourly: { buckets: { "codex|gpt-5.5|2026-07-01T00:00:00.000Z": { totals: { total_tokens: 1 } } } },
        projectHourly: { buckets: {} },
      };
      await migrateCodexForkOvercountRebuild({ cursors, queuePath, projectQueuePath, rolloutFiles: [] });
      const firstSize = (await fs.readFile(queuePath, "utf8")).length;

      // Re-add an inflated bucket; the sentinel must prevent re-retraction.
      cursors.hourly.buckets["codex|gpt-5.5|2026-07-02T00:00:00.000Z"] = { totals: { total_tokens: 999 } };
      await migrateCodexForkOvercountRebuild({ cursors, queuePath, projectQueuePath, rolloutFiles: [] });
      const secondSize = (await fs.readFile(queuePath, "utf8")).length;

      assert.equal(secondSize, firstSize);
      assert.ok(cursors.hourly.buckets["codex|gpt-5.5|2026-07-02T00:00:00.000Z"]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

// --- end to end: cmdSync corrects the dashboard read path, no network ------

describe("codex fork overcount rebuild — end to end (no network)", () => {
  it("cmdSync migrates inflated codex history and re-parses child-only, leaving other providers untouched", async () => {
    const dir = await makeTempDir();
    const prevHome = process.env.HOME;
    const prevToken = process.env.TOKENTRACKER_DEVICE_TOKEN;
    const prevCodexHome = process.env.CODEX_HOME;
    const realFetch = global.fetch;
    let networkCalls = 0;
    try {
      process.env.HOME = dir;
      delete process.env.TOKENTRACKER_DEVICE_TOKEN;
      process.env.CODEX_HOME = path.join(dir, ".codex");
      // Fail loudly on any network access — proves the local-only requirement.
      global.fetch = (...args) => {
        networkCalls += 1;
        return Promise.reject(new Error(`unexpected network call: ${args[0]}`));
      };

      // A real-shaped subagent fork rollout: session_meta(thread_spawn) + replay
      // (cumulative climbing) + boundary + two genuine child turns.
      const u = (i, c, o) => ({
        input_tokens: i,
        cached_input_tokens: c,
        output_tokens: o,
        reasoning_output_tokens: 0,
        total_tokens: i + o,
      });
      const tc = (ts, last, cum) =>
        JSON.stringify({
          type: "event_msg",
          timestamp: ts,
          payload: { type: "token_count", info: { last_token_usage: last, total_token_usage: cum } },
        });
      const forkDoc = [
        JSON.stringify({
          type: "session_meta",
          timestamp: "2026-07-20T10:51:35.000Z",
          payload: {
            id: "child-1",
            cwd: dir,
            model: "gpt-5.5",
            model_provider: "openai",
            source: { subagent: { thread_spawn: { parent_thread_id: "p", depth: 1 } } },
          },
        }),
        JSON.stringify({ type: "turn_context", timestamp: "2026-07-20T10:51:36.000Z", payload: { model: "gpt-5.5" } }),
        tc("2026-07-20T10:51:40.000Z", u(100, 90, 10), u(100, 90, 10)),
        tc("2026-07-20T10:51:50.000Z", u(300, 280, 30), u(600, 560, 60)),
        JSON.stringify({
          type: "inter_agent_communication_metadata",
          timestamp: "2026-07-20T10:52:00.000Z",
          payload: { trigger_turn: true },
        }),
        tc("2026-07-20T10:52:05.000Z", u(50, 40, 10), u(650, 600, 70)),
        tc("2026-07-20T10:52:10.000Z", u(50, 40, 20), u(700, 640, 90)),
      ].join("\n") + "\n";

      const rolloutPath = path.join(dir, ".codex", "sessions", "2026", "07", "20", "rollout-child-1.jsonl");
      await fs.mkdir(path.dirname(rolloutPath), { recursive: true });
      await fs.writeFile(rolloutPath, forkDoc, "utf8");

      // Seed inflated state as if the buggy parser had already ingested it:
      // file cursor at EOF (so it would never be re-read without the migration),
      // an inflated hourly bucket, matching inflated queue rows, plus an
      // untouched non-codex (claude) row that must survive verbatim.
      const trackerDir = path.join(dir, ".tokentracker", "tracker");
      await fs.mkdir(trackerDir, { recursive: true });
      const eof = Buffer.byteLength(forkDoc, "utf8");
      const cursorsPath = path.join(trackerDir, "cursors.json");
      const queuePath = path.join(trackerDir, "queue.jsonl");
      const hourStart = "2026-07-20T10:30:00.000Z";
      await fs.writeFile(
        cursorsPath,
        JSON.stringify({
          version: 1,
          // Pre-set the earlier migration's sentinel so ONLY the #75 rebuild runs.
          migrations: { [ROLLOUT_CUMULATIVE_DELTA_MIGRATION_KEY]: "2026-05-01T00:00:00.000Z" },
          files: { [rolloutPath]: { inode: 0, offset: eof, lastTotal: null, head: "seed" } },
          hourly: {
            version: 3,
            buckets: {
              [`codex|gpt-5.5|${hourStart}`]: {
                totals: {
                  input_tokens: 200_000,
                  cached_input_tokens: 8_000_000,
                  cache_creation_input_tokens: 0,
                  output_tokens: 60,
                  reasoning_output_tokens: 0,
                  total_tokens: 8_200_060,
                  billable_total_tokens: 8_200_060,
                  conversation_count: 5,
                },
              },
            },
          },
        }),
        "utf8",
      );
      const inflatedCodexRow = {
        source: "codex",
        model: "gpt-5.5",
        hour_start: hourStart,
        input_tokens: 200_000,
        cached_input_tokens: 8_000_000,
        cache_creation_input_tokens: 0,
        output_tokens: 60,
        reasoning_output_tokens: 0,
        total_tokens: 8_200_060,
        billable_total_tokens: 8_200_060,
        conversation_count: 5,
      };
      const otherRow = {
        source: "gemini",
        model: "gemini-2.5-pro",
        hour_start: hourStart,
        input_tokens: 111,
        cached_input_tokens: 222,
        cache_creation_input_tokens: 0,
        output_tokens: 333,
        reasoning_output_tokens: 0,
        total_tokens: 666,
        billable_total_tokens: 666,
        conversation_count: 3,
      };
      await fs.writeFile(
        queuePath,
        [JSON.stringify(inflatedCodexRow), JSON.stringify(otherRow)].join("\n") + "\n",
        "utf8",
      );

      await cmdSync(["--auto"]);

      assert.equal(networkCalls, 0, "sync must complete with zero network calls");

      const finalQueue = keepLastQueue(await fs.readFile(queuePath, "utf8"));
      const codex = finalQueue.find((r) => r.source === "codex");
      const other = finalQueue.find((r) => r.source === "gemini");

      // Codex is now child-only: cached 80, total 130 (the ~8M replay is gone).
      assert.ok(codex, "a corrected codex row must exist");
      assert.equal(codex.cached_input_tokens, 80);
      assert.equal(codex.total_tokens, 130);

      // The non-codex row is byte-identical — the migration never touched it.
      assert.deepEqual(other, otherRow);

      // The migration sentinel is recorded so it never runs again.
      const finalCursors = JSON.parse(await fs.readFile(cursorsPath, "utf8"));
      assert.ok(finalCursors.migrations[CODEX_FORK_OVERCOUNT_MIGRATION_KEY]);
    } finally {
      global.fetch = realFetch;
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      if (prevToken === undefined) delete process.env.TOKENTRACKER_DEVICE_TOKEN;
      else process.env.TOKENTRACKER_DEVICE_TOKEN = prevToken;
      if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = prevCodexHome;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
