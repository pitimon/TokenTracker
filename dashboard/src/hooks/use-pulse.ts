import { useCallback, useEffect, useRef, useState } from "react";
import { resolveAuthAccessToken } from "../lib/auth-token";
import { isMockEnabled } from "../lib/mock-data";
import { getTimeZoneCacheKey } from "../lib/timezone";
import { getUsageDaily, getUsageHourly } from "../lib/api";
import {
  addSlices,
  computePulse,
  meanSlice,
  sumBucketsUpToHour,
  type Slice,
} from "../lib/pulse-stats";

const DAY_MS = 86_400_000;

function safeHost(baseUrl: any) {
  try {
    return new URL(baseUrl).host;
  } catch (_e) {
    return null;
  }
}

function parseDayKey(key: string): number | null {
  const parts = String(key).split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return Date.UTC(parts[0], parts[1] - 1, parts[2]);
}

function formatDayKey(ms: number): string {
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function shiftDayKey(key: string, deltaDays: number): string | null {
  const ms = parseDayKey(key);
  return ms == null ? null : formatDayKey(ms + deltaDays * DAY_MS);
}

// Current wall-clock hour (0..23) in the user's timezone — the inclusive cutoff
// for same-elapsed truncation. Prefers the IANA zone, falls back to a fixed
// offset, then to the host clock.
function localHour(now: Date, { timeZone, offsetMinutes }: any): number {
  const dt = now instanceof Date ? now : new Date(now);
  if (timeZone && typeof Intl !== "undefined" && Intl.DateTimeFormat) {
    try {
      const fmt = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hour12: false });
      let hh = Number(fmt.format(dt).slice(0, 2));
      if (hh === 24) hh = 0; // some engines render midnight as "24"
      if (Number.isFinite(hh)) return Math.min(23, Math.max(0, hh));
    } catch (_e) {
      // fall through
    }
  }
  if (typeof offsetMinutes === "number" && Number.isFinite(offsetMinutes)) {
    return new Date(dt.getTime() + offsetMinutes * 60000).getUTCHours();
  }
  return dt.getHours();
}

// A day key -> local day key for the user's timezone.
function todayKeyFor(now: Date, { timeZone, offsetMinutes }: any): string {
  const dt = now instanceof Date ? now : new Date(now);
  if (timeZone && typeof Intl !== "undefined" && Intl.DateTimeFormat) {
    try {
      const fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      const s = fmt.format(dt); // en-CA => YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    } catch (_e) {
      // fall through
    }
  }
  if (typeof offsetMinutes === "number" && Number.isFinite(offsetMinutes)) {
    return formatDayKey(dt.getTime() + offsetMinutes * 60000);
  }
  return formatDayKey(dt.getTime());
}

const tokensOf = (row: any): number => Number(row?.total_tokens ?? 0) || 0;
const costOf = (row: any): number => Number(row?.total_cost_usd ?? 0) || 0;

// Sum daily {tokens, cost} over an inclusive day-key range from a keyed map.
function dailyRangeSlice(
  dailyByDay: Map<string, Slice>,
  startKey: string | null,
  endKeyInclusive: string | null,
): Slice {
  let out: Slice = { tokens: 0, cost: 0 };
  const start = startKey ? parseDayKey(startKey) : null;
  const end = endKeyInclusive ? parseDayKey(endKeyInclusive) : null;
  if (start == null || end == null || start > end) return out;
  for (let ms = start; ms <= end; ms += DAY_MS) {
    const slice = dailyByDay.get(formatDayKey(ms));
    if (slice) out = addSlices(out, slice);
  }
  return out;
}

// Describe what to fetch/compute for a period, or null when the pulse is hidden.
function buildPlan(period: string, todayKey: string) {
  if (!todayKey || period === "total") return null;

  if (period === "day" || period === "24h") {
    const trailingKeys: string[] = [];
    for (let d = 1; d <= 7; d++) {
      const k = shiftDayKey(todayKey, -d);
      if (k) trailingKeys.push(k);
    }
    return {
      kind: "day" as const,
      hourlyDays: [todayKey, ...trailingKeys],
      dailyFrom: null,
      dailyTo: null,
      todayKey,
      prevKey: shiftDayKey(todayKey, -1),
      trailingKeys,
    };
  }

  const span = period === "week" ? 6 : period === "month" ? 29 : null;
  if (span == null) return null; // custom & anything else: no pulse in v1

  const windowLen = span + 1;
  const prevBoundaryKey = shiftDayKey(todayKey, -windowLen); // partial-equivalent day of prev window
  return {
    kind: "window" as const,
    hourlyDays: [todayKey, prevBoundaryKey].filter(Boolean) as string[],
    dailyFrom: shiftDayKey(todayKey, -(windowLen * 2 - 1)),
    dailyTo: todayKey,
    todayKey,
    curStartKey: shiftDayKey(todayKey, -span),
    prevBoundaryKey,
    prevStartKey: shiftDayKey(todayKey, -(windowLen * 2 - 1)),
  };
}

function hourlyByDayMap(days: string[], responses: any[]): Map<string, any[]> {
  const map = new Map<string, any[]>();
  days.forEach((day, i) => {
    map.set(day, Array.isArray(responses[i]?.data) ? responses[i].data : []);
  });
  return map;
}

function dailyByDayMap(dailyRes: any): Map<string, Slice> {
  const map = new Map<string, Slice>();
  for (const row of Array.isArray(dailyRes?.data) ? dailyRes.data : []) {
    if (row?.day) map.set(String(row.day), { tokens: tokensOf(row), cost: costOf(row) });
  }
  return map;
}

