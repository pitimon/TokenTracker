import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProviderBreakdownCard } from "../ProviderBreakdownCard.jsx";

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

describe("ProviderBreakdownCard", () => {
  it("passes the overview usage range to Codex context breakdown", async () => {
    breakdownProps.length = 0;
    const user = userEvent.setup();

    render(
      <ProviderBreakdownCard
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

  it("renders collapsed provider model chips and missing-pricing", () => {
    render(
      <ProviderBreakdownCard
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

    expect(screen.getByText("sonnet-5")).toBeInTheDocument();
    expect(screen.getByText("49.5%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "sonnet-5 49.5%" })).toHaveAttribute(
      "aria-valuenow",
      "49.5",
    );
    expect(screen.getByText("fable-5")).toBeInTheDocument();
    expect(screen.getByText("46.6%")).toBeInTheDocument();
    expect(screen.getByText("+1 more")).toBeInTheDocument();
    expect(screen.getByText("1 pricing missing")).toBeInTheDocument();
    expect(screen.getByText("Top cost: fable-5")).toBeInTheDocument();
  });

  it("shows a fuzzy-pricing caveat when a provider has fuzzy-matched models", () => {
    render(
      <ProviderBreakdownCard
        fleetData={[
          {
            source: "claude",
            label: "CLAUDE",
            totalPercent: "100.0",
            usage: 26_000_000,
            usd: 3164.69,
            topCostModel: { name: "claude-auto-pilot-fable-v1-canary" },
            missingPricingModels: [],
            fuzzyPricingModels: [{ name: "claude-auto-pilot-fable-v1-canary" }],
            models: [
              {
                id: "claude-auto-pilot-fable-v1-canary",
                name: "claude-auto-pilot-fable-v1-canary",
                share: 100,
                usage: 26_000_000,
                cost: 3164.69,
                pricingTier: "curated:fuzzy",
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText("1 pricing estimated")).toBeInTheDocument();
  });

  it("does not show the fuzzy-pricing caveat when every model resolved exactly", () => {
    render(<ProviderBreakdownCard fleetData={claudeFleet} />);

    expect(screen.queryByText(/pricing estimated/)).not.toBeInTheDocument();
  });

  const claudeFleet = [
    {
      source: "claude",
      label: "CLAUDE",
      totalPercent: "62.0",
      usage: 31_000_000,
      usd: 28.38,
      models: [{ id: "claude-opus-4-8", name: "claude-opus-4-8", share: 100, usage: 31_000_000, cost: 28 }],
    },
  ];

  it("renders limit chips for a provider that has live quota data", () => {
    render(
      <ProviderBreakdownCard
        fleetData={claudeFleet}
        usageLimits={{
          claude: {
            configured: true,
            five_hour: { utilization: 82, resets_at: "2999-01-01T00:00:00Z" },
            seven_day: { utilization: 95, resets_at: "2999-01-01T00:00:00Z" },
          },
        }}
      />,
    );

    expect(screen.getByText("5h")).toBeInTheDocument();
    expect(screen.getByText("7d")).toBeInTheDocument();
    expect(screen.getByText("82%")).toBeInTheDocument();
    expect(screen.getByText("95%")).toBeInTheDocument();
  });

  it("colors chips by the used-equivalent in remaining mode", () => {
    const { container } = render(
      <ProviderBreakdownCard
        fleetData={claudeFleet}
        limitDisplayMode="remaining"
        usageLimits={{ claude: { configured: true, five_hour: { utilization: 82 } } }}
      />,
    );
    // used 82% => remaining 18% is shown, but severity still reflects usage → orange, not neutral
    expect(screen.getByText("18%")).toBeInTheDocument();
    expect(container.querySelector(".bg-orange-500")).toBeInTheDocument();
  });

  it("hides the limit block when the provider has no quota data", () => {
    render(
      <ProviderBreakdownCard
        fleetData={claudeFleet}
        usageLimits={{ claude: { configured: false } }}
      />,
    );
    expect(screen.queryByText("5h")).not.toBeInTheDocument();
    expect(screen.queryByText("7d")).not.toBeInTheDocument();
  });

  it("renders nothing extra when usageLimits is absent (default)", () => {
    render(<ProviderBreakdownCard fleetData={claudeFleet} />);
    expect(screen.queryByText("5h")).not.toBeInTheDocument();
  });

  it("shows an error line when the provider is configured but errored", () => {
    render(
      <ProviderBreakdownCard
        fleetData={claudeFleet}
        usageLimits={{ claude: { configured: true, error: "token expired" } }}
      />,
    );
    expect(screen.getByText(/token expired/)).toBeInTheDocument();
    expect(screen.queryByText("5h")).not.toBeInTheDocument();
  });

  it("leaves gpt-* model names unchanged in the collapsed provider chip", () => {
    render(
      <ProviderBreakdownCard
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
