import { copy } from "../../../lib/copy";
import { CURRENCY_USD, getCurrencySymbol } from "../../../lib/currency";
import { formatCompactNumber, formatUsdCurrency } from "../../../lib/format";

export function formatTokens(value) {
  if (!Number.isFinite(Number(value))) return null;
  const n = Number(value);
  if (n <= 0) return null;
  return formatCompactNumber(n, { decimals: 1 });
}

export function formatCost(value, currency, rate) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const symbol = getCurrencySymbol(currency);
  const converted = currency === CURRENCY_USD ? n : n * rate;
  if (converted < 0.01) return `<${symbol}0.01`;
  return formatUsdCurrency(n, { decimals: 2, currency, rate });
}

export function formatCostPerMillion(value, currency, rate) {
  const label = formatCost(value, currency, rate);
  return label ? `${label}/MTok` : null;
}

export function formatModelName(value) {
  if (!value) return "";
  return String(value).replace(/^claude-/, "");
}

export function normalizePeriods(periods) {
  if (!Array.isArray(periods)) return [];
  return periods.map((p) => {
    if (typeof p === "string") {
      return { key: p, label: getPeriodLabel(p) };
    }
    return { key: p.key, label: p.label || getPeriodLabel(p.key) };
  });
}

export function parseAnimatedCounterValue(displayValue) {
  if (typeof displayValue !== "string") return null;
  const match = displayValue.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

// Provider color mapping for visual distinction
export const PROVIDER_COLORS = {
  CODEX: "#3b82f6",     // blue-500
  CLAUDE: "#d97757",    // Anthropic Japonica orange-red
  OPENCODE: "#f59e0b",  // amber-500
  GEMINI: "#2196f3",    // Google Gemini bright blue
  KIMI: "#a78bfa",      // violet-400
  "KILO-CLI": "#facc15",   // yellow-400 (Kilo brand yellow)
  "KILO-CODE": "#facc15",
  DROID: "#ef4444",        // red-500 (Factory brand)
};

export function getProviderColor(label, index) {
  const normalized = label?.toUpperCase?.() || "";
  return PROVIDER_COLORS[normalized] || `hsl(${150 + index * 40}, 60%, 45%)`;
}

export function resolveContextBreakdownSource(provider) {
  const source = String(provider?.source || "").trim().toLowerCase();
  const label = String(provider?.label || "").trim().toLowerCase();
  if (source === "claude" || label === "claude") return "claude";
  if (source === "codex" || label === "codex") return "codex";
  return null;
}

export function hasProviderModels(provider) {
  return Boolean(provider?.models?.length);
}

export function getModelShareWidth(share) {
  const value = Number(share);
  if (!Number.isFinite(value) || value <= 0) return "0%";
  return `${Math.min(100, Math.max(2, value))}%`;
}

export function isSameModel(left, right) {
  const leftKey = String(left?.id || left?.name || "").trim().toLowerCase();
  const rightKey = String(right?.id || right?.name || "").trim().toLowerCase();
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

export function getVisibleModels(provider, limit = 3) {
  return [...(provider?.models || [])]
    .sort((a, b) => (Number(b.share) || 0) - (Number(a.share) || 0))
    .slice(0, limit);
}

export function getHiddenModelCount(provider, visibleModels) {
  return Math.max(0, (provider?.models?.length || 0) - visibleModels.length);
}

export const PERIOD_COPY_KEYS = {
  day: "usage.period.day",
  "24h": "usage.period.last24h",
  week: "usage.period.week",
  month: "usage.period.month",
  total: "usage.period.total",
  custom: "usage.period.custom",
};

export function getPeriodLabel(key) {
  const copyKey = PERIOD_COPY_KEYS[key];
  return copyKey ? copy(copyKey) : String(key).toUpperCase();
}
