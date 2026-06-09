import { describe, expect, it } from "vitest";
import { buildNasdaqQuoteCandidates, fetchQuote } from "./quotes";

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
});
