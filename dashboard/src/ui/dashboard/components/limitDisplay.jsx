import { copy } from "../../../lib/copy";
import { LIMIT_DISPLAY_MODES } from "../../../hooks/use-limits-display-prefs.js";

/**
 * Compact per-provider quota display for the dashboard provider cards.
 *
 * The Limits page (UsageLimitsPanel) renders the full set of windows as bars.
 * The dashboard card only has room for a glance, so it surfaces the provider's
 * first two windows ("5h + week") as tinted chips — a colored severity spot +
 * label + %. All the underlying data is the same `useUsageLimits()` payload;
 * this module just picks and formats it. See ProviderBreakdownCard.
 */

// Shared with UsageLimitsPanel — kept here so both surfaces format resets identically.
export function formatReset(isoOrUnix) {
  if (!isoOrUnix) return null;
  const ts = typeof isoOrUnix === "number" ? isoOrUnix * 1000 : Date.parse(isoOrUnix);
  if (!Number.isFinite(ts)) return null;
  const diff = ts - Date.now();
  if (diff <= 0) return copy("shared.time.now");
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// Provider labels on the dashboard come from the token pipeline (e.g. "CLAUDE",
// "CODEX", "Z.AI", "GitHub Copilot"); the limits payload is keyed by lowercase id.
const LIMIT_IDS = ["claude", "codex", "cursor", "gemini", "kimi", "zai", "kiro", "copilot", "antigravity"];
const LABEL_ALIASES = { githubcopilot: "copilot", zhipu: "zai", glm: "zai" };

export function limitIdForLabel(label) {
  const s = String(label || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (LIMIT_IDS.includes(s)) return s;
  if (LABEL_ALIASES[s]) return LABEL_ALIASES[s];
  return null;
}

// Which two windows each provider surfaces on the card (primary + secondary),
// mirroring the labels the Limits page uses. Any 3rd window stays on that page.
// Claude reports `{ utilization, resets_at }`; everyone else `{ used_percent, reset_at }`.
// NOTE: short technical labels (5h/7d/Pro/Flash/Claude/G Pro) are kept as literals to
// match the Limits page (UsageLimitsPanel.renderProviderGroup) verbatim; the copy-key'd
// labels (cursor/kimi/zai/kiro/copilot) are keyed there too. A full i18n pass over these
// belongs to both surfaces at once, not this card — tracked as a follow-up.
const WINDOW_MAP = {
  claude: [
    { field: "five_hour", label: "5h", pctField: "utilization", resetField: "resets_at" },
    { field: "seven_day", label: "7d", pctField: "utilization", resetField: "resets_at" },
  ],
  codex: [
    { field: "primary_window", label: "5h" },
    { field: "secondary_window", label: "7d" },
  ],
  cursor: [
    { field: "primary_window", labelKey: "limits.label.cursor_plan" },
    { field: "secondary_window", labelKey: "limits.label.cursor_auto" },
  ],
  gemini: [
    { field: "primary_window", label: "Pro" },
    { field: "secondary_window", label: "Flash" },
  ],
  kimi: [
    { field: "primary_window", labelKey: "limits.label.kimi_weekly" },
    { field: "secondary_window", labelKey: "limits.label.kimi_5h" },
  ],
  zai: [
    { field: "primary_window", labelKey: "limits.label.zai_5h" },
    { field: "secondary_window", labelKey: "limits.label.zai_weekly" },
  ],
  kiro: [
    { field: "primary_window", labelKey: "limits.label.kiro_month" },
    { field: "secondary_window", labelKey: "limits.label.kiro_bonus" },
  ],
  antigravity: [
    { field: "primary_window", label: "Claude" },
    { field: "secondary_window", label: "G Pro" },
  ],
  copilot: [
    { field: "primary_window", labelKey: "limits.label.copilot_premium" },
    { field: "secondary_window", labelKey: "limits.label.copilot_chat" },
  ],
};

/**
 * The provider's card windows as `{ label, displayPct, reset }`, up to two.
 * `displayPct` is flipped for Remaining mode but kept at full precision — the
 * tier color must be computed from the raw value (rounding it first would push
 * e.g. 74.6% up to the 75% orange band), and the chip rounds only for the label.
 */
export function getCardLimitWindows(id, data, mode) {
  const spec = WINDOW_MAP[id];
  if (!spec || !data) return [];
  const out = [];
  for (const w of spec) {
    const win = data[w.field];
    if (!win) continue;
    const rawPct = Number(win[w.pctField || "used_percent"]);
    if (!Number.isFinite(rawPct)) continue;
    const clamped = Math.max(0, Math.min(100, rawPct));
    const displayPct = mode === LIMIT_DISPLAY_MODES.REMAINING ? 100 - clamped : clamped;
    out.push({
      label: w.labelKey ? copy(w.labelKey) : w.label,
      displayPct,
      reset: formatReset(win[w.resetField || "reset_at"]),
    });
  }
  return out;
}

/**
 * 4-tier severity classes for a card chip. Finer than the Limits page 3-tier so
 * a glance separates "plenty" from "getting tight". In Remaining mode a low
 * remaining % is the dangerous end, so we score on the used-equivalent.
 * Class strings are full literals so Tailwind's JIT compiles them.
 */
export function getCardTierClasses(displayPct, mode) {
  const p = mode === LIMIT_DISPLAY_MODES.REMAINING ? 100 - displayPct : displayPct;
  if (p >= 90) return { dot: "bg-red-500", chip: "border-red-500/30 bg-red-500/10" };
  if (p >= 75) return { dot: "bg-orange-500", chip: "border-orange-500/30 bg-orange-500/10" };
  if (p >= 50) return { dot: "bg-amber-500", chip: "border-amber-500/30 bg-amber-500/10" };
  return {
    dot: "bg-oai-gray-400 dark:bg-oai-gray-500",
    chip: "border-oai-gray-200 dark:border-oai-gray-700 bg-oai-gray-100/70 dark:bg-oai-gray-800/40",
  };
}

function LimitChip({ label, displayPct, reset, mode }) {
  const tier = getCardTierClasses(displayPct, mode); // raw % → correct tier at boundaries
  const shown = Math.round(displayPct); // round only for the visible label
  const pctLabel = copy("usage.overview.model_percent", { percent: shown });
  const title = reset
    ? copy("usage.overview.provider_limit_reset", { label, percent: shown, reset })
    : copy("usage.overview.provider_limit", { label, percent: shown });
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] leading-none ${tier.chip}`}
      title={title}
      aria-label={title}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tier.dot}`} aria-hidden="true" />
      <span className="text-oai-gray-500 dark:text-oai-gray-400">{label}</span>
      <span className="font-semibold tabular-nums text-oai-black dark:text-oai-white">{pctLabel}</span>
    </span>
  );
}

