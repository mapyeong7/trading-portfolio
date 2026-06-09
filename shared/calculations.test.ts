import { describe, expect, it } from "vitest";
import { buildCumulativeRanking, buildMonthlyRanking, calculateReturnPercent, getEntryPreview } from "./calculations";
import type { Entry } from "./types";

const baseEntry: Entry = {
  id: 1,
  monthId: 1,
  month: "2026-06",
  monthTitle: "6월",
  monthEndDate: "2026-06-30",
  participantId: 1,
  participantName: "김성장",
  stockName: "삼성전자",
  stockCode: "005930",
  buyDate: "2026-06-01",
  buyClose: 100,
  endClose: null,
  sellDate: null,
  sellClose: null,
  ideaMemo: "",
  finalExitDate: null,
  finalExitClose: null,
  finalReturnPercent: null,
  finalizedAt: null,
  currentPrice: null,
  currentPriceAt: null,
  currentPriceSource: null,
  currentPriceSymbol: null,
  currentReturnPercent: null,
  currentPriceError: null
};

describe("contest calculations", () => {
  it("calculates monthly return from buy close and exit close", () => {
    expect(calculateReturnPercent(100, 115)).toBe(15);
    expect(calculateReturnPercent(100, 90)).toBe(-10);
  });

  it("uses sell close as the preview exit when an entry is sold", () => {
    const preview = getEntryPreview({
      ...baseEntry,
      sellDate: "2026-06-14",
      sellClose: 120,
      endClose: 105
    });

    expect(preview.exitSource).toBe("sell");
    expect(preview.previewExitDate).toBe("2026-06-14");
    expect(preview.previewReturnPercent).toBe(20);
  });

  it("uses month end close when there is no sell close", () => {
    const preview = getEntryPreview({
      ...baseEntry,
      endClose: 80
    });

    expect(preview.exitSource).toBe("month-end");
    expect(preview.previewExitDate).toBe("2026-06-30");
    expect(preview.previewReturnPercent).toBe(-20);
  });

  it("builds official monthly ranking from finalized entries only", () => {
    const finalized = getEntryPreview({
      ...baseEntry,
      finalReturnPercent: 12,
      finalizedAt: "2026-06-30T10:00:00.000Z"
    });
    const pending = getEntryPreview({ ...baseEntry, id: 2, participantId: 2, participantName: "박대기" });

    const ranking = buildMonthlyRanking([pending, finalized]);
    expect(ranking).toHaveLength(1);
    expect(ranking[0].officialReturnPercent).toBe(12);
  });

  it("compounds finalized monthly returns for cumulative ranking", () => {
    const entries = [
      getEntryPreview({
        ...baseEntry,
        finalReturnPercent: 10,
        finalizedAt: "2026-06-30T10:00:00.000Z"
      }),
      getEntryPreview({
        ...baseEntry,
        id: 2,
        monthId: 2,
        month: "2026-07",
        finalReturnPercent: -5,
        finalizedAt: "2026-07-31T10:00:00.000Z"
      })
    ];

    const ranking = buildCumulativeRanking(entries);
    expect(ranking[0].assetIndex).toBeCloseTo(104.5);
    expect(ranking[0].cumulativeReturnPercent).toBeCloseTo(4.5);
  });
});
