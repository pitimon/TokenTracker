"use strict";

// Conformance fixture for parseKimiIncremental.
//
// Kimi writes a wire log of JSONL envelopes; only `message.type === "StatusUpdate"`
// carries usage, under `payload.token_usage`, and `payload.message_id` is the
// dedup key. The four token fields arrive already separated — `input_other` is
// non-cached input — so this fixture's job is to hold that mapping still and to
// prove the message_id dedup survives a second parse.

const fs = require("node:fs");
const path = require("node:path");

// Fixed instant so the 30-minute bucket is deterministic rather than whatever
// the clock says when CI runs. Kimi's timestamp is epoch SECONDS, not ms.
const T_SECONDS = Date.parse("2026-05-14T09:12:30.000Z") / 1000;

const statusUpdate = (messageId, usage, atSeconds) =>
  JSON.stringify({
    timestamp: atSeconds,
    message: {
      type: "StatusUpdate",
      payload: { message_id: messageId, token_usage: usage },
    },
  }) + "\n";

module.exports = {
  source: "kimi",
  parser: "parseKimiIncremental",
  build(dir) {
    const wire = path.join(dir, "wire.jsonl");
    fs.writeFileSync(
      wire,
      [
        statusUpdate(
          "kimi-msg-1",
          { input_other: 500, output: 120, input_cache_read: 2000, input_cache_creation: 40 },
          T_SECONDS,
        ),
        // A second message in the same file, and one line the parser must skip
        // rather than choke on.
        JSON.stringify({ message: { type: "Heartbeat" } }) + "\n",
        statusUpdate(
          "kimi-msg-2",
          { input_other: 30, output: 7, input_cache_read: 0, input_cache_creation: 0 },
          T_SECONDS + 60,
        ),
      ].join(""),
    );
    return { wireFiles: [wire], model: "kimi-k2" };
  },
};
