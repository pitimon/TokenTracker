// Checks that every external host reachable from this codebase is declared in
// outbound-hosts.json, and that the README's privacy table names the ones that
// carry user data.
//
// Why this exists: the README's outbound-call table is the product's
// highest-stakes claim, and until now it was maintained by hand. The audit that
// wrote it grepped `src/` and never `dashboard/src/`, so it missed four
// browser-side disclosures — including one that put the name of a repository
// you have checked out, private ones included, in a request URL to GitHub
// (#100). The claim was researched. It just wasn't researched exhaustively, and
// nothing would ever have said so.
//
// It scans for host literals ANYWHERE, not just inside `fetch(` — the leak that
// prompted this was an <img src>, and <link>, CSS url(), new Image() and
// srcSet disclose exactly as much as a fetch does. Matching on call sites would
// have reproduced the original blind spot in code.
//
// What it cannot see: a host assembled at runtime from parts. That hole is
// closed by convention rather than by grep — dashboard network calls go through
// dashboard/src/lib/api.ts, and validate:guardrails rejects a raw fetch( to a
// non-local host elsewhere. Ship both halves or neither.

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SCAN_DIRS = ["src", "dashboard/src"];
const SCAN_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".cjs", ".mjs"]);
const HOST_RE = /https?:\/\/([a-zA-Z0-9._-]+)/g;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      walk(full, out);
    } else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

// Test files describe hosts they never contact — a fixture URL is not an
// outbound call. Excluded so the inventory stays a list of real destinations.
function isTestFile(filePath) {
  return /\.test\.[jt]sx?$/.test(filePath) || /(^|[\\/])__tests__[\\/]/.test(filePath);
}

function collectHosts({ root = ROOT } = {}) {
  const found = new Map(); // host -> Set(relative file)
  for (const dir of SCAN_DIRS) {
    for (const filePath of walk(path.join(root, dir))) {
      if (isTestFile(filePath)) continue;
      const content = fs.readFileSync(filePath, "utf8");
      const relative = path.relative(root, filePath);
      for (const match of content.matchAll(HOST_RE)) {
        const host = match[1];
        if (!found.has(host)) found.set(host, new Set());
        found.get(host).add(relative);
      }
    }
  }
  return found;
}

// --- Half B: the hole a host-literal scan cannot see -------------------------
// `fetch(someVar)` reaches a host that never appears as a literal, so the scan
// above is blind to it.
//
// The rule is narrow on purpose: flag a non-literal fetch target ONLY in a file
// that also contains an external host literal. A dashboard file with no external
// host cannot construct one out of nothing — it would have to import a URL
// constant, and the file holding that constant is itself scanned and must be
// allowlisted. This clears the local API modules, whose targets are variables
// but always `new URL("/functions/...", window.location.origin)`, without
// weakening the check where it matters.
//
// A first attempt flagged those local modules too. That rule would have been
// deleted the first time it cried wolf, which is worse than not having it.
const DYNAMIC_FETCH_ALLOWLIST = new Map([
  [
    "dashboard/src/pages/IpCheckPage.jsx",
    "Builds probe URLs from a literal target list in the same file; every host is declared in outbound-hosts.json.",
  ],
  [
    "dashboard/src/lib/exchange-rate.ts",
    "Single declared host (open.er-api.com) held in an exported constant.",
  ],
]);

function externalHostsIn(content, inventory) {
  const hosts = new Set();
  for (const match of content.matchAll(HOST_RE)) {
    if (!isIgnored(match[1], inventory)) hosts.add(match[1]);
  }
  return hosts;
}

