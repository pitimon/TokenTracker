import { useCallback, useEffect, useRef, useState } from "react";
import { getUsageLimits } from "../lib/api";
import { publishUsageLimitsPreloadState } from "../lib/dashboard-preload.js";

interface UsageLimitsData {
  fetched_at: string;
  claude: { configured: boolean; error?: string | null; plan_label?: string | null; five_hour?: { utilization: number; resets_at?: string }; seven_day?: { utilization: number; resets_at?: string }; seven_day_opus?: { utilization: number; resets_at?: string } | null; extra_usage?: { is_enabled: boolean; monthly_limit?: number | null; used_credits?: number | null; currency?: string | null } | null };
  codex: { configured: boolean; error?: string | null; plan_label?: string | null; primary_window?: { used_percent: number; reset_at?: number; limit_window_seconds?: number } | null; secondary_window?: { used_percent: number; reset_at?: number; limit_window_seconds?: number } | null };
  cursor: { configured: boolean; error?: string | null; plan_label?: string | null; membership_type?: string | null; primary_window?: { used_percent: number; reset_at?: string | null } | null; secondary_window?: { used_percent: number; reset_at?: string | null } | null; tertiary_window?: { used_percent: number; reset_at?: string | null } | null };
  gemini: { configured: boolean; error?: string | null; plan_label?: string | null; account_email?: string | null; account_plan?: string | null; primary_window?: { used_percent: number; reset_at?: string | null } | null; secondary_window?: { used_percent: number; reset_at?: string | null } | null; tertiary_window?: { used_percent: number; reset_at?: string | null } | null };
  kimi: { configured: boolean; error?: string | null; plan_label?: string | null; membership_level?: string | null; subscription_type?: string | null; parallel_limit?: number | null; primary_window?: { used_percent: number; reset_at?: string | null } | null; secondary_window?: { used_percent: number; reset_at?: string | null } | null; tertiary_window?: { used_percent: number; reset_at?: string | null } | null };
  zai?: { configured: boolean; error?: string | null; plan_label?: string | null; account_plan?: string | null; primary_window?: { used_percent: number; reset_at?: string | null } | null; secondary_window?: { used_percent: number; reset_at?: string | null } | null; tertiary_window?: { used_percent: number; reset_at?: string | null } | null };
  kiro: { configured: boolean; error?: string | null; plan_label?: string | null; plan_name?: string | null; primary_window?: { used_percent: number; reset_at?: string | null } | null; secondary_window?: { used_percent: number; reset_at?: string | null } | null };
  antigravity: { configured: boolean; error?: string | null; plan_label?: string | null; account_email?: string | null; account_plan?: string | null; primary_window?: { used_percent: number; reset_at?: string | null } | null; secondary_window?: { used_percent: number; reset_at?: string | null } | null; tertiary_window?: { used_percent: number; reset_at?: string | null } | null };
}

interface UsageLimitsInitialState {
  data?: UsageLimitsData | null;
  error?: string | null;
  status?: string;
}

interface UseUsageLimitsOptions {
  initialRefresh?: boolean;
  initialState?: UsageLimitsInitialState | null;
  publishToPreloadCache?: boolean;
}

interface LoadUsageLimitsOptions {
  force: boolean;
  source: "page-load" | "manual-refresh";
  isManual?: boolean;
  shouldApply?: () => boolean;
}

export function useUsageLimits(options?: UseUsageLimitsOptions) {
  const hasInitialState = Boolean(options?.initialState);
  const [data, setData] = useState<UsageLimitsData | null>(() => (
    hasInitialState ? options?.initialState?.data ?? null : null
  ));
  const [error, setError] = useState<string | null>(() => (
    hasInitialState ? options?.initialState?.error ?? null : null
  ));
  const [isLoading, setIsLoading] = useState(!hasInitialState);
  const initialRefresh = Boolean(options?.initialRefresh);
  const publishToPreloadCache = Boolean(options?.publishToPreloadCache);
  const latestRequestId = useRef(0);
  const activeManualRequestIds = useRef(new Set<number>());

  const publishSuccessfulState = useCallback(
    (value: UsageLimitsData | null, source: "page-load" | "manual-refresh") => {
      if (!publishToPreloadCache || !value || typeof value !== "object") return;
      publishUsageLimitsPreloadState(value, { source });
    },
    [publishToPreloadCache],
  );

  const loadUsageLimits = useCallback(async ({
    force,
    source,
    isManual = false,
    shouldApply = () => true,
  }: LoadUsageLimitsOptions) => {
    if (!isManual && activeManualRequestIds.current.size > 0) return;

    const requestId = ++latestRequestId.current;
    if (isManual) activeManualRequestIds.current.add(requestId);

    try {
      const res = await getUsageLimits(force ? { refresh: true } : {});
      if (!shouldApply() || requestId !== latestRequestId.current) return;
      const nextData = res && typeof res === "object" ? res as UsageLimitsData : null;
      setData(nextData);
      setError(null);
      publishSuccessfulState(nextData, source);
    } catch (err) {
      if (!shouldApply() || requestId !== latestRequestId.current) return;
      setError((err as Error)?.message || String(err));
    } finally {
      if (isManual) activeManualRequestIds.current.delete(requestId);
    }
  }, [publishSuccessfulState]);

  const refresh = useCallback(
    () => loadUsageLimits({ force: true, source: "manual-refresh", isManual: true }),
    [loadUsageLimits],
  );

  const revalidate = useCallback(
    () => loadUsageLimits({ force: false, source: "page-load" }),
    [loadUsageLimits],
  );

  useEffect(() => {
    if (hasInitialState && !initialRefresh) return;
    let cancelled = false;
    void loadUsageLimits({
      force: initialRefresh,
      source: "page-load",
      shouldApply: () => !cancelled,
    }).finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [hasInitialState, initialRefresh, loadUsageLimits]);

  return { data, error, isLoading, refresh, revalidate };
}
