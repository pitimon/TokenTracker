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
  it("uses an owner avatar for project usage rows instead of a letter initial", () => {
    const { container } = renderDetails();

    fireEvent.click(screen.getByRole("tab", { name: "Project Usage" }));

    const avatar = container.querySelector('img[src="https://github.com/pitimon.png?size=80"]');
    expect(avatar).toBeInTheDocument();
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
});
