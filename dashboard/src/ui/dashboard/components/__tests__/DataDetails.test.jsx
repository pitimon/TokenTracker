import { fireEvent, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "../../../../test/test-utils";
import { DataDetails } from "../DataDetails.jsx";

function renderDetails(props = {}) {
  const copy = vi.fn((key) => {
    const labels = {
      "dashboard.daily.title": "Daily Breakdown",
      "dashboard.projects.title": "Project Usage",
      "dashboard.projects.limit_aria": "Select repository limit",
      "dashboard.projects.limit_top_3": "TOP 3",
      "dashboard.projects.limit_top_6": "TOP 6",
      "dashboard.projects.limit_top_10": "TOP 10",
    };
    return labels[key] || key;
  });

  return render(
    <DataDetails
      copy={copy}
      projectEntries={[
        {
          project_key: "pitimon/demo",
          project_ref: "https://github.com/pitimon/demo",
          total_tokens: 1234,
        },
      ]}
      dailyBreakdownRows={[]}
      installSyncCmd="tracker sync"
      DETAILS_PAGED_PERIODS={new Set()}
      renderDetailDate={() => ""}
      renderDetailCell={() => ""}
      setDetailsPage={() => {}}
      {...props}
    />,
  );
}

describe("DataDetails", () => {
  it("never loads a remote avatar for a project row (issue 100)", () => {
    const { container } = renderDetails();

    fireEvent.click(screen.getByRole("tab", { name: "Project Usage" }));

    // The owner name comes from a repo the user has checked out. An <img src>
    // pointing at the owner's github.com avatar discloses it to a third party from the
    // browser just as a fetch would — that is how issue 100 shipped unnoticed.
    expect(container.querySelector('img[src*="github.com"]')).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByText("P")).not.toBeInTheDocument();
  });

  it("uses zebra striping on daily breakdown rows", () => {
    const { container } = renderDetails({
      dailyBreakdownRows: [
        { day: "2026-06-12", total_tokens: 100 },
        { day: "2026-06-11", total_tokens: 200 },
      ],
      dailyBreakdownColumns: [
        { key: "day", label: "Date" },
        { key: "total_tokens", label: "Total" },
      ],
      dailyBreakdownAriaSortFor: () => "none",
      dailyBreakdownSortIconFor: () => "",
      renderDailyBreakdownDate: (row) => row.day,
      renderDetailCell: (row, key) => row[key] ?? "",
      toggleSort: () => {},
    });

    const dailyRows = container.querySelectorAll("tbody tr");
    expect(dailyRows).toHaveLength(2);
    expect(dailyRows[0]).toHaveClass("odd:bg-transparent");
    expect(dailyRows[0]).toHaveClass("even:bg-oai-gray-50/55");
  });

  it("renders configured daily cost and top-model columns without compacting detail values", () => {
    renderDetails({
      dailyBreakdownRows: [
        {
          day: "2026-07-03",
          total_tokens: 31301685,
          input_tokens: 2708422,
          total_cost_usd: "$28.38",
          cost_per_million_tokens: "$0.91",
          cost_per_million_status: "high",
          top_model: "claude-fable-5",
        },
      ],
      dailyBreakdownColumns: [
        { key: "day", label: "Date" },
        { key: "total_tokens", label: "Total" },
        { key: "input_tokens", label: "Input" },
        { key: "total_cost_usd", label: "Cost" },
        { key: "cost_per_million_tokens", label: "$/MTok" },
        { key: "top_model", label: "Top model" },
      ],
      dailyBreakdownAriaSortFor: (key) => (key === "day" ? "descending" : null),
      dailyBreakdownSortIconFor: () => "",
      renderDailyBreakdownDate: (row) => row.day,
      renderDetailCell: (row, key) => row[key] ?? "",
      toggleSort: () => {},
    });

    expect(screen.getByRole("columnheader", { name: "Cost" })).not.toHaveAttribute("aria-sort");
    expect(screen.getByRole("columnheader", { name: "Input" })).not.toHaveClass("hidden");
    expect(screen.getByText("31301685")).toBeInTheDocument();
    expect(screen.queryByText("31.3M")).not.toBeInTheDocument();
    expect(screen.getByText("2708422")).toBeInTheDocument();
    expect(screen.getByText("$28.38")).toBeInTheDocument();
    expect(screen.getByText("$0.91").closest("td")).toHaveClass("text-amber-700");
    expect(screen.getByText("claude-fable-5")).toBeInTheDocument();
    expect(screen.queryByText("fable-5")).not.toBeInTheDocument();
  });
});

describe("DataDetails — Projects empty state", () => {
  it("says so when nothing has been attributed to a project", () => {
    // It used to render an empty container, which reads as "you spent nothing"
    // rather than "no usage carries project attribution yet". The Daily tab has
    // always explained itself; this one did not.
    renderDetails({ projectEntries: [] });
    fireEvent.click(screen.getByRole("tab", { name: "Project Usage" }));
    expect(screen.getByText("dashboard.projects.empty")).toBeInTheDocument();
  });
});
