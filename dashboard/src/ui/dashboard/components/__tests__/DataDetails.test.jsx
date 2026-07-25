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

describe("DataDetails — sources with no per-repo attribution", () => {
  it("names them, so their absence does not read as zero spend", () => {
    // projectBucketsQueued exists in 7 parsers. Cursor, Copilot, Zed, Goose and
    // Kiro have no per-repo story at all, and the panel used to just omit them —
    // which looks identical to "that tool cost nothing here".
    renderDetails({ projectUnattributedSources: ["cursor", "zed"] });
    fireEvent.click(screen.getByText("Project Usage"));
    expect(screen.getByText(/cursor, zed/)).toBeTruthy();
  });

  it("says nothing when everything is attributed", () => {
    renderDetails({ projectUnattributedSources: [] });
    fireEvent.click(screen.getByText("Project Usage"));
    expect(screen.queryByText("dashboard.projects.unattributed")).toBeNull();
  });
});

describe("DataDetails — per-repo cost", () => {
  function projectsTab(entry) {
    renderDetails({ projectEntries: [entry] });
    fireEvent.click(screen.getByText("Project Usage"));
  }

  it("shows the cost when the rows carry a model", () => {
    projectsTab({
      project_key: "acme/api",
      total_tokens: "1000000",
      total_cost_usd: "3.000000",
      unattributed_tokens: "0",
    });
    expect(screen.getByText("$3.00")).toBeTruthy();
  });

  it("marks a repo whose rows all predate per-model attribution", () => {
    // Pricing those at zero and showing "$0.00" would read as "this cost
    // nothing" rather than "we recorded this before we recorded models".
    projectsTab({
      project_key: "acme/legacy",
      total_tokens: "5000",
      total_cost_usd: "0.000000",
      unattributed_tokens: "5000",
    });
    expect(screen.queryByText("$0.00")).toBeNull();
    expect(screen.getByText("dashboard.projects.unpriced")).toBeTruthy();
  });

  it("flags a partly-priced repo rather than implying the figure is complete", () => {
    projectsTab({
      project_key: "acme/mixed",
      total_tokens: "1000700",
      total_cost_usd: "3.000000",
      unattributed_tokens: "700",
    });
    expect(screen.getByText("$3.00+")).toBeTruthy();
  });

  it("shows no cost line at all when the server sent none", () => {
    // Older server, newer dashboard: absent is not zero.
    projectsTab({ project_key: "acme/api", total_tokens: "1000" });
    expect(screen.queryByText(/^\$/)).toBeNull();
  });
});
