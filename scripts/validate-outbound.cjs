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
// A host assembled at runtime from parts still cannot be RESOLVED here, but it
// is no longer silently dropped: every unresolvable authority is reported unless
// it is declared in outbound-hosts.json with a reason (see checkUnresolved).
// What remains genuinely invisible is a URL that never exists as one literal —
// concatenation, an imported base, a join at the call site. That is #110 item 5,
// and closing it means following expressions rather than scanning literals.
// Until then it is held by convention: dashboard network calls go through
// dashboard/src/lib/api.ts, and validate:guardrails rejects a raw fetch( to a
// non-local host elsewhere. Ship both halves or neither.

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
// The walker used to see two directories and one extension set, which left
// named places a host could live and be missed (#110 item 2):
//
//   dashboard/*.html          the served SPA shell — a <link rel=preconnect>,
//                             font CDN or <script src> here is a browser request
//   dashboard/src/styles.css  inside a scanned directory, skipped by extension.
//                             CSS url() is a request
//   .../i18n/*.json           strings that flow into href/src props
//   dashboard/vite.config.js  dev proxy target; a new one was invisible
//   scripts/                  build-pricing-seed.cjs fetches
//                             raw.githubusercontent.com outside the scan
//
// scripts/ is maintainer-run rather than shipped, but the README's promise is
// about what this codebase reaches, and "only when the maintainer runs it" is a
// caveat for the purpose field, not a reason to be invisible.
const SCAN_DIRS = ["src", "dashboard/src", "scripts"];
// Individually named because dashboard/ as a whole holds build output and
// assets; only these three are source.
const SCAN_FILES = ["dashboard/index.html", "dashboard/pet.html", "dashboard/vite.config.js"];
const SCAN_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".cjs",
  ".mjs",
  ".css",
  ".html",
  ".json",
]);
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

