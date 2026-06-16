import { describe, expect, it } from "vitest";
import {
  buildNasdaqQuoteCandidates,
  fetchHistoricalClose,
  fetchQuote,
  normalizeKoreanStockSearchItems,
  searchKoreanStocks
} from "./quotes";

describe("quote providers", () => {
  it("builds Nasdaq candidates for US stocks and ETFs", () => {
    expect(buildNasdaqQuoteCandidates("aapl")).toEqual([
      { symbol: "AAPL", assetClass: "stocks" },
      { symbol: "AAPL", assetClass: "etf" }
    ]);
    expect(buildNasdaqQuoteCandidates("SPY.US")).toEqual([
      { symbol: "SPY", assetClass: "stocks" },
      { symbol: "SPY", assetClass: "etf" }
    ]);
    expect(buildNasdaqQuoteCandidates("005930")).toEqual([]);
    expect(buildNasdaqQuoteCandidates("0193W0")).toEqual([]);
  });

  it("falls back to Nasdaq when Yahoo is rate limited", async () => {
    const requestedUrls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requestedUrls.push(url);

      if (url.includes("query1.finance.yahoo.com")) {
        return new Response("", { status: 429 });
      }

      if (url.includes("api.nasdaq.com/api/quote/AAPL/info?assetclass=stocks")) {
        return Response.json({
          data: {
            symbol: "AAPL",
            primaryData: {
              lastSalePrice: "$301.93",
              lastTradeTimestamp: "Jun 9, 2026 9:22 AM ET"
            }
          },
          status: { rCode: 200 }
        });
      }

      return new Response("", { status: 404 });
    };

    const quote = await fetchQuote("aapl", fetcher);

    expect(quote.price).toBe(301.93);
    expect(quote.symbol).toBe("AAPL");
    expect(quote.source).toBe("Nasdaq");
    expect(requestedUrls).toContain(
      "https://api.nasdaq.com/api/quote/AAPL/info?assetclass=stocks"
    );
  });

  it("falls back to the Nasdaq ETF asset class", async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);

      if (url.includes("query1.finance.yahoo.com")) {
        return new Response("", { status: 429 });
      }

      if (url.includes("assetclass=stocks")) {
        return Response.json({ data: null, status: { rCode: 404, bCodeMessage: "Not found" } });
      }

      if (url.includes("api.nasdaq.com/api/quote/SPY/info?assetclass=etf")) {
        return Response.json({
          data: {
            symbol: "SPY",
            primaryData: {
              lastSalePrice: "$742.97"
            }
          },
          status: { rCode: 200 }
        });
      }

      return new Response("", { status: 404 });
    };

    const quote = await fetchQuote("spy", fetcher);

    expect(quote.price).toBe(742.97);
    expect(quote.symbol).toBe("SPY");
    expect(quote.source).toBe("Nasdaq");
  });

  it("normalizes Korean stock search results", () => {
    expect(
      normalizeKoreanStockSearchItems({
        items: [
          {
            code: "005930",
            name: "삼성전자",
            typeCode: "KOSPI",
            typeName: "코스피",
            nationCode: "KOR",
            category: "stock"
          },
          {
            code: "005935",
            name: "삼성전자우",
            typeCode: "KOSPI",
            typeName: "코스피",
            nationCode: "KOR",
            category: "stock"
          },
          {
            code: "AAPL",
            name: "Apple",
            nationCode: "USA",
            category: "stock"
          },
          {
            code: "0193W0",
            name: "KODEX 삼성전자단일종목레버리지",
            typeCode: "KOSPI",
            typeName: "코스피",
            nationCode: "KOR",
            category: "stock"
          }
        ]
      })
    ).toEqual([
      { code: "005930", name: "삼성전자", market: "코스피" },
      { code: "005935", name: "삼성전자우", market: "코스피" },
      { code: "0193W0", name: "KODEX 삼성전자단일종목레버리지", market: "코스피" }
    ]);
  });

  it("searches Korean stocks through Naver autocomplete", async () => {
    const fetcher: typeof fetch = async (input) => {
      expect(String(input)).toContain(encodeURIComponent("삼성전자"));
      return Response.json({
        items: [
          {
            code: "005930",
            name: "삼성전자",
            typeCode: "KOSPI",
            typeName: "코스피",
            nationCode: "KOR",
            category: "stock"
          }
        ]
      });
    };

    await expect(searchKoreanStocks("삼성전자", fetcher)).resolves.toEqual([
      { code: "005930", name: "삼성전자", market: "코스피" }
    ]);
  });

  it("cleans punctuation and retries Korean ETF search aliases", async () => {
    const requestedQueries: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const query = url.searchParams.get("q") ?? "";
      requestedQueries.push(query);

      if (query === "TIGER 미국필라델피아반도체나스닥") {
        return Response.json({
          items: [
            {
              code: "381180",
              name: "TIGER 미국필라델피아반도체나스닥",
              typeCode: "KOSPI",
              typeName: "코스피",
              nationCode: "KOR",
              category: "stock"
            }
          ]
        });
      }

      return Response.json({ items: [] });
    };

    await expect(searchKoreanStocks("미국필라델피아반도체나스닥.", fetcher)).resolves.toEqual([
      { code: "381180", name: "TIGER 미국필라델피아반도체나스닥", market: "코스피" }
    ]);
    expect(requestedQueries).toContain("미국필라델피아반도체나스닥");
    expect(requestedQueries).toContain("TIGER 미국필라델피아반도체나스닥");
  });

  it("accepts Korean alphanumeric ETF codes as direct stock search input", async () => {
    await expect(searchKoreanStocks("0193w0")).resolves.toEqual([
      { code: "0193W0", name: "0193W0", market: "직접입력" }
    ]);
  });

  it("fetches Korean historical close for a buy date", async () => {
    const fetcher: typeof fetch = async (input) => {
      expect(String(input)).toContain("symbol=005930");
      expect(String(input)).toContain("startTime=20260605");

      return new Response(`
        [['날짜', '시가', '고가', '저가', '종가', '거래량', '외국인소진율'],
        ["20260605", 333500, 343000, 325000, 329000, 33725012, 47.73]]
      `);
    };

    await expect(fetchHistoricalClose("005930", "2026-06-05", fetcher)).resolves.toEqual({
      close: 329000,
      tradeDate: "2026-06-05",
      source: "Naver Finance",
      symbol: "005930"
    });
  });

  it("fetches Korean alphanumeric ETF historical close through Naver", async () => {
    const fetcher: typeof fetch = async (input) => {
      expect(String(input)).toContain("symbol=0193W0");
      expect(String(input)).toContain("startTime=20260616");

      return new Response(`
        [['날짜', '시가', '고가', '저가', '종가', '거래량', '외국인소진율'],
        ["20260616", 26620, 27025, 25200, 26660, 76278466, 3.78]]
      `);
    };

    await expect(fetchHistoricalClose("0193w0", "2026-06-16", fetcher)).resolves.toEqual({
      close: 26660,
      tradeDate: "2026-06-16",
      source: "Naver Finance",
      symbol: "0193W0"
    });
  });

  it("fetches US historical close through Nasdaq", async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      expect(url).toContain("api.nasdaq.com/api/quote/AAPL/historical");
      expect(url).toContain("fromdate=2026-05-26");
      expect(url).toContain("todate=2026-06-15");

      return Response.json({
        data: {
          symbol: "AAPL",
          tradesTable: {
            rows: [
              {
                date: "06/05/2026",
                close: "$307.34"
              }
            ]
          }
        },
        status: { rCode: 200 }
      });
    };

    await expect(fetchHistoricalClose("aapl", "2026-06-05", fetcher)).resolves.toEqual({
      close: 307.34,
      tradeDate: "2026-06-05",
      source: "Nasdaq",
      symbol: "AAPL"
    });
  });

  it("uses the previous trading day for US historical close on non-trading dates", async () => {
    const fetcher: typeof fetch = async () =>
      Response.json({
        data: {
          symbol: "AAPL",
          tradesTable: {
            rows: [
              {
                date: "06/05/2026",
                close: "$307.34"
              },
              {
                date: "06/04/2026",
                close: "$313.29"
              }
            ]
          }
        },
        status: { rCode: 200 }
      });

    await expect(fetchHistoricalClose("aapl", "2026-06-06", fetcher)).resolves.toEqual({
      close: 307.34,
      tradeDate: "2026-06-05",
      source: "Nasdaq",
      symbol: "AAPL"
    });
  });
});
