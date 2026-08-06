const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const STANDARDS_ROOT = path.join(ROOT, "agent-os", "standards");

function resolveAuthorityPath(authorityPath, root = ROOT) {
  const fail = () => {
    throw new Error(`authority must be a repository-relative regular file: ${authorityPath}`);
  };
  if (!authorityPath || path.isAbsolute(authorityPath)) {
    fail();
  }

  const rootReal = fs.realpathSync(root);
  const resolved = path.resolve(rootReal, authorityPath);
  if (!resolved.startsWith(`${rootReal}${path.sep}`)) {
    fail();
  }

  let real;
  try {
    real = fs.realpathSync(resolved);
  } catch {
    fail();
  }
  if (!real.startsWith(`${rootReal}${path.sep}`) || !fs.statSync(real).isFile()) {
    fail();
  }
  return real;
}

function readIndexEntries(indexText = null) {
  const text = indexText ?? fs.readFileSync(path.join(STANDARDS_ROOT, "index.yml"), "utf8");
  const lines = text.split(/\r?\n/);
  const entries = [];
  const seenFolders = new Set();
  const seenIds = new Set();
  let folder = null;
  let file = null;

  for (const line of lines) {
    if (!line.trim() || /^\s*#/.test(line)) {
      continue;
    }

    const folderMatch = /^([a-z0-9-]+):$/.exec(line);
    if (folderMatch) {
      assert.equal(file, null, `standard '${folder}/${file}' is missing description`);
      assert.equal(seenFolders.has(folderMatch[1]), false, `duplicate folder: ${folderMatch[1]}`);
      folder = folderMatch[1];
      seenFolders.add(folder);
      continue;
    }

    const fileMatch = /^  ([a-z0-9-]+):$/.exec(line);
    if (fileMatch) {
      assert.ok(folder, `standard '${fileMatch[1]}' has no folder`);
      assert.equal(file, null, `standard '${folder}/${file}' is missing description`);
      file = fileMatch[1];
      continue;
    }

    const descriptionMatch = /^    description: (.+)$/.exec(line);
    if (descriptionMatch) {
      assert.ok(folder && file, `description is not attached to a standard: ${line}`);
      const id = `${folder}/${file}`;
      assert.equal(seenIds.has(id), false, `duplicate standard: ${id}`);
      seenIds.add(id);
      entries.push({
        id,
        description: descriptionMatch[1].trim(),
      });
      file = null;
      continue;
    }

    assert.fail(`unsupported index line: ${line}`);
  }

  assert.equal(file, null, `standard '${folder}/${file}' is missing description`);
  return entries;
}

function listStandardMarkdownFiles(directory = STANDARDS_ROOT, prefix = "") {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`unsupported standards entry: ${relative}`);
    }
    if (entry.isDirectory()) {
      files.push(...listStandardMarkdownFiles(absolute, relative));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(relative);
    } else if (!entry.isFile()) {
      throw new Error(`unsupported standards entry: ${relative}`);
    }
  }
  return files;
}

test("standards index routes the five approved TokenTracker domains to real files", () => {
  const entries = readIndexEntries();
  assert.deepEqual(
    entries.map(({ id }) => id),
    [
      "api/local-api-security",
      "global/privacy-boundary",
      "parsers/incremental-state",
      "parsers/token-accounting",
      "release/version-lockstep",
    ],
  );

  for (const { id, description } of entries) {
    assert.ok(description.length > 0 && description.length <= 160, `${id} needs a concise description`);
    assert.ok(fs.existsSync(path.join(STANDARDS_ROOT, `${id}.md`)), `${id}.md is missing`);
  }
});