// Resolves an authority to the host the RUNTIME would use.
//
// Hand-rolled parsing failed here six times, every time the same way: the
// scanner modelled the URL more narrowly than the runtime does. Userinfo,
// backslash-as-slash, tab/LF/CR stripping, percent-decoding, a trailing dot,
// case folding, an ideographic full stop, and a leading Cyrillic character that
// a `[^a-zA-Z0-9]` strip quietly removed — each was a separate patch, and the
// last one resolved `https://аapi.github.com` to the declared, permitted
// `api.github.com` while the runtime went to `xn--api-5cd.github.com`.
//
// So the runtime's own parser decides. `new URL()` implements WHATWG, which is
// what the browser and undici follow; it punycodes IDN, normalises the dot
// variants, and rejects what is not a URL. Hand-parsing is now reached only when
// interpolation makes a literal URL impossible to construct.
function resolveHost(rawAuthority) {
  const decoded = decodeSourceEscapes(rawAuthority);
  // Interpolation in the PATH does not stop the host being a literal:
  // `https://evil.example/${owner}.png` has a perfectly resolvable authority.
  // Testing the whole string sent every such URL down the pin path, where it
  // resolved to nothing.
  const authorityText = decoded.split(/[/\\?#]/)[0];

  if (!authorityText.includes("${")) {
    try {
      const url = new URL(`https://${authorityText.replace(/^\/+/, "")}`);
      const host = url.hostname;
      return host ? { host } : { host: null };
    } catch {
      // Not a URL the runtime would accept either — nothing to report.
      return { host: null };
    }
  }

  // Interpolated: the literal suffix is the most that can be pinned, and only
  // when the boundary falls on a dot AND the suffix is a zone rather than a bare
  // TLD. `${sub}github.com` can resolve to the registrable `evilgithub.com`;
  // `${src}.ai` pins nothing, since `ai` is the TLD itself.
  const parts = authorityText.replace(/\$\{[^}]*\}/g, "\u0000").split("\u0000");
  if (parts.length === 1) return { host: null };
  const tail = parts.pop();
  if (!tail.startsWith(".")) return { host: null };
  if (tail.replace(/^\./, "").split(".").filter(Boolean).length < 2) return { host: null };
  try {
    // The `pinned` label exists only to make a parseable URL; strip it and the
    // dot it left behind, so the zone is reported as `d.ip.net.coffee` rather
    // than `.d.ip.net.coffee`.
    const zone = new URL(`https://pinned${tail}`).hostname.replace(/^pinned\.?/, "");
    return { host: zone || null };
  } catch {
    return { host: null };
  }
}

const MENTION_CALL_RE = /\.(replace|split|startsWith|endsWith|includes|slice|indexOf|lastIndexOf)\s*\(\s*$/;
// Only the JSDoc continuation line, which is the one shape commentRanges cannot
// see: it carries no block state across lines by design. `//` and `/*` are now
// handled positionally instead — this regex used to match them too, and a line
// beginning `/* note */ fetch("https://…")` was exempted whole, comment and live
// call alike.
const COMMENT_LINE_RE = /^\s*\*/;

// Where the comments are on this line, as [start, end) ranges.
//
// A leading-comment regex was not enough: it matched only a comment that starts
// the line, so
//
//   const x = 5; // see https://github.com/nodejs/node/issues/123
//
// classified as a request. Reference links in trailing comments are ordinary
// code, and a check that flags ordinary code is a check someone switches off —
// which would take the rest of this control with it.
//
// This scans rather than matches, because the token we are looking for — `//` —
// is the one every URL contains. `fetch("https://x")` must not read as a
// comment, so string state has to be tracked to tell the two apart.
//
// Deliberately line-local: no block-comment state is carried across lines. A
// regex literal like /[/*]/ opens a block comment as far as this scanner is
// concerned, and carrying that state forward would silence the REST OF THE FILE
// — a miss, the one direction this check must never fail in. Confined to one
// line, the same mistake costs at most one false finding, which is visible and
// fixable. Multi-line comments stay covered by COMMENT_LINE_RE's `*` arm, which
// is the JSDoc style used throughout this repo.
function commentRanges(line) {
  const ranges = [];
  let quote = null;
  let blockStart = -1;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (blockStart >= 0) {
      if (char === "*" && next === "/") {
        ranges.push([blockStart, i + 2]);
        blockStart = -1;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (char === "\\") i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "/" && next === "/") {
      ranges.push([i, line.length]);
      return ranges;
    }
    if (char === "/" && next === "*") {
      blockStart = i;
      i += 1;
    }
  }
  // An unterminated `/*` comments out the rest of THIS line and no further.
  if (blockStart >= 0) ranges.push([blockStart, line.length]);
  return ranges;
}

function isInComment(ranges, index) {
  return ranges.some(([start, end]) => index >= start && index < end);
}

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
  if (isInComment(commentRanges(line), matchIndex)) return true;
  // Also strip a regex-literal opener. `repoInput.replace(/^https:\/\/github\.com\//, "")`
  // is string surgery on user input, but the `/^` between `replace(` and the URL
  // hid that from a test that only looked past quotes and braces.
  const before = line.slice(0, matchIndex).replace(/[/^"'`{(\s]+$/, "");
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

// One line of one file, folded into the three views the caller is building.
function scanLine({ line, index, relative, mentions, requests, unresolved }) {
  for (const match of [...line.matchAll(URL_RE), ...line.matchAll(PROTOCOL_RELATIVE_RE)]) {
    // String surgery and comments are filtered from EVERY view. A prefix being
    // stripped off user input is not a destination this code can reach, so it
    // does not belong in the inventory either — and a regex literal like
    // `/^https:\/\/github\.com\//` otherwise resolves to a bare `github`,
    // demanding a declaration for a host that does not exist.
    if (isMentionOnly(line, match.index)) continue;

    const { host } = resolveHost(match[1]);
    // An authority that cannot be reduced to a host used to be DROPPED, so a
    // real destination the scanner could not model went unmentioned. Reporting
    // it is right in principle and was tried as a flag flip inside #109; it
    // fired on ordinary code immediately, and a check that flags ordinary code
    // is a check someone turns off. So each is declared with a reason instead,
    // and a NEW one fails — see checkUnresolved.
    if (!host) {
      unresolved.push({
        file: relative,
        line: index + 1,
        authority: decodeSourceEscapes(match[1]).split(/[/\\?#]/)[0],
      });
      continue;
    }

    if (!mentions.has(host)) mentions.set(host, new Set());
    mentions.get(host).add(relative);
    // Every occurrence, not one per file. This was a Map keyed by file, so a
    // second request to the same host from the same file overwrote the first and
    // only the LAST line was ever reported — and with waivers now pinned to the
    // URL text, each occurrence has to be matched on its own.
    if (!requests.has(host)) requests.set(host, []);
    requests.get(host).push({
      file: relative,
      line: index + 1,
      text: match[0].replace(/^["'`{\s]+/, ""),
    });
  }
}

// Returns three views of the same scan: every file that NAMES each host, every
// file that REQUESTS it, and every authority that could not be resolved at all.
// The second is the one with security meaning; the third is what used to be
// thrown away.
function collectHosts({ root = ROOT } = {}) {
  const mentions = new Map();
  const requests = new Map();
  const unresolved = [];
  const targets = [
    ...SCAN_DIRS.flatMap((dir) => walk(path.join(root, dir))),
    ...SCAN_FILES.map((f) => path.join(root, f)).filter((f) => fs.existsSync(f)),
  ];
  for (const filePath of targets) {
    if (isTestFile(filePath)) continue;
    const relative = path.relative(root, filePath);
    fs.readFileSync(filePath, "utf8")
      .split("\n")
      .forEach((line, index) => {
        scanLine({ line, index, relative, mentions, requests, unresolved });
      });
  }
  mentions.requests = requests;
  mentions.unresolved = unresolved;
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

// A declared host may only be REQUESTED from where the inventory says. `seen_in`
// records every file that names the host, which is inventory; the three lists
// below record what may actually reach it, which is the security constraint.
// Conflating them is what let the original issue-100 call be re-added to a file
// that legitimately mentions github.com.
//
// `request_from` = this file calls the host, and is a whole-file permission
// because the file is declared to be a caller. `link_from` = the user clicks it.
// `data_from` = the host is a value this codebase stores or renders and never
// fetches — a mock fixture's `project_ref`, for instance.
//
// The last two are PINNED TO THE URL TEXT, not to the file. A file-wide waiver
// was an unconditional one: once a file was listed, any future request to that
// host from it passed forever. The concrete scenario is the shape of #100 —
// adding an owner-avatar `<img src>` to SkillDetailPanel.jsx, a plausible "show
// skill authors" change, to a file that already holds a github.com link waiver
// and already interpolates owner names.
//
// Pinned to the literal rather than to a line number because line numbers move
// under every edit above them, and a waiver that churns is a waiver people
// rubber-stamp. A NEW url string in a waived file is a diff in the inventory
// that a reviewer has to approve.
function checkRequestPermission(entry, records) {
  const findings = [];
  const allowed = new Set(entry.request_from || []);
  const waived = [...(entry.link_from || []), ...(entry.data_from || [])];

  // A bare string here used to mean "waive this whole file". Reject the old
  // shape outright rather than letting it read as an unmatched pin: the point of
  // the change is that a file-wide waiver cannot be written any more.
  for (const pin of waived) {
    if (pin && typeof pin.file === "string" && typeof pin.url === "string") continue;
    findings.push(
      `outbound-hosts.json has a link_from/data_from entry for '${entry.host}' that is not` +
        ` {"file": ..., "url": ...}: ${JSON.stringify(pin)} — a bare filename is a file-wide` +
        ` waiver, which is what the pinned form replaced`,
    );
  }

  const used = new Set();
  for (const record of records) {
    if (allowed.has(record.file)) continue;
    const pin = waived.findIndex((w) => w && w.file === record.file && w.url === record.text);
    if (pin >= 0) {
      used.add(pin);
      continue;
    }
    findings.push(
      `${record.file}:${record.line} requests '${entry.host}' as ${JSON.stringify(record.text)},` +
        ` which no request_from, link_from or data_from entry covers — if this call belongs,` +
        ` add it to outbound-hosts.json and re-read the purpose field first; if it does not,` +
        ` this is the defect the check exists for`,
    );
  }

  // A pin that matches nothing is a stale waiver: a live exemption waiting for a
  // URL to drift back onto it.
  waived.forEach((pin, index) => {
    if (used.has(index) || !pin) return;
    findings.push(
      `outbound-hosts.json pins ${JSON.stringify(pin.url)} in ${pin.file} for '${entry.host}',` +
        ` but no such URL is there — remove the stale waiver`,
    );
  });

  return findings;
}

// An authority the scanner cannot reduce to a host is a destination it cannot
// vouch for, so each one is declared with a reason. The issue's three original
// examples — bracketed IPv6, a Cyrillic lookalike, a single-label intranet host
// — all resolve now: they predate deferring to `new URL()`. What is left is
// interpolation that pins nothing, which is ordinary code, which is exactly why
// the flag-flip version of this had to be reverted.
//
// Matched on file + authority text. A new unresolvable authority anywhere is a
// finding; a declaration that no longer matches is reported as stale, so this
// list cannot quietly outlive the code it excuses.
function checkUnresolved(inventory, unresolved) {
  const declared = inventory.unresolved_authorities || [];
  const findings = [];
  const used = new Set();

  for (const item of unresolved) {
    const index = declared.findIndex(
      (d) => d && d.file === item.file && d.authority === item.authority,
    );
    if (index >= 0) {
      used.add(index);
      continue;
    }
    findings.push(
      `${item.file}:${item.line} builds a URL whose authority cannot be resolved to a host:` +
        ` ${JSON.stringify(item.authority)} — the scanner cannot say where this goes. Declare it in` +
        ` outbound-hosts.json under unresolved_authorities with a why, or make the host a literal`,
    );
  }

  declared.forEach((entry, index) => {
    if (used.has(index)) return;
    findings.push(
      `outbound-hosts.json declares unresolved authority ${JSON.stringify(entry?.authority)} in` +
        ` ${entry?.file}, but it is no longer there — remove it`,
    );
  });

  return findings;
}

const VALID_FROM = new Set(["server", "browser", "both"]);

// Which side of the product a file runs on. `dashboard/` is what the user's
// browser loads; everything else is the local Node process.
function sideOf(file) {
  return file.startsWith("dashboard/") && !file.startsWith("dashboard/vite.config")
    ? "browser"
    : "server";
}

// The inventory's prose was unchecked: `user_data: true` with `readme: false`
// passed, so did a wrong `from` and purpose text describing something the code
// does not do. Only the readme flag and a substring search were enforced, which
// left the fields a reader trusts most as the ones nothing verified.
//
// `from` is checked against where the host is ACTUALLY reached, not just for
// being one of three words — a host only ever requested from src/ cannot
// honestly be `browser`. Entries with nothing observed (npx fetching the package)
// are exempt, since there is no evidence either way.
function checkInventoryMetadata(entry, records) {
  const findings = [];
  const bad = (message) => findings.push(`outbound-hosts.json entry '${entry.host}': ${message}`);

  if (typeof entry.host !== "string" || !entry.host.trim()) bad("host must be a non-empty string");
  if (!VALID_FROM.has(entry.from)) {
    bad(`from must be one of ${[...VALID_FROM].join(", ")}, got ${JSON.stringify(entry.from)}`);
  }
  if (typeof entry.user_data !== "boolean") bad("user_data must be a boolean");
  if (typeof entry.readme !== "boolean") bad("readme must be a boolean");
  if (typeof entry.purpose !== "string" || entry.purpose.trim().length < 20) {
    bad("purpose must say something — it is what a reader of the privacy table relies on");
  }
  if (entry.user_data === true && entry.readme !== true) {
    bad("user_data is true, so readme must be true: every host that discloses something about the user belongs in the README table");
  }

  const sides = new Set(records.map((r) => sideOf(r.file)));
  if (sides.size > 0 && VALID_FROM.has(entry.from)) {
    const expected = sides.size === 2 ? "both" : [...sides][0];
    if (entry.from !== expected) {
      bad(
        `from is ${JSON.stringify(entry.from)} but the host is reached only from the ${expected}` +
          ` side (${[...new Set(records.map((r) => r.file))].sort().join(", ")})`,
      );
    }
  }
  return findings;
}

// Every host that discloses something about the user must be in the README
// table. The table is the promise; this is what keeps it true.
function checkReadmeTable(root, inventory) {
  const readmePath = path.join(root, "README.md");
  if (!fs.existsSync(readmePath)) return [];
  const readme = fs.readFileSync(readmePath, "utf8");
  return (inventory.hosts || [])
    .filter((entry) => entry.readme && !readme.includes(entry.host))
    .map(
      (entry) =>
        `README.md does not mention '${entry.host}', which outbound-hosts.json marks as` +
        (entry.user_data ? " carrying user data" : " user-visible"),
    );
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

  // 3.
  for (const entry of inventory.hosts || []) {
    const records = found.requests.get(entry.host) || [];
    findings.push(...checkRequestPermission(entry, records));
    findings.push(...checkInventoryMetadata(entry, records));
  }

  // 4.
  findings.push(...checkReadmeTable(root, inventory));

  // 5. Nothing may be silently dropped for being unparseable.
  findings.push(...checkUnresolved(inventory, found.unresolved || []));

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
