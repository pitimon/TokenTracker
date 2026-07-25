const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const SCAN_DIRS = ["src", "dashboard/src", "scripts"];
const EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".cjs", ".mjs", ".json", ".md"]);
const NUL = String.fromCharCode(0);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      walk(full, out);
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

// `src/lib/skills-manager.js` carried two raw U+0000 bytes inside what were meant
// to be `\0` escapes. Runtime-identical — but a raw NUL flips a file to "binary"
// for grep and ripgrep, which then report NOTHING and exit as if they had
// searched it. Every grep-based audit silently skipped the one file that does the
// server-side GitHub traffic, and three separate searches during a privacy audit
// came back empty while the content was plainly there.
//
// Whether that was an accident or a deliberate probe, it is exactly how a host
// would be hidden from a human reviewer. `scripts/validate-outbound.cjs` reads
// with Node and was never fooled; people and their tools were.
test("no source file contains a raw NUL byte", () => {
  const offenders = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(path.join(ROOT, dir))) {
      const content = fs.readFileSync(file, "utf8");
      if (!content.includes(NUL)) continue;
      const lines = content
        .split("\n")
        .map((line, index) => (line.includes(NUL) ? index + 1 : null))
        .filter(Boolean);
      offenders.push(`${path.relative(ROOT, file)}:${lines.join(",")}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `raw NUL bytes make a file invisible to grep — write the two-character escape \\0 instead: ${offenders.join(" ")}`,
  );
});
