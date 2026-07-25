"use strict";

// Conformance fixture for parseCraftIncremental.
//
// Craft writes one JSONL file per session whose FIRST line is a header carrying
// running totals: `{ id, tokenUsage: { inputTokens, outputTokens,
// cacheReadTokens, cacheCreationTokens, totalTokens } }`. The header is
// rewritten in place as the session grows, so the parser contributes deltas.
// That snapshot-vs-cumulative shape is one of the failure classes CLAUDE.md
// records at 1.6-7x magnitude, which is why it is worth a fixture.

const fs = require("node:fs");
const path = require("node:path");

const session = (id, usage) =>
  JSON.stringify({
    id,
    model: "claude-sonnet-5",
    tokenUsage: usage,
  }) + "\n";

module.exports = {
  source: "craft",
  parser: "parseCraftIncremental",
  build(dir) {
    const one = path.join(dir, "session-one.jsonl");
    const two = path.join(dir, "session-two.jsonl");
    fs.writeFileSync(
      one,
      session("craft-session-one", {
        inputTokens: 1200,
        outputTokens: 340,
        cacheReadTokens: 800,
        cacheCreationTokens: 60,
        totalTokens: 2400,
      }),
    );
    // Zero cache columns: a row that omits them must still satisfy the column
    // sum rather than being excused from it.
    fs.writeFileSync(
      two,
      session("craft-session-two", {
        inputTokens: 90,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      }),
    );
    return { sessionFiles: [one, two] };
  },
};
