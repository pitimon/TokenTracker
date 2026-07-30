import {
  getMockUsageDaily,
  getMockUsageHourly,
  getMockUsageHeatmap,
  getMockUsageMonthly,
  getMockUsageModelBreakdown,
  getMockUsageCategoryBreakdown,
  getMockUsageSummary,
  getMockProjectUsageSummary,
  getMockUsageLimits,
  isMockEnabled,
} from "./mock-data";
import { getLocalApiAuthHeaders } from "./local-api-auth";

type AnyRecord = Record<string, any>;

const PATHS = {
  usageSummary: "tokentracker-usage-summary",
  usageDaily: "tokentracker-usage-daily",
  usageHourly: "tokentracker-usage-hourly",
  usageMonthly: "tokentracker-usage-monthly",
  usageHeatmap: "tokentracker-usage-heatmap",
  usageModelBreakdown: "tokentracker-usage-model-breakdown",
  usageCategoryBreakdown: "tokentracker-usage-category-breakdown",
  projectUsageSummary: "tokentracker-project-usage-summary",
  userStatus: "tokentracker-user-status",
  localSync: "tokentracker-local-sync",
  usageLimits: "tokentracker-usage-limits",
  ingestHealth: "tokentracker-ingest-health",
};

async function fetchLocalJson(slug: string, params?: AnyRecord, options?: AnyRecord) {
  const url = new URL(`/functions/${slug}`, window.location.origin);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value != null && value !== "") url.searchParams.set(key, String(value));
    }
  }
  const { accessToken: _omit, ...fetchOptions } = options || {};
  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    cache: "no-store",
    ...fetchOptions,
  });
  if (!response.ok) {
    const err: any = new Error(`Request failed with HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }
  return response.json();
}

function buildTimeZoneParams({ timeZone, tzOffsetMinutes }: AnyRecord = {}) {
  const params: AnyRecord = {};
  const tz = typeof timeZone === "string" ? timeZone.trim() : "";
  if (tz) params.tz = tz;
  if (Number.isFinite(tzOffsetMinutes)) {
    params.tz_offset_minutes = String(Math.trunc(tzOffsetMinutes));
  }
  return params;
}

function buildFilterParams({ source, model }: AnyRecord = {}) {
  const params: AnyRecord = {};
  const normalizedSource = typeof source === "string" ? source.trim().toLowerCase() : "";
  if (normalizedSource) params.source = normalizedSource;
  const normalizedModel = typeof model === "string" ? model.trim() : "";
  if (normalizedModel) params.model = normalizedModel;
  return params;
}

export async function getUsageSummary({
  from,
  to,
  source,
  model,
  timeZone,
  tzOffsetMinutes,
  rolling = false,
  accessToken,
}: AnyRecord = {}) {
  if (isMockEnabled()) {
    return getMockUsageSummary({ from, to, seed: accessToken, rolling });
  }
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildFilterParams({ source, model });
  const rollingParams = rolling ? { rolling: "1" } : {};
  return fetchLocalJson(PATHS.usageSummary, { from, to, ...filterParams, ...tzParams, ...rollingParams }, { accessToken });
}

export async function getProjectUsageSummary({
  from,
  to,
  source,
  limit,
  timeZone,
  tzOffsetMinutes,
  accessToken,
}: AnyRecord = {}) {
  if (isMockEnabled()) {
    return getMockProjectUsageSummary({ seed: accessToken, limit });
  }
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildFilterParams({ source });
  const params: AnyRecord = { ...filterParams, ...tzParams };
  if (from) params.from = from;
  if (to) params.to = to;
  if (limit != null) params.limit = String(limit);
  return fetchLocalJson(PATHS.projectUsageSummary, params);
}

export async function getUserStatus(_opts: AnyRecord = {}) {
  if (isMockEnabled()) {
    const now = new Date().toISOString();
    return {
      user_id: "local-user",
      created_at: now,
      pro: { active: false, sources: [], expires_at: null, partial: false, as_of: now },
      subscriptions: { partial: false, as_of: now, items: [] },
    };
  }
  return fetchLocalJson(PATHS.userStatus);
}

export async function triggerLocalSync({ signal }: AnyRecord = {}) {
  const authHeaders = await getLocalApiAuthHeaders();
  const response = await fetch(`/functions/${PATHS.localSync}`, {
    method: "POST",
    headers: { Accept: "application/json", ...authHeaders },
    cache: "no-store",
    signal,
  });
  const payload = await response.json().catch(() => ({
    ok: false,
    error: `Local sync request failed with HTTP ${response.status}`,
  }));
  if (!response.ok || payload?.ok === false) {
    const message = payload?.error || payload?.message || `Local sync request failed with HTTP ${response.status}`;
    const error: any = new Error(message);
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function getUsageModelBreakdown({
  from,
  to,
  source,
  timeZone,
  tzOffsetMinutes,
  accessToken,
}: AnyRecord = {}) {
  if (isMockEnabled()) {
    return getMockUsageModelBreakdown({ from, to, seed: accessToken });
  }
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildFilterParams({ source });
  return fetchLocalJson(PATHS.usageModelBreakdown, { from, to, ...filterParams, ...tzParams }, { accessToken });
}

export async function getUsageCategoryBreakdown({
  from,
  to,
  source = "claude",
  timeZone,
  tzOffsetMinutes,
}: AnyRecord = {}) {
  if (isMockEnabled()) {
    return getMockUsageCategoryBreakdown({ from, to, source });
  }
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  return fetchLocalJson(PATHS.usageCategoryBreakdown, { from, to, source, ...tzParams });
}

export async function getUsageDaily({
  from,
  to,
  source,
  model,
  timeZone,
  tzOffsetMinutes,
  accessToken,
}: AnyRecord = {}) {
  if (isMockEnabled()) {
    return getMockUsageDaily({ from, to, seed: accessToken });
  }
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildFilterParams({ source, model });
  return fetchLocalJson(PATHS.usageDaily, { from, to, ...filterParams, ...tzParams }, { accessToken });
}

export async function getUsageHourly({
  day,
  source,
  model,
  timeZone,
  tzOffsetMinutes,
  accessToken,
}: AnyRecord = {}) {
  if (isMockEnabled()) {
    return getMockUsageHourly({ day, seed: accessToken });
  }
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildFilterParams({ source, model });
  const params = day ? { day, ...filterParams, ...tzParams } : { ...filterParams, ...tzParams };
  return fetchLocalJson(PATHS.usageHourly, params, { accessToken });
}

export async function getUsageMonthly({
  months,
  to,
  source,
  model,
  timeZone,
  tzOffsetMinutes,
  accessToken,
}: AnyRecord = {}) {
  if (isMockEnabled()) {
    return getMockUsageMonthly({ months, to, seed: accessToken });
  }
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildFilterParams({ source, model });
  return fetchLocalJson(PATHS.usageMonthly, {
    ...(months ? { months: String(months) } : {}),
    ...(to ? { to } : {}),
    ...filterParams,
    ...tzParams,
  }, { accessToken });
}

export async function getUsageLimits(opts: { refresh?: boolean } = {}) {
  if (isMockEnabled()) {
    return getMockUsageLimits();
  }
  const params = opts?.refresh ? { refresh: "1" } : undefined;
  return fetchLocalJson(PATHS.usageLimits, params);
}

export async function getIngestHealth(_opts: AnyRecord = {}) {
  return fetchLocalJson(PATHS.ingestHealth);
}

export async function getUsageHeatmap({
  weeks,
  to,
  weekStartsOn,
  source,
  model,
  timeZone,
  tzOffsetMinutes,
  accessToken,
}: AnyRecord = {}) {
  if (isMockEnabled()) {
    return getMockUsageHeatmap({ weeks, to, weekStartsOn, seed: accessToken });
  }
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildFilterParams({ source, model });
  return fetchLocalJson(PATHS.usageHeatmap, {
    weeks: String(weeks),
    to,
    week_starts_on: weekStartsOn,
    ...filterParams,
    ...tzParams,
  }, { accessToken });
}
