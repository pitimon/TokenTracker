import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UsageOverview } from "../UsageOverview.jsx";

const breakdownProps = [];

vi.mock("../ContextBreakdownPanel.jsx", () => ({
  ContextBreakdownPanel: (props) => {
    breakdownProps.push(props);
    return <div data-testid="context-breakdown">{`${props.source}:${props.from}:${props.to}`}</div>;
  },
}));

vi.mock("../../../../hooks/useTheme.js", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

describe("UsageOverview", () => {
  it("renders configurable auto-refresh intervals and reports the selected value", async () => {
    const user = userEvent.setup();
    const onAutoRefreshIntervalChange = vi.fn();

    render(
      <UsageOverview
        period="day"
        periods={["day"]}
        summaryLabel="Total"
        summaryValue="123"
        summaryUpdatedAtLabel="Updated Jun 5, 2026, 03:55:00 GMT+7"
        autoRefreshOptions={[
          { value: 0, labelKey: "usage.auto_refresh.off" },
          { value: 30000, labelKey: "usage.auto_refresh.30s" },
          { value: 60000, labelKey: "usage.auto_refresh.60s" },
          { value: 120000, labelKey: "usage.auto_refresh.120s" },
        ]}
        autoRefreshIntervalMs={30000}
        onAutoRefreshIntervalChange={onAutoRefreshIntervalChange}
      />,
    );

    const select = screen.getByRole("combobox", { name: "Auto refresh interval" });
    expect(select).toHaveValue("30000");
    expect(screen.getByText("Updated Jun 5, 2026, 03:55:00 GMT+7")).toBeInTheDocument();

    await user.selectOptions(select, "120000");

    expect(onAutoRefreshIntervalChange).toHaveBeenCalledWith("120000");
  });

  it("passes the overview usage range to Codex context breakdown", async () => {
    breakdownProps.length = 0;
    const user = userEvent.setup();

    render(
      <UsageOverview
        period="month"
        periods={[]}
        summaryLabel="Total"
        summaryValue="123"
        fleetData={[
          {
            source: "codex",
            label: "CODEX",
            totalPercent: "100.0",
            usage: 123,
            usd: 0,
            models: [{ id: "gpt-5.5", name: "gpt-5.5", share: 100, usage: 123, cost: 0 }],
          },
        ]}
        from="2026-05-01"
        to="2026-05-31"
      />,
    );

    await act(async () => {
      await user.click(screen.getByRole("button", { name: /CODEX/i }));
    });

    expect(screen.getByTestId("context-breakdown")).toHaveTextContent(
      "codex:2026-05-01:2026-05-31",
    );
    expect(breakdownProps[0]).toMatchObject({
      source: "codex",
      from: "2026-05-01",
      to: "2026-05-31",
      referenceTotalTokens: 123,
    });
  });

  it("renders collapsed provider model chips and cost insights", () => {
    render(
      <UsageOverview
        period="day"
        periods={[]}
        summaryLabel="Total"
        summaryValue="31.3M"
        summaryCostValue="$28.38"
        usageInsights={{
          costPerMillionTokens: 0.91,
          topCostModel: { name: "claude-fable-5" },
          topUsageModel: { name: "claude-sonnet-5" },
          missingPricingModels: [{ name: "claude-sonnet-new" }],
        }}
        fleetData={[
          {
            source: "claude",
            label: "CLAUDE",
            totalPercent: "74.3",
            usage: 31_000_000,
            usd: 28.38,
            topCostModel: { name: "claude-fable-5" },
            missingPricingModels: [{ name: "claude-sonnet-new" }],
            models: [
              { id: "claude-sonnet-5", name: "claude-sonnet-5", share: 49.5, usage: 9_200_000, cost: 5.5 },
              { id: "claude-fable-5", name: "claude-fable-5", share: 46.6, usage: 8_600_000, cost: 16.24 },
              { id: "claude-opus-4-8", name: "claude-opus-4-8", share: 3.9, usage: 709_000, cost: 1.06 },
              { id: "claude-sonnet-new", name: "claude-sonnet-new", share: 0.1, usage: 1_000, cost: 0 },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText("$0.91/MTok")).toBeInTheDocument();
    expect(screen.getAllByText(/Top cost fable-5|Top cost: fable-5/).length).toBeGreaterThan(0);
    expect(screen.getByText("Top usage sonnet-5")).toBeInTheDocument();
    expect(screen.getByText("sonnet-5")).toBeInTheDocument();
    expect(screen.getByText("49.5%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "sonnet-5 49.5%" })).toHaveAttribute(
      "aria-valuenow",
      "49.5",
    );
    expect(screen.getByText("fable-5")).toBeInTheDocument();
    expect(screen.getByText("46.6%")).toBeInTheDocument();
    expect(screen.getByText("+1 more")).toBeInTheDocument();
    expect(screen.getAllByText("1 pricing missing").length).toBeGreaterThan(0);
  });

  it("leaves gpt-* model names unchanged in the collapsed provider chip", () => {
    render(
      <UsageOverview
        period="day"
        periods={[]}
        summaryLabel="Total"
        summaryValue="10M"
        summaryCostValue="$5.00"
        fleetData={[
          {
            source: "codex",
            label: "CODEX",
            totalPercent: "100.0",
            usage: 10_000_000,
            usd: 5,
            topCostModel: { name: "gpt-4o" },
            missingPricingModels: [],
            models: [
              {
                id: "gpt-4o",
                name: "gpt-4o",
                share: 100,
                usage: 10_000_000,
                cost: 5,
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText("gpt-4o")).toBeInTheDocument();
    expect(screen.queryByText("4o")).not.toBeInTheDocument();
  });
});
