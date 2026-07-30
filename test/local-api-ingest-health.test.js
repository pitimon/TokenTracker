const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { createLocalApiHandler } = require("../src/lib/local-api");
const {
  detectTranscriptSuppression,
  resetTranscriptSuppressionCache,
} = require("../src/lib/transcript-suppression");

function createRequest({ method = "GET", headers = {} } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = headers;
  process.nextTick(() => req.emit("end"));
  return req;
}

function createResponse() {
  return {
    statusCode: null,
    headers: null,
    body: Buffer.alloc(0),
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk) {
      this.body = chunk ? Buffer.from(chunk) : Buffer.alloc(0);
    },
  };
}

async function getIngestHealth(queuePath) {
  const handler = createLocalApiHandler({ queuePath });
  const req = createRequest();
  const res = createResponse();
  const handled = await handler(
    req,
    res,
    new URL("http://127.0.0.1/functions/tokentracker-ingest-health"),
  );
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  return { raw: res.body.toString("utf8"), data: JSON.parse(res.body.toString("utf8")) };
}

function withEmptyQueue(run) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-ingest-health-"));
  const queuePath = path.join(tmp, "queue.jsonl");
  fs.writeFileSync(queuePath, "", "utf8");
  try {
    return run(queuePath);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test("ingest-health answers with the suppression summary", async () => {
  resetTranscriptSuppressionCache();
  // Prime the module cache so the endpoint reports a known result without the
  // test depending on whatever happens to be running on the machine.
  detectTranscriptSuppression({
    platform: "darwin",
    commandRunner: () => ({
      status: 0,
      error: null,
      stdout: "  4211 /Users/example/.local/bin/claude --model glm-5-turbo --no-session-persistence",
    }),
  });

  try {
    await withEmptyQueue(async (queuePath) => {
      const { data } = await getIngestHealth(queuePath);
      assert.equal(data.transcript_suppressed.checked, true);
      assert.equal(data.transcript_suppressed.count, 1);
      assert.deepEqual(data.transcript_suppressed.models, ["glm-5-turbo"]);
      assert.equal(typeof data.checked_at, "string");
    });
  } finally {
    resetTranscriptSuppressionCache();
  }
});

// The endpoint answers unauthenticated loopback GETs, so its payload is the
// boundary that matters: a pid or a command-line fragment leaving here would be
// readable by anything that can reach the port.
test("ingest-health leaks no pid, argv, or path from the process list", async () => {
  resetTranscriptSuppressionCache();
  detectTranscriptSuppression({
    platform: "darwin",
    commandRunner: () => ({
      status: 0,
      error: null,
      stdout:
        "  4211 /Users/example/.local/bin/claude --model glm-5-turbo"
        + " --no-session-persistence --add-dir /Users/example/private-repo",
    }),
  });

  try {
    await withEmptyQueue(async (queuePath) => {
      const { raw } = await getIngestHealth(queuePath);
      assert.ok(!raw.includes("4211"), "pid must not appear in the response");
      assert.ok(!raw.includes("private-repo"), "no user path may appear in the response");
      assert.ok(!raw.includes("--no-session-persistence"), "no raw argv may appear in the response");
      assert.ok(!raw.includes("/Users/example"), "no home path may appear in the response");
    });
  } finally {
    resetTranscriptSuppressionCache();
  }
});

test("ingest-health distinguishes an unsupported platform from a clean result", async () => {
  resetTranscriptSuppressionCache();
  detectTranscriptSuppression({
    platform: "win32",
    commandRunner: () => {
      throw new Error("ps must not be spawned on win32");
    },
  });

  try {
    await withEmptyQueue(async (queuePath) => {
      const { data } = await getIngestHealth(queuePath);
      assert.equal(data.transcript_suppressed.supported, false);
      assert.equal(data.transcript_suppressed.checked, false);
      assert.equal(data.transcript_suppressed.reason, "unsupported_platform");
    });
  } finally {
    resetTranscriptSuppressionCache();
  }
});