function checkDynamicFetches(root, inventory) {
  const findings = [];
  for (const filePath of walk(path.join(root, "dashboard/src"))) {
    if (isTestFile(filePath)) continue;
    const relative = path.relative(root, filePath);
    if (DYNAMIC_FETCH_ALLOWLIST.has(relative)) continue;
    const content = fs.readFileSync(filePath, "utf8");
    if (externalHostsIn(content, inventory).size === 0) continue;
    content.split("\n").forEach((line, index) => {
      const match = line.match(/\bfetch\s*\(([^,)]*)/);
      if (!match) return;
      const arg = match[1];
      if (/^\s*[`'"]\//.test(arg)) return;          // relative literal
      if (/[`'"]https?:\/\//.test(arg)) return;      // absolute literal, covered by the host scan
      findings.push(
        `${relative}:${index + 1} fetch() builds its target at runtime in a file that also names an` +
          ` external host — route it through the local API, or add the file to DYNAMIC_FETCH_ALLOWLIST` +
          ` in scripts/validate-outbound.cjs with a reason`,
      );
    });
  }
  return findings;
}

function loadInventory(root = ROOT) {
  const file = path.join(root, "outbound-hosts.json");
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// Exact host match only. An earlier version took URL prefixes and reduced them
// to their host, so an entry like "https://github.com/BerriAI" quietly exempted
// every github.com reference — a field that looked narrow and was not. This is
// the validator's own escape hatch; it must not be able to hide more than it says.
function isIgnored(host, inventory) {
  const ignored = inventory.ignored_hosts?.hosts || [];
  return ignored.includes(host);
}

function checkOutbound({ root = ROOT } = {}) {
  const inventory = loadInventory(root);
  if (!inventory) return ["outbound-hosts.json is missing"];

  const findings = [];
  const declared = new Map((inventory.hosts || []).map((h) => [h.host, h]));
  const found = collectHosts({ root });

  // 1. Anything the code can reach must be declared. This is the check that
  //    would have caught #100 the day it was written.
  for (const [host, files] of found) {
    if (declared.has(host) || isIgnored(host, inventory)) continue;
    findings.push(
      `undeclared outbound host '${host}' in ${[...files].sort().join(", ")}` +
        ` — add it to outbound-hosts.json (and the README table if it carries user data)`,
    );
  }

  // 2. A declaration that no longer matches any code is stale. Entries with an
  //    empty seen_in are deliberate (npx), so they are exempt.
  for (const entry of inventory.hosts || []) {
    if (Array.isArray(entry.seen_in) && entry.seen_in.length === 0) continue;
    if (!found.has(entry.host)) {
      findings.push(
        `outbound-hosts.json declares '${entry.host}' but no code references it — remove it or fix the entry`,
      );
    }
  }

  // 3. A declared host may only be reached from the files that declare it.
  //    Without this, `seen_in` is documentation: re-adding the exact call that
  //    caused #100 to ProjectUsagePanel would pass, because api.github.com is
  //    legitimately declared for the header star count elsewhere. The question
  //    that matters is not only "which hosts can we reach" but "from where".
  for (const entry of inventory.hosts || []) {
    const allowed = new Set(entry.seen_in || []);
    if (allowed.size === 0) continue;
    for (const file of found.get(entry.host) || []) {
      if (allowed.has(file)) continue;
      findings.push(
        `'${entry.host}' is referenced in ${file}, which is not in its seen_in list` +
          ` — add the file to outbound-hosts.json if the call belongs there, and re-read the` +
          ` purpose field before you do`,
      );
    }
  }

  // 4. Every host that discloses something about the user must be in the
  //    README table. The table is the promise; this is what keeps it true.
  const readmePath = path.join(root, "README.md");
  if (fs.existsSync(readmePath)) {
    const readme = fs.readFileSync(readmePath, "utf8");
    for (const entry of inventory.hosts || []) {
      if (!entry.readme) continue;
      if (!readme.includes(entry.host)) {
        findings.push(
          `README.md does not mention '${entry.host}', which outbound-hosts.json marks as` +
            (entry.user_data ? " carrying user data" : " user-visible"),
        );
      }
    }
  }

  findings.push(...checkDynamicFetches(root, inventory));

  return findings;
}

function main() {
  const findings = checkOutbound();
  if (findings.length === 0) {
    const count = (loadInventory() || {}).hosts?.length ?? 0;
    console.log(`Outbound inventory ok: ${count} declared hosts, all reachable ones accounted for.`);
    return;
  }
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { checkOutbound, collectHosts, checkDynamicFetches };
