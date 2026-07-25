const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { checkOutbound, collectHosts } = require("../scripts/validate-outbound.cjs");

// A throwaway repo shaped like this one. The validator reads the tree it is
// pointed at, so probing the real tree would mean editing tracked source — the
// hazard already caught once in test/openwiki-facts.test.js.
function fixture({ files = {}, hosts = [], ignored = [], readme = "" }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tt-outbound-"));
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  fs.writeFileSync(
    path.join(root, "outbound-hosts.json"),
    JSON.stringify({ hosts, ignored_hosts: { hosts: ignored } }),
  );
  fs.writeFileSync(path.join(root, "README.md"), readme);
  return root;
}

const declared = (host, extra = {}) => ({
  host,
  from: "server",
  user_data: false,
  readme: false,
  purpose: "test",
  seen_in: ["src/a.js"],
  request_from: ["src/a.js"],
  ...extra,
});

test("the repo as committed has a complete outbound inventory", () => {
  assert.deepEqual(checkOutbound(), []);
});

test("a host reachable in an <img src> is caught, not just one inside fetch()", () => {
  // This is the defect that prompted the whole check. `ProjectUsagePanel` sent
  // the name of a repo you had checked out to GitHub — once through fetch(),
  // and once through an <img src> template literal. A call-site scan sees only
  // the first, which is the same blind spot that let it ship.
  const root = fixture({
    files: {
      "dashboard/src/Panel.jsx": 'export const A = () => <img src={`https://evil.example/${o}.png`} />;\n',
    },
  });
  const findings = checkOutbound({ root });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /undeclared outbound host 'evil\.example'/);
  assert.match(findings[0], /dashboard\/src\/Panel\.jsx/);
});

test("dashboard/src is scanned, not only src", () => {
  // The audit that wrote the README table grepped `src/` and stopped there.
  // That omission is the reason this file exists, so it gets its own test.
  const root = fixture({
    files: { "dashboard/src/x.ts": 'const u = "https://only-in-dashboard.example/v1";\n' },
  });
  assert.ok(
    checkOutbound({ root }).some((f) => f.includes("only-in-dashboard.example")),
    "a host present only under dashboard/src must still be reported",
  );
});

test("a declared host that no longer exists in code is reported as stale", () => {
  const root = fixture({ hosts: [declared("gone.example")] });
  assert.ok(checkOutbound({ root }).some((f) => f.includes("no code references it")));
});

test("a user-data host missing from the README fails the build", () => {
  // The table is the promise. A host can be declared honestly in JSON and still
  // be invisible to the person reading the privacy section.
  const root = fixture({
    files: { "src/a.js": 'fetch("https://tracker.example/collect");\n' },
    hosts: [declared("tracker.example", { user_data: true, readme: true })],
    readme: "# TokenTracker\n\nNothing here mentions it.\n",
  });
  const findings = checkOutbound({ root });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /README\.md does not mention 'tracker\.example'/);
  assert.match(findings[0], /carrying user data/);
});

test("a declared and documented host passes", () => {
  const root = fixture({
    files: { "src/a.js": 'fetch("https://ok.example/x");\n' },
    hosts: [declared("ok.example", { readme: true })],
    readme: "| Pricing | `ok.example` | server | why |\n",
  });
  assert.deepEqual(checkOutbound({ root }), []);
});

test("test fixtures naming a host are not treated as outbound calls", () => {
  const root = fixture({
    files: { "src/a.test.js": 'assert.equal(url, "https://fixture-only.example/x");\n' },
  });
  assert.deepEqual(checkOutbound({ root }), [], "a URL in a test is not a destination");
  assert.equal(collectHosts({ root }).has("fixture-only.example"), false);
});

test("ignored_hosts covers loopback and non-network literals", () => {
  const root = fixture({
    files: { "src/a.js": 'const u = "http://localhost:7680"; const ns = "http://www.w3.org/2000/svg";\n' },
    ignored: ["localhost", "www.w3.org"],
  });
  assert.deepEqual(checkOutbound({ root }), []);
});

test("an ignore entry cannot exempt more than the host it names", () => {
  // The escape hatch used to take URL prefixes and reduce them to their host,
  // so "https://github.com/BerriAI" silently exempted every github.com
  // reference. A field that looks narrow and is not is worse than no field.
  const root = fixture({
    files: { "dashboard/src/a.jsx": 'const u = `https://github.com/${owner}.png`;\n' },
    ignored: ["github.com/BerriAI"],
  });
  assert.ok(
    checkOutbound({ root }).some((f) => f.includes("undeclared outbound host 'github.com'")),
    "a path-shaped ignore entry must not exempt the host",
  );
});