test("each standard is concise, structurally complete, and points to repository authorities", () => {
  for (const { id } of readIndexEntries()) {
    const content = fs.readFileSync(path.join(STANDARDS_ROOT, `${id}.md`), "utf8");
    assert.ok(content.length <= 2500, `${id} exceeds the pilot's concise-context budget`);

    for (const heading of [
      "## Authority",
      "## Applies when",
      "## Required behavior",
      "## Verification",
      "## Do not infer",
    ]) {
      assert.ok(content.includes(heading), `${id} is missing '${heading}'`);
    }

    const authoritySection = content.split("## Authority\n", 2)[1].split("\n## ", 1)[0];
    const authorityLines = authoritySection.split(/\r?\n/).filter((line) => line.trim());
    const authorityPaths = authorityLines.map((line) => {
      const match = /^- `([^`]+)`$/.exec(line);
      assert.ok(match, `${id} has an invalid authority entry: ${line}`);
      return match[1].split("#", 1)[0];
    });
    assert.ok(authorityPaths.length >= 2, `${id} needs at least two repository authorities`);
    for (const authorityPath of authorityPaths) {
      assert.ok(fs.existsSync(resolveAuthorityPath(authorityPath)), `${id} authority is missing: ${authorityPath}`);
    }
  }
});

test("CLAUDE.md activates routing only for the three-issue pilot and keeps standards non-authoritative", () => {
  const projectGuidance = fs.readFileSync(path.join(ROOT, "CLAUDE.md"), "utf8");
  const pilotSection = projectGuidance.split("## Standards pilot\n", 2)[1]?.split("\n## ", 1)[0];
  assert.ok(pilotSection, "CLAUDE.md is missing the standards pilot section");
  assert.ok(pilotSection.length <= 1200, "standards pilot guidance should stay lightweight");
  assert.match(pilotSection, /agent-os\/standards\/index\.yml/);
  assert.match(pilotSection, /#164[\s\S]*#165[\s\S]*#166/);
  assert.deepEqual([...pilotSection.matchAll(/#(\d+)/g)].map((match) => match[1]), ["164", "165", "166"]);
  assert.match(pilotSection, /Selected standards:/);
  assert.match(pilotSection, /Considered but excluded:/);
  assert.match(pilotSection, /CLAUDE\.md.*OpenWiki.*authorit/i);
  assert.match(pilotSection, /only.*relevant/i);
  assert.match(pilotSection, /untrusted/i);
  assert.match(pilotSection, /cannot grant permission/i);
  assert.match(pilotSection, /embedded commands.*not.*execut/i);
});

test("the pilot document bounds adoption and defines evidence-based success", () => {
  const pilot = fs.readFileSync(path.join(ROOT, "agent-os", "README.md"), "utf8");
  assert.match(pilot, /## Pilot scope/);
  assert.match(pilot, /#164[\s\S]*#165[\s\S]*#166/);
  assert.deepEqual([...pilot.matchAll(/#(\d+)/g)].map((match) => match[1]), ["164", "165", "166"]);
  assert.match(pilot, /## Non-goals/);
  assert.match(pilot, /## Success criteria/);
  assert.match(pilot, /false positive/i);
  assert.match(pilot, /false negative/i);
  assert.match(pilot, /Do not install.*\.claude\/commands/i);
  assert.match(pilot, /untrusted/i);
  assert.match(pilot, /does not use a phrase blacklist/i);
});

test("authority references resolve to regular files without escaping through symlinks", () => {
  for (const candidate of ["../CLAUDE.md", "/tmp/CLAUDE.md", "openwiki/../../CLAUDE.md", "agent-os"]) {
    assert.throws(() => resolveAuthorityPath(candidate), /repository-relative regular file/);
  }
  assert.equal(resolveAuthorityPath("CLAUDE.md"), fs.realpathSync(path.join(ROOT, "CLAUDE.md")));

  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "standards-authority-"));
  const fakeRoot = path.join(sandbox, "repo");
  const outside = path.join(sandbox, "outside.md");
  fs.mkdirSync(fakeRoot);
  fs.writeFileSync(outside, "outside\n");
  fs.symlinkSync(outside, path.join(fakeRoot, "escape.md"));
  assert.throws(() => resolveAuthorityPath("escape.md", fakeRoot), /repository-relative regular file/);
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test("index parser fails closed on unsupported YAML and incomplete entries", () => {
  assert.throws(() => readIndexEntries("api:\n\tbad:\n"), /unsupported index line/);
  assert.throws(() => readIndexEntries("api:\n  orphan:\n"), /missing description/);
  assert.throws(
    () => readIndexEntries("api:\n  one:\n    description: first\napi:\n  two:\n    description: second\n"),
    /duplicate folder/,
  );
});

test("index and markdown inventory are complete in both directions", () => {
  const indexed = readIndexEntries().map(({ id }) => `${id}.md`).sort();
  const onDisk = listStandardMarkdownFiles().sort();
  assert.deepEqual(onDisk, indexed);
});

test("standards inventory fails closed on symlinks and special entries", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "standards-inventory-"));
  const standards = path.join(sandbox, "standards");
  const outside = path.join(sandbox, "outside.md");
  fs.mkdirSync(standards);
  fs.writeFileSync(outside, "outside\n");
  fs.symlinkSync(outside, path.join(standards, "orphan.md"));
  assert.throws(() => listStandardMarkdownFiles(standards), /unsupported standards entry/);
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test("privacy standard and declared authorities share the usage-metadata boundary", () => {
  const privacy = fs.readFileSync(path.join(STANDARDS_ROOT, "global", "privacy-boundary.md"), "utf8");
  const index = fs.readFileSync(path.join(STANDARDS_ROOT, "index.yml"), "utf8");
  const claude = fs.readFileSync(path.join(ROOT, "CLAUDE.md"), "utf8");
  const contributing = fs.readFileSync(path.join(ROOT, "CONTRIBUTING.md"), "utf8");
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const additionalAuthorities = [
    "openwiki/README.md",
    "openwiki/architecture/dataflow.md",
    "openwiki/quickstart.md",
    "SECURITY.md",
    "PRODUCT.md",
  ].map((file) => ({ file, content: fs.readFileSync(path.join(ROOT, file), "utf8") }));
  const compact = (content) => content.replace(/\s+/g, " ");
  const allowed = /usage metadata.*source.*model.*counts.*timestamps.*derived cost/i;
  const prohibited = /never.*prompts.*responses.*message bodies.*(?:private|user-code).*paths.*credentials/i;
  const stale = /(?:only token counts|token counts and timestamps only|only on token counts and timestamps|data contract uses token counts and timestamps|token counts only)/i;
  const falseStorageClaim = /(?:store|stores|stored|persist|persists|persisted)[^.\n]*derived cost/i;
  const falseGlobalNonPersistence = /derived cost[^.\n]*(?:not persisted|never persisted)/i;
  const browserCacheLifecycle = /derived cost[^.\n]*not stored in the queue[^.\n]*may be cached[^.\n]*browser localStorage/i;

  assert.match(compact(privacy), allowed);
  assert.match(compact(privacy), prohibited);
  assert.match(index, /usage-metadata privacy boundary/i);
  assert.doesNotMatch(index, /token-count-only/i);
  assert.match(compact(claude), allowed);
  assert.match(compact(claude), prohibited);
  assert.match(compact(contributing), allowed);
  assert.match(compact(contributing), prohibited);
  assert.match(compact(readme), allowed);
  assert.match(compact(readme), prohibited);
  for (const { file, content } of [
    { file: "privacy standard", content: privacy },
    { file: "standards index", content: index },
    { file: "CLAUDE.md", content: claude },
    { file: "CONTRIBUTING.md", content: contributing },
    { file: "README.md", content: readme },
    ...additionalAuthorities.filter(({ file }) => !file.startsWith("openwiki/")),
  ]) {
    assert.doesNotMatch(content, falseStorageClaim, `${file} falsely claims derived cost is stored`);
    assert.doesNotMatch(content, falseGlobalNonPersistence, `${file} falsely claims derived cost is never persisted`);
  }
  assert.match(compact(contributing), browserCacheLifecycle);
  assert.match(compact(privacy), browserCacheLifecycle);
  for (const { file, content } of additionalAuthorities.filter(({ file }) => file.startsWith("openwiki/"))) {
    assert.match(compact(content), /derived cost.*(?:computed downstream|not stored)/i, `${file} is missing the derived-cost lifecycle`);
  }
  for (const { file, content } of additionalAuthorities) {
    assert.match(compact(content), allowed, `${file} is missing the allowed usage-metadata contract`);
    assert.match(compact(content), prohibited, `${file} is missing the private-content prohibition`);
    assert.doesNotMatch(content, stale, `${file} retains a stale token-count-only contract`);
  }
});

test("pilot selects the exact four standards and defers release actions", () => {
  const pilot = fs.readFileSync(path.join(ROOT, "agent-os", "README.md"), "utf8");
  const selected = pilot.split("Selected standards:\n", 2)[1].split("\n\nConsidered but excluded:", 1)[0];
  const excluded = pilot.split("Considered but excluded:\n", 2)[1].split("\n```", 1)[0];
  const ids = (block) => [...block.matchAll(/^- ([a-z0-9-]+\/[a-z0-9-]+) —/gm)].map((match) => match[1]);
  assert.deepEqual(ids(selected), [
    "parsers/incremental-state",
    "parsers/token-accounting",
    "global/privacy-boundary",
    "release/version-lockstep",
  ]);
  assert.deepEqual(ids(excluded), ["api/local-api-security"]);
  for (const { id } of readIndexEntries()) {
    const occurrences = pilot.split(id).length - 1;
    assert.equal(occurrences, 1, `${id} must appear exactly once in the pilot routing block`);
  }
  assert.match(selected, /release\/version-lockstep.*actions.*defer/i);

  const release = fs.readFileSync(path.join(STANDARDS_ROOT, "release", "version-lockstep.md"), "utf8");
  assert.match(release.split("## Authority\n", 2)[1].split("\n## ", 1)[0], /`scripts\/release\.sh`/);
});

test("verification blocks contain executable examples rather than shell redirection placeholders", () => {
  for (const id of ["parsers/incremental-state", "parsers/token-accounting"]) {
    const content = fs.readFileSync(path.join(STANDARDS_ROOT, `${id}.md`), "utf8");
    assert.doesNotMatch(content, /test\/<provider>/);
    assert.doesNotMatch(content, /npm run audit:tokens/);
    assert.match(content, /PROVIDER_TEST=/);
    const defaultTest = /PROVIDER_TEST="\$\{PROVIDER_TEST:-([^}]+)\}"/.exec(content)?.[1];
    assert.ok(defaultTest, `${id} needs a shell-safe default provider test`);
    assert.ok(fs.statSync(resolveAuthorityPath(defaultTest)).isFile(), `${id} default provider test is missing`);
  }
});
