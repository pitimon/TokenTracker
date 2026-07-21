import { useCallback, useEffect, useRef, useState } from "react";
import { isMockEnabled } from "../lib/mock-data";
import { getTimeZoneCacheKey } from "../lib/timezone";
import { getUsageDaily, getUsageHourly } from "../lib/api";
import { computePulse } from "../lib/pulse-stats";
import {
  buildPlan,
  dailyByDayMap,
  hourlyByDayMap,
  localHour,
  reduceDaySlices,
  reduceWindowSlices,
  todayKeyFor,
} from "../lib/pulse-plan";

function safeHost(baseUrl: any) {
  try {
    return new URL(baseUrl).host;
  } catch (_e) {
    return null;
  }
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

  // Only reuse a cache entry captured at the SAME cutoff hour. The storage key
  // is keyed by day (not hour), so an entry written earlier today would render
  // last hour's deltas under the current "same time of day" label — return null
  // and let the fetch refill instead.
  const readFreshCache = useCallback(() => {
    const cached = readCache();
    return cached && cached.cutoffHour === cutoffHour ? cached : null;
  }, [readCache, cutoffHour]);

  const refresh = useCallback(async () => {
    const plan = buildPlan(period, todayKey);
    if (!plan) {
      setPulse(null);
      setError(null);
      return;
    }

    const reqId = ++reqRef.current;
    setLoading(true);
    setError(null);
    try {
      const hourlyResponses = await Promise.all(
        plan.hourlyDays.map((day) =>
          getUsageHourly({ baseUrl, accessToken, day, timeZone, tzOffsetMinutes }),
        ),
      );
      const hourlyByDay = hourlyByDayMap(plan.hourlyDays, hourlyResponses);

      let slices;
      if (plan.kind === "day") {
        slices = reduceDaySlices(plan, hourlyByDay, cutoffHour);
      } else {
        const dailyRes = await getUsageDaily({
          baseUrl,
          accessToken,
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
      const cached = readFreshCache();
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
    readFreshCache,
    writeCache,
  ]);

  // Seed from cache for an instant paint (stale-while-revalidate). Only a
  // same-hour entry is used, so a stale earlier-hour pulse never flashes.
  useEffect(() => {
    if (period === "total" || period === "custom") {
      setPulse(null);
      return;
    }
    const cached = readFreshCache();
    if (cached?.pulse) setPulse(cached.pulse);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, period, cutoffHour]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { pulse, loading, error, refresh };
}
