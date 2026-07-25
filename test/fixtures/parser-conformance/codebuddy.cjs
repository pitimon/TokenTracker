"use strict";

// Conformance fixture for parseCodebuddyIncremental.
//
// CodeBuddy writes JSONL where assistant messages carry `providerData.rawUsage`
// in OpenAI's shape. The load-bearing detail, and the reason this parser is
// worth a fixture at all: **`prompt_tokens` INCLUDES the cached tokens**, so
// `input_tokens` is `prompt_tokens - cache_read`. Getting that wrong
// double-counts cache reads — the cached-input-semantics failure class
// CLAUDE.md records at 1.6-7x magnitude.
//
// The numbers below are chosen so a parser that forgot the subtraction would
// break the column-sum invariant rather than merely be a bit off.

const fs = require("node:fs");
const path = require("node:path");

const assistantMessage = (uuid, tsMs, rawUsage) =>
  JSON.stringify({
    type: "message",
    role: "assistant",
    sessionId: "codebuddy-session-1",
    uuid,
    timestamp: tsMs,
    providerData: { rawUsage },
  }) + "\n";

// Fixed instant, so the 30-minute bucket is deterministic rather than
// whatever the clock says when CI happens to run.
const T = Date.parse("2026-05-14T09:12:30.000Z");

module.exports = {
  source: "codebuddy",
  parser: "parseCodebuddyIncremental",
  build(dir) {
    const log = path.join(dir, "codebuddy-session-1.jsonl");
    fs.writeFileSync(
      log,
      [
        assistantMessage("cb-msg-1", T, {
          // 3000 prompt tokens of which 2400 were cache reads -> 600 real input.
          prompt_tokens: 3000,
          completion_tokens: 250,
          prompt_tokens_details: { cached_tokens: 2400 },
          cache_creation_input_tokens: 100,
        }),
        // A user turn, which carries no usage and must be skipped.
        JSON.stringify({ type: "message", role: "user", uuid: "cb-user-1" }) + "\n",
        assistantMessage("cb-msg-2", T + 60_000, {
          prompt_tokens: 40,
          completion_tokens: 8,
          prompt_tokens_details: {},
        }),
      ].join(""),
    );
    return { projectFiles: [log], defaultModel: "codebuddy-default" };
  },
};
