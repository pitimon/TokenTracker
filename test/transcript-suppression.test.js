const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  detectTranscriptSuppression,
  findSuppressedModels,
  resetTranscriptSuppressionCache,
} = require("../src/lib/transcript-suppression");

const CLAUDE = "/Users/example/.local/bin/claude";

function psRunner(lines, { status = 0, error = null } = {}) {
  return () => ({ status, error, stdout: lines.join("\n") });
}

test("finds a suppressed Claude session and reports its model", () => {
  const result = findSuppressedModels([
    `  4211 ${CLAUDE} --output-format stream-json --model glm-5-turbo --no-session-persistence`,
  ]);

  assert.equal(result.count, 1);
  assert.deepEqual(result.models, ["glm-5-turbo"]);
});

test("accepts the --model=value form and deduplicates models", () => {
  const result = findSuppressedModels([
    `  1 ${CLAUDE} --model=glm-5-turbo --no-session-persistence`,
    `  2 ${CLAUDE} --model glm-5-turbo --no-session-persistence`,
    `  3 ${CLAUDE} --model claude-opus-5 --no-session-persistence`,
  ]);

  assert.equal(result.count, 3);
  assert.deepEqual(result.models, ["claude-opus-5", "glm-5-turbo"]);
});

// The flag string appears in the command line of anything that mentions it —
// a grep, an editor, or the shell that is asking this very question. Matching
// on the flag alone would make the check report itself.
test("ignores a non-Claude process whose command line merely contains the flag", () => {
  const result = findSuppressedModels([
    "  99 /bin/zsh -c grep --no-session-persistence /var/log/system.log",
    "  98 /usr/bin/vim notes-about---no-session-persistence.md",
  ]);

  assert.equal(result.count, 0);
  assert.deepEqual(result.models, []);
});

// `ps -o command=` returns one flat string, so an install path containing a
// space is indistinguishable from argv separation. Reading only up to the first
// whitespace would drop this session — and a miss is the exact failure this
// check exists to catch.
test("finds a suppressed session whose binary path contains a space", () => {
  const result = findSuppressedModels([
    "  512 /Users/example/My Tools/claude --model glm-5-turbo --no-session-persistence",
  ]);

  assert.equal(result.count, 1);
  assert.deepEqual(result.models, ["glm-5-turbo"]);
});

test("still rejects a shell whose arguments contain the flag", () => {
  const result = findSuppressedModels([
    "  99 /bin/zsh -c grep --no-session-persistence /var/log/system.log",
    "  98 /usr/local/bin/node /opt/tool/cli.js --no-session-persistence",
  ]);

  assert.equal(result.count, 0);
});

test("ignores a Claude session that does write a transcript", () => {
  const result = findSuppressedModels([
    `  4212 ${CLAUDE} --output-format stream-json --model claude-opus-5`,
  ]);

  assert.equal(result.count, 0);
});

test("counts a suppressed session that specifies no model", () => {
  const result = findSuppressedModels([`  7 ${CLAUDE} --no-session-persistence`]);

  assert.equal(result.count, 1);
  assert.deepEqual(result.models, []);
});

test("does not let arbitrary command-line text escape through the model field", () => {
  const result = findSuppressedModels([
    `  8 ${CLAUDE} --model /Users/example/secret-project/notes.md --no-session-persistence`,
  ]);

  // The path is rejected by the model charset clamp, so the process is counted
  // but nothing path-shaped is returned.
  assert.equal(result.count, 1);
  assert.deepEqual(result.models, []);
});

test("reports unsupported rather than clean on a platform without /bin/ps", () => {
  resetTranscriptSuppressionCache();
  const result = detectTranscriptSuppression({
    platform: "win32",
    commandRunner: () => {
      throw new Error("ps must not be spawned on win32");
    },
    useCache: false,
  });

  assert.equal(result.supported, false);
  assert.equal(result.checked, false);
  assert.equal(result.reason, "unsupported_platform");
  assert.equal(result.count, 0);
});

test("reports not-checked rather than clean when the process list cannot be read", () => {
  resetTranscriptSuppressionCache();
  const result = detectTranscriptSuppression({
    platform: "darwin",
    commandRunner: () => ({ status: 1, stdout: "", error: new Error("EPERM") }),
    useCache: false,
  });

  assert.equal(result.supported, true);
  assert.equal(result.checked, false);
  assert.equal(result.reason, "process_list_failed");
  assert.equal(result.count, 0);
});

test("reports a checked, empty result distinctly from an unchecked one", () => {
  resetTranscriptSuppressionCache();
  const result = detectTranscriptSuppression({
    platform: "darwin",
    commandRunner: psRunner(["  1 /sbin/launchd"]),
    useCache: false,
  });

  assert.equal(result.checked, true);
  assert.equal(result.count, 0);
  assert.equal(result.reason, null);
});

test("serves a cached answer inside the TTL and re-reads after it", () => {
  resetTranscriptSuppressionCache();
  let spawns = 0;
  const commandRunner = (...args) => {
    spawns += 1;
    return psRunner([`  1 ${CLAUDE} --model glm-5-turbo --no-session-persistence`])(...args);
  };
  let ms = Date.parse("2026-07-30T00:00:00.000Z");
  const now = () => new Date(ms);

  detectTranscriptSuppression({ platform: "darwin", commandRunner, now, ttlMs: 30_000 });
  detectTranscriptSuppression({ platform: "darwin", commandRunner, now, ttlMs: 30_000 });
  assert.equal(spawns, 1, "a second call inside the TTL must not spawn ps again");

  ms += 30_001;
  detectTranscriptSuppression({ platform: "darwin", commandRunner, now, ttlMs: 30_000 });
  assert.equal(spawns, 2, "a call past the TTL must re-read the process list");

  resetTranscriptSuppressionCache();
});

test("never returns a pid or a raw command line", () => {
  resetTranscriptSuppressionCache();
  const result = detectTranscriptSuppression({
    platform: "darwin",
    commandRunner: psRunner([
      `  4211 ${CLAUDE} --model glm-5-turbo --no-session-persistence --cwd /Users/example/private-repo`,
    ]),
    useCache: false,
  });

  const serialized = JSON.stringify(result);
  assert.equal(result.count, 1);
  assert.ok(!Object.hasOwn(result, "pid"), "the result must not carry a pid");
  assert.ok(!serialized.includes("4211"), "the pid must not survive serialization");
  assert.ok(!serialized.includes("private-repo"), "no path from the command line may leak");
  assert.ok(!serialized.includes("--no-session-persistence"), "no raw argv may leak");
});
