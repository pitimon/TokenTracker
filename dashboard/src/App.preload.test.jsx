import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.jsx";
import { markDashboardMainContentVisible, preloadDashboardPageResource } from "./lib/dashboard-preload.js";

const TEXT = {
  dashboard: "Dashboard page",
  ipCheck: "IP check",
  limits: "Limits page",
  reveal: "reveal main content",
  settings: "Settings page",
  skills: "Skills page",
  widgets: "Widgets page",
  wrapped: "Wrapped page",
};

vi.mock("./lib/dashboard-preload.js", () => ({
  markDashboardMainContentVisible: vi.fn(),
  preloadDashboardPageResource: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("./hooks/useLocale.js", () => ({
  useLocale: () => ({ resolvedLocale: "en" }),
}));

vi.mock("./lib/config", () => ({
  getBackendBaseUrl: () => "",
}));

vi.mock("./lib/screenshot-mode", () => ({
  isScreenshotModeEnabled: () => false,
}));

vi.mock("./components/ErrorBoundary.jsx", () => ({
  ErrorBoundary: ({ children }) => <>{children}</>,
}));

vi.mock("./ui/foundation/ThemeProvider.jsx", () => ({
  ThemeProvider: ({ children }) => <>{children}</>,
}));

vi.mock("./ui/components/Sidebar.jsx", () => ({
  AppLayout: ({ children }) => (
    <div>
      <a href="/limits" onClick={(event) => event.preventDefault()}>
        Limits nav
      </a>
      {children}
    </div>
  ),
}));

vi.mock("./ui/dashboard/components/CommandPalette.jsx", () => ({
  CommandPalette: () => null,
}));

vi.mock("./pages/DashboardPage.jsx", () => ({
  DashboardPage: ({ onMainContentVisible }) => (
    <main>
      <h1>{TEXT.dashboard}</h1>
      <button type="button" onClick={onMainContentVisible}>
        {TEXT.reveal}
      </button>
    </main>
  ),
}));

vi.mock("./pages/LimitsPage.jsx", () => ({
  LimitsPage: ({ onMainContentVisible }) => {
    React.useEffect(() => {
      onMainContentVisible?.();
    }, [onMainContentVisible]);
    return <main>{TEXT.limits}</main>;
  },
}));

vi.mock("./pages/IpCheckPage.jsx", () => ({ default: () => <main>{TEXT.ipCheck}</main> }));
vi.mock("./pages/WrappedPage.jsx", () => ({ default: () => <main>{TEXT.wrapped}</main> }));
vi.mock("./pages/SettingsPage.jsx", () => ({ SettingsPage: () => <main>{TEXT.settings}</main> }));
vi.mock("./pages/SkillsPage.jsx", () => ({ SkillsPage: () => <main>{TEXT.skills}</main> }));
vi.mock("./pages/WidgetsPage.jsx", () => ({ WidgetsPage: () => <main>{TEXT.widgets}</main> }));

function renderApp(initialPath = "/dashboard") {
  window.history.pushState({}, "", initialPath);
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
    </MemoryRouter>,
  );
}

describe("App deferred dashboard preload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, "", "/");
  });

  it("does not start limits preload before the dashboard main content is visible", async () => {
    const user = userEvent.setup();
    renderApp("/dashboard");

    expect(await screen.findByText(TEXT.dashboard)).toBeInTheDocument();
    expect(preloadDashboardPageResource).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: TEXT.reveal }));

    await waitFor(() => {
      expect(markDashboardMainContentVisible).toHaveBeenCalledTimes(1);
      expect(preloadDashboardPageResource).toHaveBeenCalledWith("limits");
    });
  });

  it("does not start dashboard preload for a deep-linked /limits route", async () => {
    renderApp("/limits");

    expect(await screen.findByText(TEXT.limits)).toBeInTheDocument();

    await waitFor(() => {
      expect(markDashboardMainContentVisible).not.toHaveBeenCalled();
    });
  });
});