/**
 * Renders the limit chips for one provider, or nothing when there is no data.
 * Non-interactive (safe to nest inside the card's <button>).
 * - usageLimits not loaded yet → omit (no layout jump on arrival).
 * - provider not a limits provider / not configured → hide.
 * - configured but errored → subtle status line.
 */
export function LimitChips({ label, usageLimits, mode = LIMIT_DISPLAY_MODES.USED }) {
  if (!usageLimits || typeof usageLimits !== "object") return null;
  const id = limitIdForLabel(label);
  if (!id) return null;
  const data = usageLimits[id];
  if (!data || !data.configured) return null;

  const effectiveMode = mode === LIMIT_DISPLAY_MODES.REMAINING
    ? LIMIT_DISPLAY_MODES.REMAINING
    : LIMIT_DISPLAY_MODES.USED;

  if (data.error) {
    return (
      <div className="mt-2.5 pt-2.5 border-t border-dashed border-oai-gray-200 dark:border-oai-gray-700 text-[11px] leading-snug text-oai-gray-500 dark:text-oai-gray-400">
        {copy("shared.error.prefix", { error: data.error })}
      </div>
    );
  }

  const windows = getCardLimitWindows(id, data, effectiveMode);
  if (windows.length === 0) return null;

  return (
    <div className="mt-2.5 pt-2.5 border-t border-dashed border-oai-gray-200 dark:border-oai-gray-700 flex flex-wrap items-center gap-1.5">
      {windows.map((w) => (
        <LimitChip key={w.label} label={w.label} displayPct={w.displayPct} reset={w.reset} mode={effectiveMode} />
      ))}
    </div>
  );
}