test("a request from a file that only had permission to MENTION the host is caught", () => {
  // The exact bypass an independent QA pass demonstrated on the merged branch.
  // ProjectUsagePanel legitimately contains "https://github.com/" as a prefix it
  // strips off project_ref, so file-level seen_in listed it as declared — and
  // re-adding <img src={`https://github.com/${repo}.png`}> to that very file,
  // the original defect, passed the check built to prevent it.
  const root = fixture({
    files: {
      "dashboard/src/Allowed.jsx": 'fetch("https://shared.example/ok");\n',
      "dashboard/src/Mentions.jsx": [
        'const ref = raw.replace("https://shared.example/", "");',
        "const bad = <img src={`https://shared.example/${repo}.png`} />;",
        "",
      ].join("\n"),
    },
    hosts: [
      declared("shared.example", {
        seen_in: ["dashboard/src/Allowed.jsx", "dashboard/src/Mentions.jsx"],
        request_from: ["dashboard/src/Allowed.jsx"],
      }),
    ],
  });
  const findings = checkOutbound({ root });
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.match(findings[0], /Mentions\.jsx:2 requests 'shared\.example'/);
});

test("request_from is enforced, so it cannot drift into decoration", () => {
  // Every seen_in list in the committed inventory is exact. They were
  // hand-written first and were wrong in six entries; the repo test above is
  // what surfaced that, and this one states the expectation directly.
  const root = fixture({
    files: { "src/a.js": 'const u = "https://x.example/1";\n' },
    hosts: [declared("x.example", { request_from: [] })],
  });
  assert.ok(checkOutbound({ root }).some((f) => f.includes("not in its request_from list")));
});

// --- Half B ------------------------------------------------------------------

test("a runtime-built fetch target is caught where the file can reach outside", () => {
  // The host-literal scan cannot see `fetch(target.url)`. This is the half that
  // stops the first dynamically-built URL from walking through the gate.
  const root = fixture({
    files: {
      "dashboard/src/Bad.jsx": [
        'const BASE = "https://exfil.example";',
        "export const go = (p) => fetch(buildUrl(p));",
        "",
      ].join("\n"),
    },
    hosts: [declared("exfil.example", { seen_in: ["dashboard/src/Bad.jsx"], request_from: ["dashboard/src/Bad.jsx"] })],
  });
  const findings = checkOutbound({ root });
  assert.ok(
    findings.some((f) => f.includes("builds its target at runtime")),
    `expected the dynamic-target finding, got: ${JSON.stringify(findings)}`,
  );
});

test("a runtime-built fetch is left alone when the file names no external host", () => {
  // The local API modules pass their target as a variable — always
  // `new URL("/functions/...", window.location.origin)`. A rule that flagged
  // those would be deleted the first time it cried wolf, so it must not.
  const root = fixture({
    files: {
      "dashboard/src/lib/api.ts": [
        'const url = new URL(`/functions/${slug}`, window.location.origin);',
        "const r = await fetch(url.toString(), { cache: 'no-store' });",
        "",
      ].join("\n"),
    },
  });
  assert.deepEqual(checkOutbound({ root }), []);
});

test("a host built by interpolation is resolved to its literal suffix", () => {
  // `img.src = `http://${token}-${i}.d.ip.net.coffee/pixel.gif`` is a real
  // browser request in IpCheckPage. A strict [a-zA-Z0-9._-]+ host pattern matches
  // nothing there, so that destination was invisible to the check that most
  // needed to see it — and the inventory described the host as server-only.
  const root = fixture({
    files: {
      "dashboard/src/Probe.jsx": "img.src = `http://${token}-${i}.probe.example/p.gif`;\n",
    },
  });
  assert.ok(
    checkOutbound({ root }).some((f) => f.includes("undeclared outbound host 'probe.example'")),
    "the literal suffix of an interpolated host must be reported",
  );
});

test("an unresolvable interpolated host is not invented", () => {
  // `http://${req.headers.host || "localhost"}` ends the match mid-expression.
  // Guessing from the remainder reports `req.headers.host` as a destination,
  // which is noise that trains people to ignore the check.
  const root = fixture({
    files: { "src/serve.js": 'const u = new URL(p, `http://${req.headers.host || "localhost"}`);\n' },
  });
  assert.deepEqual(checkOutbound({ root }), []);
});

test("a comment or a clickable link is a mention, not a request", () => {
  // Default-deny would otherwise flag every documented URL and every <a href>,
  // and a check that flags prose gets switched off.
  const root = fixture({
    files: {
      "dashboard/src/Doc.jsx": [
        "// See https://docs.example/guide for the format.",
        'const link = <a href="https://docs.example/guide">docs</a>;',
        "",
      ].join("\n"),
    },
    hosts: [declared("docs.example", { seen_in: ["dashboard/src/Doc.jsx"], request_from: [] })],
  });
  assert.deepEqual(checkOutbound({ root }), []);
});
