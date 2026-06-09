import type {
  AdminBootstrapResponse,
  ApiError,
  EntryPreview,
  HistoricalCloseResponse,
  LeaderboardResponse,
  QuoteCheckResponse,
  QuoteRefreshResponse,
  StockSearchResponse
} from "../../shared/types";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers
    }
  });
  const data = (await response.json()) as unknown;

  if (!response.ok) {
    const message =
      typeof data === "object" && data !== null && "error" in data
        ? String((data as ApiError).error)
        : "요청 처리 중 오류가 발생했습니다.";
    throw new Error(message);
  }

  return data as T;
}

export function getLeaderboard(month?: string): Promise<LeaderboardResponse> {
  const search = month ? `?month=${encodeURIComponent(month)}` : "";
  return request<LeaderboardResponse>(`/api/leaderboard${search}`);
}

export function getEntries(month?: string): Promise<{ entries: EntryPreview[] }> {
  const search = month ? `?month=${encodeURIComponent(month)}` : "";
  return request<{ entries: EntryPreview[] }>(`/api/entries${search}`);
}

export function login(username: string, password: string): Promise<{ account: AdminBootstrapResponse["account"] }> {
  return request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
}

export function logout(): Promise<{ ok: true }> {
  return request("/api/auth/logout", {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function getAdminBootstrap(month?: string): Promise<AdminBootstrapResponse> {
  const search = month ? `?month=${encodeURIComponent(month)}` : "";
  return request<AdminBootstrapResponse>(`/api/admin/bootstrap${search}`);
}

export function saveAccount(payload: {
  id?: number;
  username: string;
  displayName: string;
  password: string;
}): Promise<Pick<AdminBootstrapResponse, "accounts">> {
  return request("/api/admin/accounts", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function saveParticipant(payload: {
  id?: number;
  name: string;
  memo: string;
  active: boolean;
}): Promise<Pick<AdminBootstrapResponse, "participants">> {
  return request("/api/admin/participants", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function deleteParticipant(id: number): Promise<Pick<AdminBootstrapResponse, "participants">> {
  return request(`/api/admin/participants/${id}`, {
    method: "DELETE"
  });
}

export function saveMonth(payload: {
  id?: number;
  month: string;
  title: string;
  startDate: string;
  endDate: string;
  status: string;
}): Promise<Pick<AdminBootstrapResponse, "months">> {
  return request("/api/admin/months", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export type EntryPayload = {
  id?: number;
  monthId: number;
  participantId: number;
  stockName: string;
  stockCode: string;
  buyDate: string;
  buyClose: number | string;
  endClose?: number | string | null;
  sellDate?: string | null;
  sellClose?: number | string | null;
  ideaMemo: string;
};

export function createEntry(payload: EntryPayload): Promise<Pick<AdminBootstrapResponse, "entries">> {
  return request("/api/admin/entries", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateEntry(payload: EntryPayload): Promise<Pick<AdminBootstrapResponse, "entries">> {
  if (!payload.id) {
    throw new Error("수정할 참가 종목 ID가 없습니다.");
  }

  return request(`/api/admin/entries/${payload.id}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function finalizeEntry(id: number): Promise<Pick<AdminBootstrapResponse, "entries">> {
  return request(`/api/admin/entries/${id}/finalize`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function refreshQuotes(month?: string): Promise<QuoteRefreshResponse> {
  return request("/api/admin/quotes/refresh", {
    method: "POST",
    body: JSON.stringify({ month })
  });
}

export function checkQuote(stockCode: string): Promise<QuoteCheckResponse> {
  return request("/api/admin/quotes/check", {
    method: "POST",
    body: JSON.stringify({ stockCode })
  });
}

export function lookupHistoricalClose(stockCode: string, date: string): Promise<HistoricalCloseResponse> {
  return request("/api/admin/quotes/historical-close", {
    method: "POST",
    body: JSON.stringify({ stockCode, date })
  });
}

export function searchKoreanStocks(query: string): Promise<StockSearchResponse> {
  return request(`/api/admin/stocks/search?q=${encodeURIComponent(query)}`);
}
