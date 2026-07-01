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

  it("uses current price as the preview when no exit close exists", () => {
    const preview = getEntryPreview({
      ...baseEntry,
      currentPrice: 112,
      currentPriceAt: "2026-06-09T14:30:00.000Z",
      currentReturnPercent: 12
    });

    expect(preview.exitSource).toBe("current");
    expect(preview.previewExitDate).toBe("2026-06-09");
    expect(preview.previewExitClose).toBe(112);
    expect(preview.previewReturnPercent).toBe(12);
  });

  it("builds monthly ranking from finalized returns and current prices", () => {
    const finalized = getEntryPreview({
      ...baseEntry,
      id: 1,
      participantName: "김확정",
      finalExitDate: "2026-06-16",
      finalExitClose: 112,
      finalReturnPercent: 12,
      finalizedAt: "2026-06-30T10:00:00.000Z"
    });
    const pending = getEntryPreview({
      ...baseEntry,
      id: 2,
      participantId: 2,
      participantName: "박현재",
      currentPrice: 125,
      currentPriceAt: "2026-06-16T08:00:00.000Z",
      currentReturnPercent: 25
    });
    const noPrice = getEntryPreview({
      ...baseEntry,
      id: 3,
      participantId: 3,
      participantName: "이대기"
    });

    const ranking = buildMonthlyRanking([pending, finalized, noPrice]);
    expect(ranking).toHaveLength(2);
    expect(ranking[0].participantName).toBe("박현재");
    expect(ranking[0].officialReturnPercent).toBe(25);
    expect(ranking[0].rankingSource).toBe("current");
    expect(ranking[1].participantName).toBe("김확정");
    expect(ranking[1].officialReturnPercent).toBe(12);
    expect(ranking[1].rankingSource).toBe("final");
  });

  it("uses sell or month-end exits for monthly ranking before current prices", () => {
    const monthEnd = getEntryPreview({
      ...baseEntry,
      id: 4,
      participantId: 4,
      participantName: "최월말",
      endClose: 130,
      currentPrice: 80,
      currentReturnPercent: -20
    });
    const sold = getEntryPreview({
      ...baseEntry,
      id: 5,
      participantId: 5,
      participantName: "정매도",
      sellDate: "2026-06-20",
      sellClose: 118,
      currentPrice: 150,
      currentReturnPercent: 50
    });

    const ranking = buildMonthlyRanking([sold, monthEnd]);

    expect(ranking).toHaveLength(2);
    expect(ranking[0].participantName).toBe("최월말");
    expect(ranking[0].officialReturnPercent).toBe(30);
    expect(ranking[0].rankingSource).toBe("month-end");
    expect(ranking[1].participantName).toBe("정매도");
    expect(ranking[1].officialReturnPercent).toBe(18);
    expect(ranking[1].rankingSource).toBe("sell");
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
