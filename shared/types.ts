export type MonthStatus = "draft" | "open" | "finalized";

export type ContestMonth = {
  id: number;
  month: string;
  title: string;
  startDate: string;
  endDate: string;
  status: MonthStatus;
};

export type Participant = {
  id: number;
  name: string;
  memo: string;
  active: boolean;
};

export type AdminAccount = {
  id: number;
  username: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
};

export type Entry = {
  id: number;
  monthId: number;
  month: string;
  monthTitle: string;
  monthEndDate: string;
  participantId: number;
  participantName: string;
  stockName: string;
  stockCode: string;
  buyDate: string;
  buyClose: number;
  endClose: number | null;
  sellDate: string | null;
  sellClose: number | null;
  ideaMemo: string;
  finalExitDate: string | null;
  finalExitClose: number | null;
  finalReturnPercent: number | null;
  finalizedAt: string | null;
  currentPrice: number | null;
  currentPriceAt: string | null;
  currentPriceSource: string | null;
  currentPriceSymbol: string | null;
  currentReturnPercent: number | null;
  currentPriceError: string | null;
};

export type EntryPreview = Entry & {
  previewExitDate: string | null;
  previewExitClose: number | null;
  previewReturnPercent: number | null;
  exitSource: "sell" | "month-end" | "current" | "pending";
};

export type MonthlyRankingItem = EntryPreview & {
  rank: number;
  officialReturnPercent: number;
  rankingExitDate: string | null;
  rankingExitClose: number | null;
  rankingReturnPercent: number;
  rankingSource: "final" | "sell" | "month-end" | "current";
};

export type CumulativeRankingItem = {
  rank: number;
  participantId: number;
  participantName: string;
  completedMonths: number;
  assetIndex: number;
  cumulativeReturnPercent: number;
};

export type QuoteRefreshResult = {
  entryId: number;
  participantName: string;
  stockName: string;
  stockCode: string;
  ok: boolean;
  price: number | null;
  returnPercent: number | null;
  priceAt: string | null;
  symbol: string | null;
  source: string | null;
  error: string | null;
};

export type QuoteRefreshResponse = {
  updated: number;
  failed: number;
  results: QuoteRefreshResult[];
  entries: EntryPreview[];
};

export type QuoteCheckResponse = {
  ok: boolean;
  stockCode: string;
  price: number | null;
  priceAt: string | null;
  symbol: string | null;
  source: string | null;
  error: string | null;
};

export type HistoricalCloseResponse = {
  ok: boolean;
  stockCode: string;
  date: string;
  close: number | null;
  tradeDate: string | null;
  symbol: string | null;
  source: string | null;
  error: string | null;
};

export type StockSearchResult = {
  code: string;
  name: string;
  market: string;
};

export type StockSearchResponse = {
  query: string;
  results: StockSearchResult[];
};

export type MonthReconcileResult = {
  entryId: number;
  participantName: string;
  stockName: string;
  stockCode: string;
  ok: boolean;
  action: "updated" | "skipped" | "failed";
  exitDate: string | null;
  exitClose: number | null;
  returnPercent: number | null;
  finalized: boolean;
  source: "sell" | "month-end" | "manual-month-end" | null;
  skipReason: string | null;
  error: string | null;
};

export type MonthReconcileResponse = {
  month: string;
  updated: number;
  skipped: number;
  failed: number;
  results: MonthReconcileResult[];
  entries: EntryPreview[];
};

export type LeaderboardResponse = {
  selectedMonth: ContestMonth | null;
  months: ContestMonth[];
  participantCount: number;
  missingParticipantNames: string[];
  entries: EntryPreview[];
  monthlyRanking: MonthlyRankingItem[];
  cumulativeRanking: CumulativeRankingItem[];
};

export type AdminBootstrapResponse = {
  account: {
    id: number;
    username: string;
    displayName: string;
  };
  accounts: AdminAccount[];
  months: ContestMonth[];
  participants: Participant[];
  entries: EntryPreview[];
  selectedMonth: ContestMonth | null;
};

export type ApiError = {
  error: string;
};
