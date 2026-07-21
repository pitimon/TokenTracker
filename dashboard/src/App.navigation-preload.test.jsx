import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.jsx";
import { preloadDashboardPageResource } from "./lib/dashboard-preload.js";

const TEXT = {
  dashboard: "Dashboard page",
  ipCheck: "IP check",
  limits: "Limits page",
  limitsNav: "Limits nav",
  reveal: "reveal main content",
  settings: "Settings page",
  skills: "Skills page",
  widgets: "Widgets page",
  wrapped: "Wrapped page",
};

const pending = vi.hoisted(() => new Promise(() => {}));

vi.mock("./lib/dashboard-preload.js", () => ({
  markDashboardMainContentVisible: vi.fn(),
  preloadDashboardPageResource: vi.fn(() => pending),
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

vi.mock("@vercel/analytics/react", () => ({
  Analytics: () => null,
}));

vi.mock("@vercel/speed-insights/react", () => ({
  SpeedInsights: () => null,
}));

vi.mock("./ui/components/Sidebar.jsx", async () => {
  const { Link } = await vi.importActual("react-router-dom");
  return {
    AppLayout: ({ children }) => (
      <div>
        <nav>
          <Link to="/limits">{TEXT.limitsNav}</Link>
        </nav>
        {children}
      </div>
    ),
  };
});

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
  LimitsPage: () => <main>{TEXT.limits}</main>,
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

async function startPendingPreload(user) {
  renderApp("/dashboard");
  expect(await screen.findByText(TEXT.dashboard)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: TEXT.reveal }));
  await waitFor(() => {
    expect(preloadDashboardPageResource).toHaveBeenCalledWith("limits");
  });
}

describe("App navigation while preload is pending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, "", "/");
  });

  it("switches to /limits without waiting for pending preload promises", async () => {
    const user = userEvent.setup();
    await startPendingPreload(user);

    await act(async () => {
      await user.click(screen.getByRole("link", { name: TEXT.limitsNav }));
    });

    expect(await screen.findByText(TEXT.limits)).toBeInTheDocument();
  });
});
