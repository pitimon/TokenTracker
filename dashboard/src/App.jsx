import React, { lazy, Suspense, useCallback, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { useLocale } from "./hooks/useLocale.js";
import { ThemeProvider } from "./ui/foundation/ThemeProvider.jsx";
import { getBackendBaseUrl } from "./lib/config";
import { isScreenshotModeEnabled } from "./lib/screenshot-mode";
import { AppLayout } from "./ui/components/Sidebar.jsx";
import { CommandPalette } from "./ui/dashboard/components/CommandPalette.jsx";
import { ToastProvider } from "./ui/components/Toast.jsx";
import {
  markDashboardMainContentVisible,
  preloadDashboardPageResource,
} from "./lib/dashboard-preload.js";

// Pages are lazy-loaded so each route ships in its own chunk; keeps the
// initial main bundle small. Routes are mutually exclusive, so only one
// chunk loads per navigation.
const DashboardPage = lazy(() =>
  import("./pages/DashboardPage.jsx").then((m) => ({ default: m.DashboardPage })),
);
const IpCheckPage = lazy(() => import("./pages/IpCheckPage.jsx"));
const LimitsPage = lazy(() =>
  import("./pages/LimitsPage.jsx").then((m) => ({ default: m.LimitsPage })),
);
const WrappedPage = lazy(() => import("./pages/WrappedPage.jsx"));
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage.jsx").then((m) => ({ default: m.SettingsPage })),
);
const SkillsPage = lazy(() =>
  import("./pages/SkillsPage.jsx").then((m) => ({ default: m.SkillsPage })),
);
const WidgetsPage = lazy(() =>
  import("./pages/WidgetsPage.jsx").then((m) => ({ default: m.WidgetsPage })),
);


export default function App() {
  // Subscribing to locale here makes App rerender on language switch, which
  // rebuilds every child element reference and triggers copy() re-evaluation
  // across the tree — without unmounting lazy-loaded pages.
  const { resolvedLocale } = useLocale();
  const location = useLocation();
  const dashboardMainContentVisibleRef = useRef(false);
  const dashboardResourcePreloadStartedRef = useRef(false);
  const screenshotMode = useMemo(() => {
    if (typeof window === "undefined") return false;
    return isScreenshotModeEnabled(window.location.search);
  }, []);
  const pathname = location?.pathname || "/";
  const baseUrl = getBackendBaseUrl();

  const normalizedPath = pathname.replace(/\/+$/, "") || "/";
  const isDashboardDefaultPath = normalizedPath === "/" || normalizedPath === "/dashboard";
  const isLimitsPath = normalizedPath === "/limits";
  const isSettingsPath = normalizedPath === "/settings";
  const isSkillsPath = normalizedPath === "/skills";
  const isWidgetsPath = normalizedPath === "/widgets";
  const isIpCheckPath = normalizedPath === "/ip-check";
  const isWrappedPath = normalizedPath === "/wrapped";

  const handleDashboardMainContentVisible = useCallback(() => {
    if (!isDashboardDefaultPath) return;
    if (!dashboardMainContentVisibleRef.current) {
      dashboardMainContentVisibleRef.current = true;
      markDashboardMainContentVisible();
    }
    if (!dashboardResourcePreloadStartedRef.current) {
      dashboardResourcePreloadStartedRef.current = true;
      void preloadDashboardPageResource("limits");
    }
  }, [isDashboardDefaultPath]);

  let PageComponent = DashboardPage;
  if (isLimitsPath) {
    PageComponent = LimitsPage;
  } else if (isSettingsPath) {
    PageComponent = SettingsPage;
  } else if (isSkillsPath) {
    PageComponent = SkillsPage;
  } else if (isWidgetsPath) {
    PageComponent = WidgetsPage;
  } else if (isIpCheckPath) {
    PageComponent = IpCheckPage;
  }

  const showSidebar =
    normalizedPath === "/dashboard" ||
    normalizedPath === "/" ||
    isLimitsPath ||
    isSettingsPath ||
    isSkillsPath ||
    isWidgetsPath ||
    isIpCheckPath;

  let content = null;
  if (isWrappedPath) {
    // Year-end Wrapped page. Reads from /functions/tokentracker-wrapped
    // (provided by the local CLI server) — no auth required.
    content = <WrappedPage />;
  } else {
    const pageNode = (
      <PageComponent
        key={resolvedLocale}
        baseUrl={baseUrl}
        onMainContentVisible={handleDashboardMainContentVisible}
      />
    );
    content = showSidebar ? <AppLayout>{pageNode}</AppLayout> : pageNode;
  }

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <Suspense fallback={null}>{content}</Suspense>
          {showSidebar ? <CommandPalette /> : null}
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
