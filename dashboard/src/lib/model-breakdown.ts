import { toFiniteNumber } from "./format";

type AnyRecord = Record<string, any>;

function normalizeModelId(value: any) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
}

function resolveModelId(model: any) {
  const id = normalizeModelId(model?.model_id);
  if (id) return id;
  return null;
}

function resolveModelName(model: any, fallback: any) {
  if (model?.model) return String(model.model);
  return fallback;
}

function isKnownZeroCostModel(name: any) {
  const lower = String(name || "").toLowerCase();
  return lower.includes("free") || lower.includes("hy3-preview") || /^glm-[\d.]+-flash(?![a-z])/.test(lower);
}

export function resolveDisplayTokens(totals: any, fallback = 0) {
  const billableTokens = toFiniteNumber(totals?.billable_total_tokens);
  const totalTokens = toFiniteNumber(totals?.total_tokens);
  if (billableTokens != null && billableTokens > 0) return billableTokens;
  if (totalTokens != null && totalTokens > 0) return totalTokens;
  return billableTokens ?? totalTokens ?? fallback;
}

export function buildFleetData(modelBreakdown: any, { copyFn }: AnyRecord = {}) {
  const safeCopy = typeof copyFn === "function" ? copyFn : (key: string) => key;
  const sources: any[] = Array.isArray(modelBreakdown?.sources) ? modelBreakdown.sources : [];
  const normalizedSources = sources
    .map((entry: any) => {
      const totalTokens = resolveDisplayTokens(entry?.totals);
      const totalCost = toFiniteNumber(entry?.totals?.total_cost_usd) ?? 0;
      return {
        source: entry?.source,
        totalTokens: Number.isFinite(totalTokens) ? totalTokens : 0,
        totalCost: Number.isFinite(totalCost) ? totalCost : 0,
        models: Array.isArray(entry?.models) ? entry.models : [],
      };
    })
    .filter((entry) => entry.totalTokens > 0);

  if (!normalizedSources.length) return [];

  const grandTotal = normalizedSources.reduce((acc, entry) => acc + entry.totalTokens, 0);
  const pricingMode =
    typeof modelBreakdown?.pricing?.pricing_mode === "string"
      ? modelBreakdown.pricing.pricing_mode.toUpperCase()
      : null;

  return normalizedSources
    .slice()
    .sort((a: any, b: any) => b.totalTokens - a.totalTokens)
    .map((entry: any) => {
      const label = entry.source
        ? String(entry.source).toUpperCase()
        : safeCopy("shared.placeholder.short");
      const totalPercentRaw = grandTotal > 0 ? (entry.totalTokens / grandTotal) * 100 : 0;
      const totalPercent = Number.isFinite(totalPercentRaw) ? totalPercentRaw.toFixed(1) : "0.0";
      const models = entry.models
        .map((model: any) => {
          const modelTokens = resolveDisplayTokens(model?.totals);
          if (!Number.isFinite(modelTokens) || modelTokens <= 0) return null;
          const share =
            entry.totalTokens > 0 ? Math.round((modelTokens / entry.totalTokens) * 1000) / 10 : 0;
          const name = resolveModelName(model, safeCopy("shared.placeholder.short"));
          const id = resolveModelId(model);
          const explicitModelCost = toFiniteNumber(model?.totals?.total_cost_usd);
          const modelCost =
            explicitModelCost != null
              ? explicitModelCost
              : entry.totalCost > 0 && entry.totalTokens > 0
                ? (modelTokens / entry.totalTokens) * entry.totalCost
                : null;
          const pricingMissing =
            modelTokens > 0 &&
            (modelCost == null || modelCost <= 0) &&
            !isKnownZeroCostModel(name);
          return { id, name, share, usage: modelTokens, cost: modelCost, pricingMissing };
        })
        .filter(Boolean);
      const topCostModel = models
        .filter((model: any) => Number.isFinite(Number(model?.cost)) && Number(model.cost) > 0)
        .sort((a: any, b: any) => Number(b.cost) - Number(a.cost))[0] || null;
      const missingPricingModels = models.filter((model: any) => model?.pricingMissing);
      return {
        source: entry.source,
        label,
        totalPercent: String(totalPercent),
        usd: entry.totalCost,
        usage: entry.totalTokens,
        topCostModel,
        missingPricingModels,
        models,
      };
    });
}

