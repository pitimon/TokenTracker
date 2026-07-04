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
