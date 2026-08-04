import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardPage } from "./DashboardPage.jsx";

// Which usage-limits call the dashboard makes is the whole point of this file:
// a forced fetch clears the CLI's two-minute quota cache and fans out to every
// configured provider, so only an explicit user action may trigger it. Both
// scheduled passes — the interval tick and the post-sync follow-up — must go
// through the cache-aware revalidate instead.
const mocks = vi.hoisted(() => ({
  refreshUsageLimits: vi.fn(() => Promise.resolve()),
  revalidateUsageLimits: vi.fn(() => Promise.resolve()),
  triggerLocalSync: vi.fn(() => Promise.resolve({ stdout: "New 30-min buckets queued: 0" })),
  getUserStatus: vi.fn(() => Promise.resolve(null)),
  getIngestHealth: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("../hooks/use-usage-limits.js", () => ({
  useUsageLimits: () => ({
    data: null,
    error: null,
    isLoading: false,
    refresh: mocks.refreshUsageLimits,
    revalidate: mocks.revalidateUsageLimits,
  }),
}));

vi.mock("../lib/api", () => ({
  getIngestHealth: mocks.getIngestHealth,
  getUserStatus: mocks.getUserStatus,
  triggerLocalSync: mocks.triggerLocalSync,
}));

vi.mock("../hooks/use-usage-data.js", () => ({
  useUsageData: () => ({
    daily: [],
    summary: null,
    rolling: null,
    source: null,
    loading: false,
    error: null,
    refresh: () => Promise.resolve(),
  }),
}));

vi.mock("../hooks/use-usage-model-breakdown.js", () => ({
  useUsageModelBreakdown: () => ({
    breakdown: null,
    loading: false,
    refresh: () => Promise.resolve(),
  }),
}));

vi.mock("../hooks/use-trend-data.js", () => ({
  useTrendData: () => ({
    rows: [],
    from: null,
    to: null,
    loading: false,
    refresh: () => Promise.resolve(),
  }),
}));

vi.mock("../hooks/use-activity-heatmap.js", () => ({
  useActivityHeatmap: () => ({
    daily: [],
    heatmap: null,
    loading: false,
    refresh: () => Promise.resolve(),
  }),
}));

vi.mock("../hooks/use-project-usage-summary", () => ({
  useProjectUsageSummary: () => ({
    entries: [],
    unattributedSources: [],
    loading: false,
    refresh: () => Promise.resolve(),
  }),
}));

vi.mock("../hooks/use-pulse", () => ({
  usePulse: () => ({ pulse: null, refresh: () => Promise.resolve() }),
}));

vi.mock("../hooks/use-plan-prices", () => ({
  usePlanPrices: () => ({ planPrices: {}, setPlanPrice: () => {} }),
}));

vi.mock("../hooks/use-limits-display-prefs.js", () => ({
  useLimitsDisplayPrefs: () => ({ displayMode: "used" }),
}));

vi.mock("../hooks/useLocale.js", () => ({
  useLocale: () => ({ resolvedLocale: "en" }),
}));

vi.mock("../hooks/useCurrency.js", () => ({
  useCurrency: () => ({ currency: "USD", rate: 1 }),
}));

vi.mock("../ui/dashboard/components/IngestHealthNotice.jsx", () => ({
  IngestHealthNotice: () => null,
}));

// The real view is irrelevant here; all it has to do is expose the manual
// refresh entry point the header button is wired to.
vi.mock("../ui/dashboard/views/DashboardView.jsx", () => ({
  DashboardView: ({ refreshAll }) => (
    <button
      type="button"
      data-testid="manual-refresh"
      aria-label="manual refresh"
      onClick={() => void refreshAll()}
    />
  ),
}));

const AUTO_REFRESH_INTERVAL_MS = 30000;

function setVisibility(state) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

async function renderDashboard() {
  const view = render(<DashboardPage baseUrl="" />);
  // Let the mount effects (user status, ingest health) settle so nothing from
  // page load is still in flight when the assertions start.
  await act(async () => {});
  return view;
}

async function advanceOneAutoRefreshTick() {
  await act(async () => {
    vi.advanceTimersByTime(AUTO_REFRESH_INTERVAL_MS);
  });
  // The post-sync follow-up is chained off the sync promise, not awaited by
  // the tick, so it lands a microtask later.
  await act(async () => {});
}

describe("DashboardPage usage-limits refresh semantics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.refreshUsageLimits.mockClear();
    mocks.revalidateUsageLimits.mockClear();
    mocks.getUserStatus.mockClear();
    mocks.getIngestHealth.mockClear();
    mocks.triggerLocalSync.mockReset();
    mocks.triggerLocalSync.mockResolvedValue({ stdout: "New 30-min buckets queued: 0" });
    window.localStorage.clear();
    setVisibility("visible");
  });

  it("revalidates usage limits on a scheduled refresh instead of forcing a provider fan-out", async () => {
    await renderDashboard();

    expect(mocks.revalidateUsageLimits).not.toHaveBeenCalled();
    expect(mocks.refreshUsageLimits).not.toHaveBeenCalled();

    await advanceOneAutoRefreshTick();

    expect(mocks.revalidateUsageLimits).toHaveBeenCalledTimes(1);
    expect(mocks.refreshUsageLimits).not.toHaveBeenCalled();
  });

  it("keeps the post-sync follow-up cache-aware when the background sync queued buckets", async () => {
    mocks.triggerLocalSync.mockResolvedValue({ stdout: "New 30-min buckets queued: 3" });

    await renderDashboard();
    await advanceOneAutoRefreshTick();

    // Two scheduled passes: the tick itself, then the follow-up that runs
    // because the sync queued new buckets. Neither may force.
    expect(mocks.revalidateUsageLimits).toHaveBeenCalledTimes(2);
    expect(mocks.refreshUsageLimits).not.toHaveBeenCalled();
  });

  it("forces usage limits when the user asks for a refresh", async () => {
    await renderDashboard();

    await act(async () => {
      fireEvent.click(screen.getByTestId("manual-refresh"));
    });

    expect(mocks.refreshUsageLimits).toHaveBeenCalledTimes(1);
    expect(mocks.revalidateUsageLimits).not.toHaveBeenCalled();
  });

  it("keeps scheduled and manual semantics apart within one session", async () => {
    await renderDashboard();

    await advanceOneAutoRefreshTick();
    await act(async () => {
      fireEvent.click(screen.getByTestId("manual-refresh"));
    });
    await advanceOneAutoRefreshTick();

    expect(mocks.revalidateUsageLimits).toHaveBeenCalledTimes(2);
    expect(mocks.refreshUsageLimits).toHaveBeenCalledTimes(1);
  });

  // The wake handlers run the same scheduled pass as the interval tick, just
  // triggered by the tab coming back instead of by time. They are a separate
  // call site (DashboardPage.jsx:857-859), so they need their own coverage —
  // rewiring them to force would otherwise slip past every test above.
  it("keeps a window focus wake cache-aware", async () => {
    await renderDashboard();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await act(async () => {});

    expect(mocks.revalidateUsageLimits).toHaveBeenCalledTimes(1);
    expect(mocks.refreshUsageLimits).not.toHaveBeenCalled();
  });

  it("keeps a visibility wake cache-aware, and skips it while the tab is hidden", async () => {
    await renderDashboard();

    setVisibility("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {});

    expect(mocks.revalidateUsageLimits).not.toHaveBeenCalled();
    expect(mocks.refreshUsageLimits).not.toHaveBeenCalled();

    setVisibility("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {});

    expect(mocks.revalidateUsageLimits).toHaveBeenCalledTimes(1);
    expect(mocks.refreshUsageLimits).not.toHaveBeenCalled();
  });

  it("does not schedule any usage-limits work when auto refresh is off", async () => {
    window.localStorage.setItem("tt:dashboard-auto-refresh-ms", "0");

    await renderDashboard();
    await advanceOneAutoRefreshTick();

    expect(mocks.revalidateUsageLimits).not.toHaveBeenCalled();
    expect(mocks.refreshUsageLimits).not.toHaveBeenCalled();
  });
});