export function buildUsageInsights(modelBreakdown: any, { copyFn }: AnyRecord = {}) {
  const safeCopy = typeof copyFn === "function" ? copyFn : (key: string) => key;
  const fleet = buildFleetData(modelBreakdown, { copyFn: safeCopy });
  const totalTokens = fleet.reduce((acc: number, source: any) => acc + (Number(source?.usage) || 0), 0);
  const totalCost = fleet.reduce((acc: number, source: any) => acc + (Number(source?.usd) || 0), 0);
  const allModels = fleet.flatMap((source: any) =>
    (source.models || []).map((model: any) => ({
      ...model,
      source: source.label,
    })),
  );
  const topCostModel =
    allModels
      .filter((model: any) => Number.isFinite(Number(model?.cost)) && Number(model.cost) > 0)
      .sort((a: any, b: any) => Number(b.cost) - Number(a.cost))[0] || null;
  const topUsageModel =
    allModels
      .filter((model: any) => Number.isFinite(Number(model?.usage)) && Number(model.usage) > 0)
      .sort((a: any, b: any) => Number(b.usage) - Number(a.usage))[0] || null;
  const missingPricingModels = allModels.filter((model: any) => model?.pricingMissing);
  return {
    totalTokens,
    totalCost,
    costPerMillionTokens: totalTokens > 0 ? totalCost / (totalTokens / 1_000_000) : null,
    topCostModel,
    topUsageModel,
    missingPricingModels,
  };
}

export function resolveDailyTopModel(row: any, fallback: any = "—") {
  const entries = Object.entries(row?.models || {});
  if (!entries.length) return fallback;
  let bestName = null;
  let bestTokens = -1;
  for (const [name, value] of entries) {
    const tokens = Number(value);
    if (!Number.isFinite(tokens) || tokens <= bestTokens) continue;
    bestName = name;
    bestTokens = tokens;
  }
  return bestName || fallback;
}

export function enrichDailyRows(rows: any[], { fallback = "—" }: AnyRecord = {}) {
  const enrichedRows = (Array.isArray(rows) ? rows : []).map((row: any) => {
    const billable = resolveDisplayTokens(row);
    const cost = toFiniteNumber(row?.total_cost_usd) ?? 0;
    const costPerMillionTokens =
      Number.isFinite(billable) && billable > 0 ? cost / (billable / 1_000_000) : null;
    return {
      ...row,
      cost_per_million_tokens: costPerMillionTokens,
      top_model: resolveDailyTopModel(row, fallback),
    };
  });
  const costPerMillionValues = enrichedRows.reduce((acc: number[], row: any) => {
    const value = toFiniteNumber(row?.cost_per_million_tokens);
    if (value != null && value > 0) acc.push(value);
    return acc;
  }, []);
  const averageCostPerMillion =
    costPerMillionValues.length > 0
      ? costPerMillionValues.reduce((acc: number, value: number) => acc + value, 0) /
        costPerMillionValues.length
      : null;

  return enrichedRows.map((row: any) => {
    const value = toFiniteNumber(row?.cost_per_million_tokens);
    const isHigh =
      value != null &&
      averageCostPerMillion != null &&
      averageCostPerMillion > 0 &&
      value > averageCostPerMillion * 1.15;
    return {
      ...row,
      cost_per_million_baseline: averageCostPerMillion,
      cost_per_million_status: isHigh ? "high" : "normal",
    };
  });
}

export function buildTopModels(modelBreakdown: any, { limit = 3, copyFn }: AnyRecord = {}) {
  const safeCopy = typeof copyFn === "function" ? copyFn : (key: string) => key;
  const sources: any[] = Array.isArray(modelBreakdown?.sources) ? modelBreakdown.sources : [];
  if (!sources.length) return [];

  const totalsByKey = new Map();
  const nameByKey = new Map();
  const nameWeight = new Map();
  let totalTokensAll = 0;

  for (const source of sources) {
    const models: any[] = Array.isArray(source?.models) ? source.models : [];
    for (const model of models) {
      const tokens = resolveDisplayTokens(model?.totals);
      if (!Number.isFinite(tokens) || tokens <= 0) continue;
      totalTokensAll += tokens;
      const name = resolveModelName(model, safeCopy("shared.placeholder.short"));
      const key = normalizeModelId(name);
      if (!key) continue;
      totalsByKey.set(key, (totalsByKey.get(key) || 0) + tokens);
      const currentWeight = nameWeight.get(key) || 0;
      if (tokens >= currentWeight) {
        nameWeight.set(key, tokens);
        nameByKey.set(key, name);
      }
    }
  }

  if (!totalsByKey.size) return [];

  const knownTotal = Array.from(totalsByKey.values()).reduce((acc, value) => acc + value, 0);
  const totalTokens = totalTokensAll > 0 ? totalTokensAll : knownTotal;

  const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 3;
  return Array.from(totalsByKey.entries())
    .map(([key, tokens]) => {
      const percent = totalTokens > 0 ? ((tokens / totalTokens) * 100).toFixed(1) : "0.0";
      return {
        id: key,
        name: nameByKey.get(key) || safeCopy("shared.placeholder.short"),
        tokens,
        percent: String(percent),
      };
    })
    .sort((a, b) => {
      if (b.tokens !== a.tokens) return b.tokens - a.tokens;
      return String(a.name).localeCompare(String(b.name));
    })
    .slice(0, normalizedLimit);
}
