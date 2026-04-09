import { render, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import TrendsCenterPane from "../src/components/center/TrendsCenterPane";

const mockUseLiveData = vi.fn();
const mockUseTrendsData = vi.fn();

vi.mock("@/lib/context/LiveDataContext", () => ({
  useLiveData: () => mockUseLiveData(),
}));

vi.mock("@/lib/useTrendsData", () => ({
  useTrendsData: (...args: unknown[]) => mockUseTrendsData(...args),
}));

const baseLiveData = {
  constituencies: [
    { id: "KL-001", name: "Adoor", state: "Kerala", volatility_score: 62, district: "Pathanamthitta" },
    { id: "TN-001", name: "Chepauk", state: "Tamil Nadu", volatility_score: 28, district: "Chennai" },
  ],
  candidates: [
    { id: "cand-1", constituency_id: "KL-001", name: "Candidate Alpha", party: "ABC", party_abbreviation: "ABC", incumbent: true },
    { id: "cand-2", constituency_id: "TN-001", name: "Candidate Beta", party: "XYZ", party_abbreviation: "XYZ", incumbent: false },
  ],
};

const signals24h = [
  {
    id: "1",
    constituency_id: "KL-001",
    state: "Kerala",
    source: "The Hindu",
    title: "EVM complaint sparks long queues in Adoor",
    body: "Candidate Alpha responds to EVM complaints.",
    full_summary: ["EVM repaired", "Turnout rising"],
    severity: 4,
    verified: true,
    created_at: "2026-04-08T11:20:00.000Z",
  },
  {
    id: "2",
    constituency_id: "KL-001",
    state: "Kerala",
    source: "ANI",
    title: "Campaign rally sees heavy turnout in Adoor",
    body: "Candidate Alpha addressed supporters.",
    full_summary: ["Large campaign turnout"],
    severity: 3,
    verified: false,
    created_at: "2026-04-08T05:15:00.000Z",
  },
  {
    id: "3",
    constituency_id: "TN-001",
    state: "Tamil Nadu",
    source: "NDTV",
    title: "Tamil Nadu alliance talks intensify",
    body: "Leaders discuss a new alliance formula.",
    full_summary: ["Alliance talks continue"],
    severity: 2,
    verified: true,
    created_at: "2026-04-08T10:55:00.000Z",
  },
];

const signals7d = [
  ...signals24h,
  {
    id: "4",
    constituency_id: "TN-001",
    state: "Tamil Nadu",
    source: "Indian Express",
    title: "Campaign push widens in Chepauk",
    body: "Field reports suggest growing campaign activity.",
    full_summary: ["Campaign activity increasing"],
    severity: 2,
    verified: true,
    created_at: "2026-04-05T10:55:00.000Z",
  },
];

beforeEach(() => {
  mockUseLiveData.mockReturnValue(baseLiveData);
  mockUseTrendsData.mockImplementation((window: string) => ({
    signals: window === "7d" ? signals7d : signals24h,
    historicalResults: [
      {
        constituency_id: "KL-001",
        election_year: 2021,
        winner_candidate_name: "A Candidate",
        winner_party: "ABC",
        runner_up_candidate_name: "B Candidate",
        runner_up_party: "XYZ",
        margin_votes: 1200,
        margin_pct: 3.4,
        turnout_pct: 76.2,
      },
    ],
    isLoading: false,
    error: null,
  }));
});

describe("TrendsCenterPane", () => {
  test("renders sections and responds to state/window/filter changes", async () => {
    const onChangeGlobalStateFilter = vi.fn();
    const view = render(<TrendsCenterPane globalStateFilter="ALL" onChangeGlobalStateFilter={onChangeGlobalStateFilter} />);

    expect(view.getByText("TRENDS BOARD")).toBeInTheDocument();
    expect(view.getByText("Trending Constituencies")).toBeInTheDocument();
    expect(view.getByText("Trending Candidates")).toBeInTheDocument();
    expect(view.getByText("3 signals")).toBeInTheDocument();

    await act(async () => {
      view.getByRole("button", { name: "7D" }).click();
    });
    await waitFor(() => expect(view.getByText("4 signals")).toBeInTheDocument());

    await act(async () => {
      view.getByRole("button", { name: "VERIFIED ONLY" }).click();
    });
    await waitFor(() => expect(view.getByText("3 signals")).toBeInTheDocument());

    await act(async () => {
      view.getByRole("button", { name: "KL" }).click();
    });
    expect(onChangeGlobalStateFilter).toHaveBeenCalledWith("Kerala");
  });

  test("shows an empty state when there are no signals in the selected window", () => {
    mockUseTrendsData.mockReturnValue({
      signals: [],
      historicalResults: [],
      isLoading: false,
      error: null,
    });

    const view = render(<TrendsCenterPane globalStateFilter="ALL" onChangeGlobalStateFilter={vi.fn()} />);
    expect(view.getByText("NO TRENDS IN THIS WINDOW")).toBeInTheDocument();
  });

  test("infers leaderboard rows from text mentions when constituency ids are missing", () => {
    mockUseTrendsData.mockReturnValue({
      signals: [
        {
          id: "state-only-1",
          state: "Kerala",
          source: "Manorama",
          title: "Candidate Alpha gains ground in Adoor as ABC pushes campaign",
          body: "Adoor campaign activity increases for ABC leaders.",
          full_summary: ["Adoor campaign intensifies"],
          severity: 3,
          verified: true,
          created_at: "2026-04-08T11:50:00.000Z",
        },
      ],
      historicalResults: [],
      isLoading: false,
      error: null,
    });

    const view = render(<TrendsCenterPane globalStateFilter="ALL" onChangeGlobalStateFilter={vi.fn()} />);
    expect(view.queryByText("No constituency-linked signals in this window.")).not.toBeInTheDocument();
    expect(view.queryByText("No candidate-linked trends in this window.")).not.toBeInTheDocument();
  });
});
