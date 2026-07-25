const assert = require("node:assert/strict");
const { test } = require("node:test");

const { readCappedAvatarBody } = require("../src/lib/local-api");

const CAP = 1024;

// A response whose body records how much of it was actually pulled, so a test can
// tell "refused after reading everything" from "stopped reading".
function response({ chunks = [], contentLength = null } = {}) {
  const pulled = [];
  let index = 0;
  // highWaterMark 0 so nothing is pulled until the reader asks. The default
  // strategy pre-fetches a chunk when the stream is constructed, which would
  // make this stub measure ReadableStream's buffering rather than what the
  // function under test reads.
  const body = new ReadableStream(
    {
      pull(controller) {
        if (index >= chunks.length) {
          controller.close();
          return;
        }
        const chunk = chunks[index++];
        pulled.push(chunk.length);
        controller.enqueue(chunk);
      },
    },
    { highWaterMark: 0 },
  );
  return {
    headers: { get: (name) => (name.toLowerCase() === "content-length" ? contentLength : null) },
    body,
    pulled,
    async arrayBuffer() {
      throw new Error("arrayBuffer() must not be used when a stream is available");
    },
  };
}

const kb = (n, byte = 0x61) => Buffer.alloc(n, byte);

test("a declared content-length over the cap is refused before any body is read", async () => {
  const res = response({ chunks: [kb(64)], contentLength: String(CAP + 1) });
  assert.equal(await readCappedAvatarBody(res, CAP), null);
  assert.deepEqual(res.pulled, [], "the body must not be touched once the claim is over the cap");
});

test("a body that exceeds the cap mid-stream stops the download", async () => {
  // The point of the change. The old code buffered the whole response with
  // arrayBuffer() and only then compared its length, so an oversized image was
  // read into memory in full — and served — with no ceiling.
  const chunks = Array.from({ length: 20 }, () => kb(256));
  const res = response({ chunks });
  assert.equal(await readCappedAvatarBody(res, CAP), null);
  assert.ok(
    res.pulled.length < chunks.length,
    `must stop early, pulled ${res.pulled.length}/${chunks.length} chunks`,
  );
  assert.ok(
    res.pulled.reduce((a, b) => a + b, 0) <= CAP + 256,
    "must not read far past the cap",
  );
});

test("a lying content-length does not get past the byte count", async () => {
  // content-length is a claim the peer makes. Checking it is worth doing because
  // it costs nothing; trusting it is not.
  const res = response({ chunks: [kb(512), kb(512), kb(512)], contentLength: "10" });
  assert.equal(await readCappedAvatarBody(res, CAP), null);
});

test("a body within the cap is returned whole", async () => {
  const res = response({ chunks: [kb(100, 0x61), kb(100, 0x62)], contentLength: "200" });
  const body = await readCappedAvatarBody(res, CAP);
  assert.equal(body.length, 200);
  assert.equal(body.subarray(0, 100).toString(), "a".repeat(100));
  assert.equal(body.subarray(100).toString(), "b".repeat(100));
});

test("a body exactly at the cap is allowed, not off by one", async () => {
  const res = response({ chunks: [kb(CAP)] });
  const body = await readCappedAvatarBody(res, CAP);
  assert.equal(body?.length, CAP);
});

test("a response with no stream is still bounded", async () => {
  // HEAD responses, and any stub without a body, take the buffered path. It has
  // to enforce the same limit rather than fall through.
  const noStream = (bytes) => ({
    headers: { get: () => null },
    body: null,
    async arrayBuffer() {
      return kb(bytes);
    },
  });
  assert.equal(await readCappedAvatarBody(noStream(CAP + 1), CAP), null);
  assert.equal((await readCappedAvatarBody(noStream(10), CAP)).length, 10);
});
