const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { createLocalApiHandler } = require("../src/lib/local-api");

async function callDaily(queuePath, day) {
  const handler = createLocalApiHandler({ queuePath });
  const url = new URL(
    `http://127.0.0.1/functions/tokentracker-usage-daily?from=${day}&to=${day}&tz=UTC`,
  );
  const req = { method: "GET", headers: { host: "127.0.0.1" } };
  const response = {
    statusCode: null,
    body: "",
    writeHead(statusCode) { this.statusCode = statusCode; },
    end(chunk) { this.body += chunk || ""; },
  };
  const handled = await handler(req, response, url);
  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  return JSON.parse(response.body);
}

test("daily API keeps the canonical appended Hermes correction after an uploaded legacy row", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-hermes-reconciliation-api-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    const hourStart = "2026-04-21T00:00:00.000Z";
    const legacy = {
      source: "hermes",
      model: "gpt-5.6-sol",
      hour_start: hourStart,
      input_tokens: 1000,
      cached_input_tokens: 500,
      cache_creation_input_tokens: 20,
      output_tokens: 100,
      reasoning_output_tokens: 30,
      total_tokens: 1650,
      billable_total_tokens: 1650,
      conversation_count: 10,
    };
    const solCorrection = {
      ...legacy,
      input_tokens: 700,
      cached_input_tokens: 350,
      cache_creation_input_tokens: 10,
      output_tokens: 70,
      reasoning_output_tokens: 20,
      total_tokens: 1150,
      billable_total_tokens: 1150,
      conversation_count: 7,
    };
    const terraCorrection = {
      source: "hermes",
      model: "gpt-5.6-terra",
      hour_start: hourStart,
      input_tokens: 300,
      cached_input_tokens: 150,
      cache_creation_input_tokens: 10,
      output_tokens: 30,
      reasoning_output_tokens: 10,
      total_tokens: 500,
      billable_total_tokens: 500,
      conversation_count: 3,
    };
    const legacyLine = `${JSON.stringify(legacy)}\n`;
    const queueState = { offset: Buffer.byteLength(legacyLine, "utf8") };
    const tail = `${JSON.stringify(solCorrection)}\n${JSON.stringify(terraCorrection)}\n`;
    await fs.writeFile(queuePath, legacyLine + tail, "utf8");

    const uploadableRows = (await fs.readFile(queuePath, "utf8"))
      .slice(queueState.offset)
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      uploadableRows.map((row) => row.model),
      ["gpt-5.6-sol", "gpt-5.6-terra"],
      "a consumed offset starts exactly before corrective latest-wins rows",
    );

    const daily = await callDaily(queuePath, "2026-04-21");
    assert.equal(daily.data.length, 1);
    assert.equal(daily.data[0].total_tokens, 1650, "the correction conserves the historical day total");
    assert.equal(daily.data[0].conversation_count, 10);
    assert.deepEqual(daily.data[0].models, {
      "gpt-5.6-sol": 1150,
      "gpt-5.6-terra": 500,
    });
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
