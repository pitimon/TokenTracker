import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUsageLimits } from "../lib/api";
import { publishUsageLimitsPreloadState } from "../lib/dashboard-preload.js";
import { useUsageLimits } from "./use-usage-limits";

vi.mock("../lib/api", () => ({
  getUsageLimits: vi.fn(),
}));

vi.mock("../lib/dashboard-preload.js", () => ({
  publishUsageLimitsPreloadState: vi.fn(),
}));

const existingLimits = {
  fetched_at: "2026-05-30T10:00:00.000Z",
  claude: { configured: false },
  codex: { configured: false },
  cursor: { configured: false },
  gemini: { configured: false },
  kimi: {
    configured: true,
    primary_window: { used_percent: 42, reset_at: "2026-05-30T12:00:00.000Z" },
  },
  kiro: { configured: false },
  antigravity: { configured: false },
};

const freshLimits = {
  ...existingLimits,
  fetched_at: "2026-05-30T10:05:00.000Z",
  kimi: {
    configured: true,
    primary_window: { used_percent: 18, reset_at: "2026-05-30T12:30:00.000Z" },
  },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("useUsageLimits", () => {
  beforeEach(() => {
    vi.mocked(getUsageLimits).mockReset();
    vi.mocked(publishUsageLimitsPreloadState).mockReset();
  });

  it("uses reusable initial data immediately and writes the background refresh back to cache", async () => {
    vi.mocked(getUsageLimits).mockResolvedValue(freshLimits);

    const { result } = renderHook(() =>
      useUsageLimits({
        initialRefresh: true,
        initialState: { data: existingLimits },
        publishToPreloadCache: true,
      }),
    );

    expect(result.current.data).toBe(existingLimits);
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);

    await waitFor(() => expect(result.current.data).toEqual(freshLimits));

    expect(getUsageLimits).toHaveBeenCalledWith({ refresh: true });
    expect(publishUsageLimitsPreloadState).toHaveBeenCalledWith(freshLimits, {
      source: "page-load",
    });
  });

  it("keeps the initialRefresh fallback when no reusable initial data exists", async () => {
    vi.mocked(getUsageLimits).mockResolvedValue(freshLimits);

    const { result } = renderHook(() => useUsageLimits({ initialRefresh: true }));

    expect(result.current.data).toBeNull();
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(getUsageLimits).toHaveBeenCalledWith({ refresh: true });
    expect(result.current.data).toEqual(freshLimits);
    expect(result.current.error).toBeNull();
  });

  it("keeps initial cached data visible when the background refresh fails", async () => {
    vi.mocked(getUsageLimits).mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() =>
      useUsageLimits({
        initialRefresh: true,
        initialState: { data: existingLimits },
        publishToPreloadCache: true,
      }),
    );

    expect(result.current.data).toBe(existingLimits);
    expect(result.current.isLoading).toBe(false);

    await waitFor(() => expect(result.current.error).toBe("network down"));

    expect(result.current.data).toBe(existingLimits);
    expect(publishUsageLimitsPreloadState).not.toHaveBeenCalled();
  });

  it("forces refresh manually and writes cache with the manual-refresh source", async () => {
    vi.mocked(getUsageLimits).mockResolvedValue(freshLimits);

    const { result } = renderHook(() =>
      useUsageLimits({
        initialRefresh: false,
        initialState: { data: existingLimits },
        publishToPreloadCache: true,
      }),
    );

    await Promise.resolve();
    expect(getUsageLimits).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.refresh();
    });

    expect(getUsageLimits).toHaveBeenCalledTimes(1);
    expect(getUsageLimits).toHaveBeenCalledWith({ refresh: true });
    expect(result.current.data).toEqual(freshLimits);
    expect(publishUsageLimitsPreloadState).toHaveBeenCalledWith(freshLimits, {
      source: "manual-refresh",
    });
  });

  it("revalidates through the cache-aware endpoint and retains the last good data on failure", async () => {
    vi.mocked(getUsageLimits)
      .mockResolvedValueOnce(freshLimits)
      .mockRejectedValueOnce(new Error("network down"));

    const { result } = renderHook(() =>
      useUsageLimits({
        initialRefresh: false,
        initialState: { data: existingLimits },
        publishToPreloadCache: true,
      }),
    );

    await act(async () => {
      await result.current.revalidate();
    });

    expect(getUsageLimits).toHaveBeenCalledTimes(1);
    expect(getUsageLimits).not.toHaveBeenCalledWith({ refresh: true });
    expect(result.current.data).toEqual(freshLimits);
    expect(result.current.error).toBeNull();
    expect(publishUsageLimitsPreloadState).toHaveBeenCalledWith(freshLimits, {
      source: "page-load",
    });

    await act(async () => {
      await result.current.revalidate();
    });

    expect(getUsageLimits).toHaveBeenCalledTimes(2);
    expect(getUsageLimits).not.toHaveBeenNthCalledWith(2, { refresh: true });
    expect(result.current.data).toEqual(freshLimits);
    expect(result.current.error).toBe("network down");
    expect(result.current.isLoading).toBe(false);
    expect(publishUsageLimitsPreloadState).toHaveBeenCalledTimes(1);
  });

  it("lets manual refresh supersede an in-flight revalidation", async () => {
    const revalidation = deferred<typeof existingLimits>();
    const manualRefresh = deferred<typeof freshLimits>();
    vi.mocked(getUsageLimits)
      .mockReturnValueOnce(revalidation.promise)
      .mockReturnValueOnce(manualRefresh.promise);

    const { result } = renderHook(() =>
      useUsageLimits({
        initialRefresh: false,
        initialState: { data: existingLimits },
        publishToPreloadCache: true,
      }),
    );

    let revalidatePromise: Promise<void> | undefined;
    let refreshPromise: Promise<void> | undefined;
    act(() => {
      revalidatePromise = result.current.revalidate();
      refreshPromise = result.current.refresh();
    });

    expect(getUsageLimits).toHaveBeenCalledTimes(2);
    expect(getUsageLimits).not.toHaveBeenNthCalledWith(1, { refresh: true });
    expect(getUsageLimits).toHaveBeenNthCalledWith(2, { refresh: true });

    await act(async () => {
      manualRefresh.resolve(freshLimits);
      await refreshPromise;
    });

    await act(async () => {
      revalidation.reject(new Error("stale background failure"));
      await revalidatePromise;
    });

    expect(result.current.data).toEqual(freshLimits);
    expect(result.current.error).toBeNull();
    expect(publishUsageLimitsPreloadState).toHaveBeenCalledTimes(1);
    expect(publishUsageLimitsPreloadState).toHaveBeenCalledWith(freshLimits, {
      source: "manual-refresh",
    });
  });

  it("does not start revalidation while a manual refresh is in flight", async () => {
    const manualRefresh = deferred<typeof freshLimits>();
    vi.mocked(getUsageLimits).mockReturnValueOnce(manualRefresh.promise);

    const { result } = renderHook(() =>
      useUsageLimits({
        initialRefresh: false,
        initialState: { data: existingLimits },
      }),
    );

    let refreshPromise: Promise<void> | undefined;
    act(() => {
      refreshPromise = result.current.refresh();
    });

    await act(async () => {
      await result.current.revalidate();
    });

    expect(getUsageLimits).toHaveBeenCalledTimes(1);
    expect(getUsageLimits).toHaveBeenCalledWith({ refresh: true });

    await act(async () => {
      manualRefresh.resolve(freshLimits);
      await refreshPromise;
    });

    expect(result.current.data).toEqual(freshLimits);
  });

  it("keeps the manual guard while a later manual refresh is still in flight", async () => {
    const firstManualRefresh = deferred<typeof existingLimits>();
    const secondManualRefresh = deferred<typeof freshLimits>();
    vi.mocked(getUsageLimits)
      .mockReturnValueOnce(firstManualRefresh.promise)
      .mockReturnValueOnce(secondManualRefresh.promise);

    const { result } = renderHook(() =>
      useUsageLimits({
        initialRefresh: false,
        initialState: { data: existingLimits },
      }),
    );

    let firstRefreshPromise: Promise<void> | undefined;
    let secondRefreshPromise: Promise<void> | undefined;
    act(() => {
      firstRefreshPromise = result.current.refresh();
      secondRefreshPromise = result.current.refresh();
    });

    await act(async () => {
      firstManualRefresh.resolve(existingLimits);
      await firstRefreshPromise;
    });

    await act(async () => {
      await result.current.revalidate();
    });

    expect(getUsageLimits).toHaveBeenCalledTimes(2);

    await act(async () => {
      secondManualRefresh.resolve(freshLimits);
      await secondRefreshPromise;
    });

    expect(result.current.data).toEqual(freshLimits);
  });
});
