import type {
  CumulativeRankingItem,
  Entry,
  EntryPreview,
  MonthlyRankingItem
} from "./types";

export function calculateReturnPercent(buyClose: number, exitClose: number): number {
  return ((exitClose - buyClose) / buyClose) * 100;
}

export function getEntryPreview(entry: Entry): EntryPreview {
  if (entry.sellDate && entry.sellClose !== null) {
    return {
      ...entry,
      previewExitDate: entry.sellDate,
      previewExitClose: entry.sellClose,
      previewReturnPercent: calculateReturnPercent(entry.buyClose, entry.sellClose),
      exitSource: "sell"
    };
  }

  if (entry.endClose !== null) {
    return {
      ...entry,
      previewExitDate: entry.monthEndDate,
      previewExitClose: entry.endClose,
      previewReturnPercent: calculateReturnPercent(entry.buyClose, entry.endClose),
      exitSource: "month-end"
    };
  }

  if (entry.currentPrice !== null) {
    return {
      ...entry,
      previewExitDate: entry.currentPriceAt ? entry.currentPriceAt.slice(0, 10) : null,
      previewExitClose: entry.currentPrice,
      previewReturnPercent:
        entry.currentReturnPercent ?? calculateReturnPercent(entry.buyClose, entry.currentPrice),
      exitSource: "current"
    };
  }

  return {
    ...entry,
    previewExitDate: null,
    previewExitClose: null,
    previewReturnPercent: null,
    exitSource: "pending"
  };
}

export function buildMonthlyRanking(entries: EntryPreview[]): MonthlyRankingItem[] {
  return entries
    .filter((entry) => entry.finalReturnPercent !== null)
    .sort((a, b) => b.finalReturnPercent! - a.finalReturnPercent!)
    .map((entry, index) => ({
      ...entry,
      rank: index + 1,
      officialReturnPercent: entry.finalReturnPercent!
    }));
}

export function buildCumulativeRanking(entries: EntryPreview[]): CumulativeRankingItem[] {
  const grouped = new Map<number, EntryPreview[]>();

  entries
    .filter((entry) => entry.finalReturnPercent !== null)
    .forEach((entry) => {
      const current = grouped.get(entry.participantId) ?? [];
      current.push(entry);
      grouped.set(entry.participantId, current);
    });

  return Array.from(grouped.entries())
    .map(([participantId, participantEntries]) => {
      const sortedEntries = participantEntries.sort((a, b) => a.month.localeCompare(b.month));
      const assetIndex = sortedEntries.reduce(
        (currentAssetIndex, entry) => currentAssetIndex * (1 + entry.finalReturnPercent! / 100),
        100
      );

      return {
        rank: 0,
        participantId,
        participantName: sortedEntries[0].participantName,
        completedMonths: sortedEntries.length,
        assetIndex,
        cumulativeReturnPercent: (assetIndex / 100 - 1) * 100
      };
    })
    .sort((a, b) => b.cumulativeReturnPercent - a.cumulativeReturnPercent)
    .map((item, index) => ({
      ...item,
      rank: index + 1
    }));
}