// Day view: current = today so far, prev = yesterday so far, trailingAvg = mean
// of the 7 prior days each truncated to the same clock hour.
function reduceDaySlices(plan: any, hourlyByDay: Map<string, any[]>, cutoffHour: number) {
  return {
    current: sumBucketsUpToHour(hourlyByDay.get(plan.todayKey), cutoffHour),
    prev: plan.prevKey ? sumBucketsUpToHour(hourlyByDay.get(plan.prevKey), cutoffHour) : null,
    trailingAvg: meanSlice(
      plan.trailingKeys.map((k: string) => sumBucketsUpToHour(hourlyByDay.get(k), cutoffHour)),
    ),
  };
}

// Week/month view: each window = completed days (daily aggregates) + the
// partial/boundary day truncated to the cutoff hour (hourly). No trailing avg.
function reduceWindowSlices(
  plan: any,
  hourlyByDay: Map<string, any[]>,
  dailyByDay: Map<string, Slice>,
  cutoffHour: number,
) {
  const current = addSlices(
    dailyRangeSlice(dailyByDay, plan.curStartKey, shiftDayKey(plan.todayKey, -1)),
    sumBucketsUpToHour(hourlyByDay.get(plan.todayKey), cutoffHour),
  );
  const prev = addSlices(
    dailyRangeSlice(
      dailyByDay,
      plan.prevStartKey,
      plan.prevBoundaryKey ? shiftDayKey(plan.prevBoundaryKey, -1) : null,
    ),
    plan.prevBoundaryKey
      ? sumBucketsUpToHour(hourlyByDay.get(plan.prevBoundaryKey), cutoffHour)
      : { tokens: 0, cost: 0 },
  );
  return { current, prev, trailingAvg: null };
}

// "Today's Pulse" data hook. Fetches the minimum hourly data needed for a
// same-elapsed comparison (only the partial/boundary days) plus daily
// aggregates for the completed days, then reduces to a Pulse via computePulse.
export function usePulse({
  baseUrl,
  accessToken,
  guestAllowed = false,
  period,
  timeZone,
  tzOffsetMinutes,
  now,
  cacheKey,
}: any = {}) {
  const [pulse, setPulse] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef(0);

  const dashboardNow = now instanceof Date ? now : new Date(now || Date.now());
  const todayKey = todayKeyFor(dashboardNow, { timeZone, offsetMinutes: tzOffsetMinutes });
  const cutoffHour = localHour(dashboardNow, { timeZone, offsetMinutes: tzOffsetMinutes });

  const mockEnabled = isMockEnabled();
  const cacheAllowed = !guestAllowed && !mockEnabled;
  const isLocalMode =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

  const storageKey = (() => {
    if (!cacheKey) return null;
    const host = safeHost(baseUrl) || "default";
    const tzKey = getTimeZoneCacheKey({ timeZone, offsetMinutes: tzOffsetMinutes });
    return `tokentracker.pulse.${cacheKey}.${host}.${period}.${todayKey}.${tzKey}`;
  })();

  const readCache = useCallback(() => {
    if (!storageKey || typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch (_e) {
      return null;
    }
  }, [storageKey]);

  const writeCache = useCallback(
    (payload: any) => {
      if (!storageKey || typeof window === "undefined") return;
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(payload));
      } catch (_e) {
        // ignore quota / private-mode write errors
      }
    },
    [storageKey],
  );

  const refresh = useCallback(async () => {
    const plan = buildPlan(period, todayKey);
    if (!plan) {
      setPulse(null);
      setError(null);
      return;
    }

    const resolvedToken = await resolveAuthAccessToken(accessToken);
    if (!resolvedToken && !mockEnabled && !isLocalMode) {
      // Guest / not-ready: keep whatever we have, don't error out.
      return;
    }

    const reqId = ++reqRef.current;
    setLoading(true);
    setError(null);
    try {
      const hourlyResponses = await Promise.all(
        plan.hourlyDays.map((day) =>
          getUsageHourly({ baseUrl, accessToken: resolvedToken, day, timeZone, tzOffsetMinutes }),
        ),
      );
      const hourlyByDay = hourlyByDayMap(plan.hourlyDays, hourlyResponses);

      let slices;
      if (plan.kind === "day") {
        slices = reduceDaySlices(plan, hourlyByDay, cutoffHour);
      } else {
        const dailyRes = await getUsageDaily({
          baseUrl,
          accessToken: resolvedToken,
          from: plan.dailyFrom,
          to: plan.dailyTo,
          timeZone,
          tzOffsetMinutes,
        });
        slices = reduceWindowSlices(plan, hourlyByDay, dailyByDayMap(dailyRes), cutoffHour);
      }

      const nextPulse = computePulse({ ...slices, period });

      if (reqId !== reqRef.current) return; // a newer request superseded this one
      setPulse(nextPulse);
      if (cacheAllowed && nextPulse) {
        writeCache({ pulse: nextPulse, todayKey, cutoffHour, fetchedAt: new Date().toISOString() });
      }
    } catch (e: any) {
      if (reqId !== reqRef.current) return;
      const cached = readCache();
      if (cached?.pulse) {
        setPulse(cached.pulse);
      }
      setError(e?.message ? String(e.message) : "Failed to load pulse");
    } finally {
      if (reqId === reqRef.current) setLoading(false);
    }
  }, [
    baseUrl,
    accessToken,
    guestAllowed,
    period,
    timeZone,
    tzOffsetMinutes,
    todayKey,
    cutoffHour,
    cacheAllowed,
    mockEnabled,
    isLocalMode,
    readCache,
    writeCache,
  ]);

  // Seed from cache for an instant paint (stale-while-revalidate).
  useEffect(() => {
    if (period === "total" || period === "custom") {
      setPulse(null);
      return;
    }
    const cached = readCache();
    if (cached?.pulse) setPulse(cached.pulse);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, period]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { pulse, loading, error, refresh };
}
