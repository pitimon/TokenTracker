import { render, screen } from "@testing-library/react";
import { StatsPanel } from "../StatsPanel.jsx";

function renderPanel(props = {}) {
  return render(<StatsPanel rankLabel="2026-03-01" streakDays={12} {...props} />);
}

it("renders the identity footer (start date + active-day streak)", () => {
  renderPanel();
  expect(screen.getByText("2026-03-01")).toBeInTheDocument();
  // Streak value renders the day count somewhere in its formatted label.
  expect(screen.getByText(/12/)).toBeInTheDocument();
});

it("renders subscription badges when provided", () => {
  renderPanel({
    subscriptions: [
      { tool: "claude", planType: "max" },
      { tool: "chatgpt", planType: "pro" },
    ],
  });
  expect(screen.getByText(/Claude/)).toBeInTheDocument();
  expect(screen.getByText(/Chatgpt/)).toBeInTheDocument();
});

it("no longer renders the rolling-stats strip or top-models (moved to Today's Pulse)", () => {
  renderPanel({
    period: "month",
    periodConversations: 42,
    rolling: {
      last_7d: { totals: { billable_total_tokens: 12345 } },
      current_month: { totals: { billable_total_tokens: 54321 } },
    },
    topModels: [{ id: "opus", name: "opus-4-8", percent: "54.5" }],
  });
  // Decluttered: none of the old rolling tiles / convs / top-models survive.
  expect(screen.queryByText("30d")).not.toBeInTheDocument();
  expect(screen.queryByText("month")).not.toBeInTheDocument();
  expect(screen.queryByText("42")).not.toBeInTheDocument();
  expect(screen.queryByText("opus-4-8")).not.toBeInTheDocument();
});
