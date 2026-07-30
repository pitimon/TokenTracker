const { listProcessLines, parseProcessLine } = require("./process-list");

// Detects Claude Code CLI processes started with `--no-session-persistence`.
//
// Why this exists: every Claude figure TokenTracker reports is parsed out of the
// session transcripts under `~/.claude/projects`. That flag tells the CLI to
// write no transcript at all, so those calls are unobservable here — they cost
// real tokens and contribute zero. Before this check, the only visible symptom
// was a source quietly reporting less than it should, which is indistinguishable
// from "the user worked less today".
//
// This is a *live* signal, not a historical one: it answers "is something
// running right now that I cannot see", which is why it needs no baseline, no
// threshold, and no per-source history.
//
// PRIVACY (CONTRIBUTING.md): the command line is read and discarded inside this
// call. What leaves this module is a count, a coarse reason, and the model ids —
// never a pid, an argv string, an environment value, or a file path. Model ids
// are already first-class tracked data (every queue row carries one), and they
// are the one field that tells a user *which* stream is unobservable, so they
// are included deliberately; they are also length- and charset-clamped below so
// that no arbitrary command-line text can ride out through this field.

const SUPPRESSION_FLAG = "--no-session-persistence";
const CLAUDE_BINARY_NAME = "claude";
const MODEL_FLAG = /(?:^|\s)--model[=\s]+([A-Za-z0-9._:-]{1,64})(?=\s|$)/;
const SUPPRESSION_FLAG_PATTERN = /(?:^|\s)--no-session-persistence(?:=|\s|$)/;
const DEFAULT_TTL_MS = 30_000;

let cache = null;

function resetTranscriptSuppressionCache() {
  cache = null;
}

// argv[0] must be the `claude` binary. Matching on the flag alone would also
// match any shell, editor, or grep whose own command line happens to contain
// the string — including the process asking this question.
//
// The executable region is everything before the first `--flag`, not the first
// whitespace-delimited token: `ps` gives one flat string, so a binary installed
// under a path containing a space ("/Users/me/My Tools/claude") would otherwise
// be read as argv[0] = "/Users/me/My" and missed. A miss is the failure mode
// this whole check exists to prevent, so it is worth the wider window.
function isClaudeInvocation(command) {
  const executableRegion = String(command || "").split(/\s+--/)[0] || "";
  const base = executableRegion.trim().split(/[/\\]/).pop() || "";
  return base.replace(/\.exe$/i, "").toLowerCase() === CLAUDE_BINARY_NAME;
}

function hasSuppressionFlag(command) {
  return SUPPRESSION_FLAG_PATTERN.test(String(command || ""));
}

function extractModel(command) {
  const match = String(command || "").match(MODEL_FLAG);
  return match?.[1] || null;
}

// Pure: takes `ps` output lines, returns the deduplicated model ids of every
// suppressed Claude process. Deliberately returns models rather than processes —
// there is no pid in the return value for anything downstream to leak.
function findSuppressedModels(lines = []) {
  const models = new Set();
  let count = 0;

  for (const line of lines) {
    const parsed = parseProcessLine(line);
    if (!parsed) continue;
    if (!isClaudeInvocation(parsed.command)) continue;
    if (!hasSuppressionFlag(parsed.command)) continue;
    count += 1;
    const model = extractModel(parsed.command);
    if (model) models.add(model);
  }

  return { count, models: [...models].sort() };
}

// Returns { supported, checked, count, models, reason, checked_at }.
//
// `checked: false` is never reported as a clean result by callers. "I could not
// look" and "I looked and found nothing" are different answers, and collapsing
// them is how a monitor starts lying.
function detectTranscriptSuppression({
  commandRunner,
  platform = process.platform,
  now = () => new Date(),
  ttlMs = DEFAULT_TTL_MS,
  useCache = true,
} = {}) {
  const at = now();
  const atMs = at.getTime();

  if (useCache && cache && atMs - cache.atMs < ttlMs) {
    return cache.value;
  }

  const listed = listProcessLines({ commandRunner, platform });

  let value;
  if (!listed.ok) {
    value = {
      supported: listed.supported,
      checked: false,
      count: 0,
      models: [],
      reason: listed.reason,
      checked_at: at.toISOString(),
    };
  } else {
    const { count, models } = findSuppressedModels(listed.lines);
    value = {
      supported: true,
      checked: true,
      count,
      models,
      reason: null,
      checked_at: at.toISOString(),
    };
  }

  if (useCache) cache = { atMs, value };
  return value;
}

module.exports = {
  DEFAULT_TTL_MS,
  SUPPRESSION_FLAG,
  detectTranscriptSuppression,
  findSuppressedModels,
  resetTranscriptSuppressionCache,
};
