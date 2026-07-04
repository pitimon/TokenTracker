import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HeroSummary } from "../HeroSummary.jsx";

describe("HeroSummary", () => {
  it("renders configurable auto-refresh intervals and reports the selected value", async () => {
    const user = userEvent.setup();
    const onAutoRefreshIntervalChange = vi.fn();

    render(
      <HeroSummary
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

  it("renders usage-insight chips for cost, top models, and missing pricing", () => {
    render(
      <HeroSummary
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
      />,
    );

    expect(screen.getByText("$0.91/MTok")).toBeInTheDocument();
    expect(screen.getByText("Top cost fable-5")).toBeInTheDocument();
    expect(screen.getByText("Top usage sonnet-5")).toBeInTheDocument();
    expect(screen.getByText("1 pricing missing")).toBeInTheDocument();
  });
});
