import { calculateReturnPercent } from "../shared/calculations";
import type { EntryPreview, QuoteRefreshResult, StockSearchResult } from "../shared/types";
import type { Env } from "./auth";
import { listEntries } from "./db";

const QUOTE_SOURCE = "Yahoo Finance";
const NAVER_QUOTE_SOURCE = "Naver Finance";
const NASDAQ_QUOTE_SOURCE = "Nasdaq";
const REFRESH_CONCURRENCY = 4;

type YahooChartResult = {
  meta?: {
    currency?: string;
    exchangeName?: string;
    instrumentType?: string;
    previousClose?: number;
    regularMarketPrice?: number;
    regularMarketTime?: number;
    shortName?: string;
    symbol?: string;
  };
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      close?: Array<number | null>;
    }>;
  };
};

type YahooChartResponse = {
  chart?: {
    result?: YahooChartResult[];
    error?: {
      code?: string;
      description?: string;
    } | null;
  };
};

type NaverQuoteResponse = {
  datas?: Array<{
    itemCode?: string;
    stockName?: string;
    closePrice?: string;
    closePriceRaw?: string;
    localTradedAt?: string;
    stockExchangeType?: {
      code?: string;
      nameKor?: string;
    };
  }>;
};

type NasdaqQuoteResponse = {
  data?: {
    symbol?: string;
    primaryData?: {
      lastSalePrice?: string;
      lastTradeTimestamp?: string;
    };
    secondaryData?: {
      lastSalePrice?: string;
      lastTradeTimestamp?: string;
    };
  } | null;
  message?: string | null;
  status?: {
    rCode?: number;
    bCodeMessage?: unknown;
    developerMessage?: unknown;
  };
};

type NasdaqHistoricalResponse = {
  data?: {
    symbol?: string;
    tradesTable?: {
      rows?: Array<{
        date?: string;
        close?: string;
      }>;
    };
  } | null;
  message?: string | null;
  status?: {
    rCode?: number;
    bCodeMessage?: unknown;
    developerMessage?: unknown;
  };
};

type NaverStockSearchResponse = {
  items?: Array<{
    code?: string;
    name?: string;
    typeCode?: string;
    typeName?: string;
    nationCode?: string;
    category?: string;
  }>;
};

type QuoteSnapshot = {
  price: number;
  priceAt: string;
  source: string;
  symbol: string;
};

type HistoricalCloseSnapshot = {
  close: number;
  tradeDate: string;
  source: string;
  symbol: string;
};

function asPositiveNumber(value: unknown): number | null {
  const numberValue =
    typeof value === "string"
      ? Number(value.replaceAll(",", "").replaceAll("$", "").trim())
      : Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
}

export function buildYahooSymbolCandidates(stockCode: string): string[] {
  const normalized = stockCode.trim().toUpperCase();

  if (!normalized) {
    return [];
  }

  if (/^\d{6}$/.test(normalized)) {
    return [`${normalized}.KS`, `${normalized}.KQ`];
  }

  return [normalized];
}

export function buildNasdaqQuoteCandidates(stockCode: string): Array<{ symbol: string; assetClass: "stocks" | "etf" }> {
  const normalized = stockCode.trim().toUpperCase();

  if (!normalized || /^\d{6}$/.test(normalized)) {
    return [];
  }

  const symbol = normalized.endsWith(".US") ? normalized.slice(0, -3) : normalized;

  return [
    { symbol, assetClass: "stocks" },
    { symbol, assetClass: "etf" }
  ];
}

export function normalizeKoreanStockSearchItems(payload: NaverStockSearchResponse): StockSearchResult[] {
  const seenCodes = new Set<string>();
  const results: StockSearchResult[] = [];

  for (const item of payload.items ?? []) {
    const code = item.code?.trim() ?? "";
    const name = item.name?.trim() ?? "";

    if (
      !/^\d{6}$/.test(code) ||
      !name ||
      seenCodes.has(code) ||
      item.nationCode !== "KOR" ||
      item.category !== "stock"
    ) {
      continue;
    }

    seenCodes.add(code);
    results.push({
      code,
      name,
      market: item.typeName?.trim() || item.typeCode?.trim() || "한국"
    });
  }

  return results.slice(0, 8);
}

