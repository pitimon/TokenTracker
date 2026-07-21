const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");

const {
  buildBrowserOpenErrorMessage,
  spawnBrowserCommand,
} = require("../src/lib/browser-open");

test("browser open warning includes manual URL and Linux xdg-utils fix", () => {
  const message = buildBrowserOpenErrorMessage({
    url: "http://127.0.0.1:7680",
    command: "xdg-open",
    error: { code: "ENOENT" },
    platform: "linux",
  });

  assert.match(message, /Could not open browser automatically: xdg-open not found/);
  assert.match(message, /Open manually: http:\/\/127\.0\.0\.1:7680/);
  assert.match(message, /sudo apt install -y xdg-utils/);
});

test("spawnBrowserCommand handles async spawn errors as warnings", async () => {
  const child = new EventEmitter();
  child.unref = () => {};
  const writes = [];

  const result = spawnBrowserCommand("xdg-open", ["http://127.0.0.1:7680"], {
    url: "http://127.0.0.1:7680",
    platform: "linux",
    stderr: { write: (chunk) => writes.push(String(chunk)) },
    spawn: () => child,
  });

  assert.equal(result, child);
  child.emit("error", { code: "ENOENT" });

  assert.equal(writes.length, 1);
  assert.match(writes[0], /xdg-open not found/);
});