function compactIsoDate(date: string): string {
  return date.replaceAll("-", "");
}

function expandCompactDate(date: string): string {
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

function addIsoDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const nextDate = new Date(Date.UTC(year, month - 1, day + days));

  return nextDate.toISOString().slice(0, 10);
}

function formatProviderMessage(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => formatProviderMessage(item) ?? JSON.stringify(item)).join(", ");
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;

    if (typeof record.errorMessage === "string") {
      return record.errorMessage;
    }

    if (typeof record.message === "string") {
      return record.message;
    }
  }

  return JSON.stringify(value);
}

function parseNasdaqDate(date: string | undefined): string | null {
  if (!date) {
    return null;
  }

  const match = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) {
    return null;
  }

  const [, month, day, year] = match;

  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function parseNaverHistoricalCloseRows(text: string): Array<{ tradeDate: string; close: number }> {
  const rows: Array<{ tradeDate: string; close: number }> = [];
  const rowPattern =
    /\[\s*"(\d{8})"\s*,\s*[-\d.,]+\s*,\s*[-\d.,]+\s*,\s*[-\d.,]+\s*,\s*([-\d.,]+)\s*,/g;
  let match: RegExpExecArray | null;

  while ((match = rowPattern.exec(text))) {
    const close = asPositiveNumber(match[2]);

    if (close !== null) {
      rows.push({
        tradeDate: expandCompactDate(match[1]),
        close
      });
    }
  }

  return rows;
}

export function parseNasdaqHistoricalCloseRows(
  payload: NasdaqHistoricalResponse
): Array<{ tradeDate: string; close: number }> {
  const rows: Array<{ tradeDate: string; close: number }> = [];

  for (const row of payload.data?.tradesTable?.rows ?? []) {
    const tradeDate = parseNasdaqDate(row.date);
    const close = asPositiveNumber(row.close);

    if (tradeDate && close !== null) {
      rows.push({ tradeDate, close });
    }
  }

  return rows;
}

function getLastClose(data: YahooChartResult): number | null {
  const closes = data.indicators?.quote?.[0]?.close ?? [];

  for (let index = closes.length - 1; index >= 0; index -= 1) {
    const close = asPositiveNumber(closes[index]);
    if (close !== null) {
      return close;
    }
  }

  return null;
}

function getQuoteTimestamp(metaTime: number | undefined, timestamps: number[] | undefined): string {
  const timestamp = metaTime ?? timestamps?.[timestamps.length - 1];
  return timestamp ? new Date(timestamp * 1000).toISOString() : new Date().toISOString();
}

function getNasdaqQuoteTimestamp(primaryTimestamp: string | undefined, secondaryTimestamp: string | undefined): string {
  const timestamp = primaryTimestamp ?? secondaryTimestamp;
  const parsed = timestamp ? Date.parse(timestamp) : Number.NaN;

  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

export async function searchKoreanStocks(query: string, fetcher: typeof fetch = fetch): Promise<StockSearchResult[]> {
  const normalized = query.trim();

  if (!normalized) {
    return [];
  }

  if (/^\d{6}$/.test(normalized)) {
    return [
      {
        code: normalized,
        name: normalized,
        market: "직접입력"
      }
    ];
  }

  const response = await fetcher(
    `https://ac.stock.naver.com/ac?q=${encodeURIComponent(normalized)}&q_enc=utf-8&target=stock`,
    {
      headers: {
        Accept: "application/json, text/plain, */*",
        Referer: "https://finance.naver.com",
        "User-Agent": "Mozilla/5.0"
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Naver Stock: HTTP ${response.status}`);
  }

  return normalizeKoreanStockSearchItems((await response.json()) as NaverStockSearchResponse);
}

async function fetchNaverHistoricalClose(
  stockCode: string,
  date: string,
  fetcher: typeof fetch
): Promise<HistoricalCloseSnapshot> {
  const normalized = stockCode.trim();

  if (!/^\d{6}$/.test(normalized)) {
    throw new Error("국내 6자리 종목코드가 아닙니다.");
  }

  const compactDate = compactIsoDate(date);
  const response = await fetcher(
    `https://api.finance.naver.com/siseJson.naver?symbol=${encodeURIComponent(
      normalized
    )}&requestType=1&startTime=${compactDate}&endTime=${compactDate}&timeframe=day`,
    {
      headers: {
        Accept: "text/plain, */*",
        "User-Agent": "Mozilla/5.0"
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Naver Finance: HTTP ${response.status}`);
  }

  const row = parseNaverHistoricalCloseRows(await response.text()).find((item) => item.tradeDate === date);

  if (!row) {
    throw new Error(`${date} 종가 없음`);
  }

  return {
    close: row.close,
    tradeDate: row.tradeDate,
    source: NAVER_QUOTE_SOURCE,
    symbol: normalized
  };
}

async function fetchNasdaqHistoricalClose(
  stockCode: string,
  date: string,
  fetcher: typeof fetch
): Promise<HistoricalCloseSnapshot> {
  const candidates = buildNasdaqQuoteCandidates(stockCode);
  const errors: string[] = [];
  const toDate = addIsoDays(date, 1);

  for (const candidate of candidates) {
    const response = await fetcher(
      `https://api.nasdaq.com/api/quote/${encodeURIComponent(
        candidate.symbol
      )}/historical?assetclass=${candidate.assetClass}&fromdate=${date}&todate=${toDate}&limit=9999`,
      {
        headers: {
          Accept: "application/json, text/plain, */*",
          Origin: "https://www.nasdaq.com",
          Referer: "https://www.nasdaq.com/",
          "User-Agent": "Mozilla/5.0"
        }
      }
    );

    if (!response.ok) {
      errors.push(`${candidate.symbol}/${candidate.assetClass}: HTTP ${response.status}`);
      continue;
    }

    const payload = (await response.json()) as NasdaqHistoricalResponse;
    const statusCode = payload.status?.rCode;

    if (statusCode && statusCode >= 400) {
      errors.push(
        `${candidate.symbol}/${candidate.assetClass}: ${
          formatProviderMessage(payload.status?.bCodeMessage) ??
          formatProviderMessage(payload.status?.developerMessage) ??
          `rCode ${statusCode}`
        }`
      );
      continue;
    }

    const row = parseNasdaqHistoricalCloseRows(payload).find((item) => item.tradeDate === date);

    if (!row) {
      errors.push(`${candidate.symbol}/${candidate.assetClass}: ${date} 종가 없음`);
      continue;
    }

    return {
      close: row.close,
      tradeDate: row.tradeDate,
      source: NASDAQ_QUOTE_SOURCE,
      symbol: payload.data?.symbol ?? candidate.symbol
    };
  }

  throw new Error(errors.join(" / ") || "Nasdaq 과거 종가 후보 심볼을 만들 수 없습니다.");
}

export async function fetchHistoricalClose(
  stockCode: string,
  date: string,
  fetcher: typeof fetch = fetch
): Promise<HistoricalCloseSnapshot> {
  const normalized = stockCode.trim();

  if (!normalized) {
    throw new Error("종목코드 없음");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("매수일은 YYYY-MM-DD 형식이어야 합니다.");
  }

  if (/^\d{6}$/.test(normalized)) {
    return fetchNaverHistoricalClose(normalized, date, fetcher);
  }

  return fetchNasdaqHistoricalClose(normalized, date, fetcher);
}

async function fetchNaverQuote(stockCode: string, fetcher: typeof fetch): Promise<QuoteSnapshot> {
  const normalized = stockCode.trim();

  if (!/^\d{6}$/.test(normalized)) {
    throw new Error("국내 6자리 종목코드가 아닙니다.");
  }

  const response = await fetcher(
    `https://polling.finance.naver.com/api/realtime/domestic/stock/${encodeURIComponent(normalized)}`
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = (await response.json()) as NaverQuoteResponse;
  const data = payload.datas?.[0];

  if (!data) {
    throw new Error("결과 없음");
  }

  const price = asPositiveNumber(data.closePriceRaw) ?? asPositiveNumber(data.closePrice);
  if (price === null) {
    throw new Error("현재가 없음");
  }

  const exchangeCode = data.stockExchangeType?.code;

  return {
    price,
    priceAt: data.localTradedAt ? new Date(data.localTradedAt).toISOString() : new Date().toISOString(),
    source: NAVER_QUOTE_SOURCE,
    symbol: exchangeCode ? `${normalized}.${exchangeCode}` : normalized
  };
}

async function fetchNasdaqQuote(stockCode: string, fetcher: typeof fetch): Promise<QuoteSnapshot> {
  const candidates = buildNasdaqQuoteCandidates(stockCode);
  const errors: string[] = [];

  for (const candidate of candidates) {
    const response = await fetcher(
      `https://api.nasdaq.com/api/quote/${encodeURIComponent(candidate.symbol)}/info?assetclass=${
        candidate.assetClass
      }`,
      {
        headers: {
          Accept: "application/json, text/plain, */*",
          Origin: "https://www.nasdaq.com",
          Referer: "https://www.nasdaq.com/",
          "User-Agent": "Mozilla/5.0"
        }
      }
    );

    if (!response.ok) {
      errors.push(`${candidate.symbol}/${candidate.assetClass}: HTTP ${response.status}`);
      continue;
    }

    const payload = (await response.json()) as NasdaqQuoteResponse;
    const statusCode = payload.status?.rCode;

    if (statusCode && statusCode >= 400) {
      errors.push(
        `${candidate.symbol}/${candidate.assetClass}: ${
          formatProviderMessage(payload.status?.bCodeMessage) ??
          formatProviderMessage(payload.status?.developerMessage) ??
          `rCode ${statusCode}`
        }`
      );
      continue;
    }

    const data = payload.data;
    if (!data) {
      errors.push(`${candidate.symbol}/${candidate.assetClass}: 결과 없음`);
      continue;
    }

    const price =
      asPositiveNumber(data.primaryData?.lastSalePrice) ?? asPositiveNumber(data.secondaryData?.lastSalePrice);

    if (price === null) {
      errors.push(`${candidate.symbol}/${candidate.assetClass}: 현재가 없음`);
      continue;
    }

    return {
      price,
      priceAt: getNasdaqQuoteTimestamp(data.primaryData?.lastTradeTimestamp, data.secondaryData?.lastTradeTimestamp),
      source: NASDAQ_QUOTE_SOURCE,
      symbol: data.symbol ?? candidate.symbol
    };
  }

  throw new Error(errors.join(" / ") || "Nasdaq 시세 후보 심볼을 만들 수 없습니다.");
}

export async function fetchQuote(stockCode: string, fetcher: typeof fetch = fetch): Promise<QuoteSnapshot> {
  const providerErrors: string[] = [];

  if (/^\d{6}$/.test(stockCode.trim())) {
    try {
      return await fetchNaverQuote(stockCode, fetcher);
    } catch (caughtError) {
      providerErrors.push(
        `${NAVER_QUOTE_SOURCE}: ${caughtError instanceof Error ? caughtError.message : "요청 실패"}`
      );
    }
  }

  const candidates = buildYahooSymbolCandidates(stockCode);
  const errors = [...providerErrors];

  for (const symbol of candidates) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol
    )}?range=1d&interval=1m`;

    try {
      const response = await fetcher(url);

      if (!response.ok) {
        errors.push(`${symbol}: HTTP ${response.status}`);
        continue;
      }

      const payload = (await response.json()) as YahooChartResponse;
      const chartError = payload.chart?.error;

      if (chartError) {
        errors.push(`${symbol}: ${chartError.description ?? chartError.code ?? "응답 오류"}`);
        continue;
      }

      const result = payload.chart?.result?.[0];
      if (!result) {
        errors.push(`${symbol}: 결과 없음`);
        continue;
      }

      const price = asPositiveNumber(result.meta?.regularMarketPrice) ?? getLastClose(result);
      if (price === null) {
        errors.push(`${symbol}: 현재가 없음`);
        continue;
      }

      return {
        price,
        priceAt: getQuoteTimestamp(result.meta?.regularMarketTime, result.timestamp),
        source: QUOTE_SOURCE,
        symbol: result.meta?.symbol ?? symbol
      };
    } catch (caughtError) {
      errors.push(`${symbol}: ${caughtError instanceof Error ? caughtError.message : "요청 실패"}`);
    }
  }

  if (!/^\d{6}$/.test(stockCode.trim())) {
    try {
      return await fetchNasdaqQuote(stockCode, fetcher);
    } catch (caughtError) {
      errors.push(
        `${NASDAQ_QUOTE_SOURCE}: ${caughtError instanceof Error ? caughtError.message : "요청 실패"}`
      );
    }
  }

  throw new Error(errors.join(" / ") || "시세 후보 심볼을 만들 수 없습니다.");
}

export async function refreshEntryQuote(env: Env, entry: EntryPreview): Promise<QuoteRefreshResult> {
  if (!entry.stockCode.trim()) {
    const message = "종목코드 없음";

    await env.DB.prepare(
      `UPDATE entries
       SET current_price = NULL,
           current_price_at = NULL,
           current_price_source = NULL,
           current_price_symbol = NULL,
           current_return_percent = NULL,
           current_price_error = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
      .bind(message, entry.id)
      .run();

    return {
      entryId: entry.id,
      participantName: entry.participantName,
      stockName: entry.stockName,
      stockCode: entry.stockCode,
      ok: false,
      price: null,
      returnPercent: null,
      priceAt: null,
      symbol: null,
      source: null,
      error: message
    };
  }

  try {
    const quote = await fetchQuote(entry.stockCode);
    const returnPercent = calculateReturnPercent(entry.buyClose, quote.price);

    await env.DB.prepare(
      `UPDATE entries
       SET current_price = ?,
           current_price_at = ?,
           current_price_source = ?,
           current_price_symbol = ?,
           current_return_percent = ?,
           current_price_error = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
      .bind(quote.price, quote.priceAt, quote.source, quote.symbol, returnPercent, entry.id)
      .run();

    return {
      entryId: entry.id,
      participantName: entry.participantName,
      stockName: entry.stockName,
      stockCode: entry.stockCode,
      ok: true,
      price: quote.price,
      returnPercent,
      priceAt: quote.priceAt,
      symbol: quote.symbol,
      source: quote.source,
      error: null
    };
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : "시세를 가져오지 못했습니다.";

    await env.DB.prepare(
      `UPDATE entries
       SET current_price_error = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
      .bind(message.slice(0, 500), entry.id)
      .run();

    return {
      entryId: entry.id,
      participantName: entry.participantName,
      stockName: entry.stockName,
      stockCode: entry.stockCode,
      ok: false,
      price: null,
      returnPercent: null,
      priceAt: null,
      symbol: null,
      source: QUOTE_SOURCE,
      error: message
    };
  }
}

export async function refreshQuotesForMonth(env: Env, month?: string): Promise<QuoteRefreshResult[]> {
  const entries = (await listEntries(env, month)).filter((entry) => month || !entry.finalizedAt);
  const results: QuoteRefreshResult[] = [];

  for (let index = 0; index < entries.length; index += REFRESH_CONCURRENCY) {
    const chunk = entries.slice(index, index + REFRESH_CONCURRENCY);
    results.push(...(await Promise.all(chunk.map((entry) => refreshEntryQuote(env, entry)))));
  }

  return results;
}
