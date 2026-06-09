import {
  buildCumulativeRanking,
  buildMonthlyRanking,
  calculateReturnPercent
} from "../shared/calculations";
import type {
  AdminBootstrapResponse,
  ApiError,
  HistoricalCloseResponse,
  LeaderboardResponse,
  QuoteCheckResponse,
  QuoteRefreshResponse,
  StockSearchResponse
} from "../shared/types";
import {
  dateBelongsToMonth,
  getMonthEnd,
  getMonthStart,
  isDateRangeValid,
  isIsoDate,
  isMonthKey,
  normalizeOptionalNumber,
  normalizeText
} from "../shared/validation";
import {
  buildExpiredSessionCookie,
  buildSessionCookie,
  createSessionToken,
  deleteCurrentSession,
  getSessionAccount,
  hashPassword,
  sha256Base64Url,
  type Env,
  verifyPassword
} from "./auth";
import {
  getEntryById,
  getMonthById,
  getMonthByKey,
  listAccounts,
  listEntries,
  listMonths,
  listParticipants
} from "./db";
import { fetchHistoricalClose, fetchQuote, refreshQuotesForMonth, searchKoreanStocks } from "./quotes";

type JsonBody = Record<string, unknown>;

class RequestError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function json<T>(data: T, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers
    }
  });
}

function error(message: string, status = 400): Response {
  return json<ApiError>({ error: message }, status);
}

async function readJson(request: Request): Promise<JsonBody> {
  if (!request.headers.get("Content-Type")?.includes("application/json")) {
    return {};
  }

  try {
    return (await request.json()) as JsonBody;
  } catch {
    return {};
  }
}

async function requireAccount(env: Env, request: Request) {
  const account = await getSessionAccount(env, request);

  if (!account) {
    return { account: null, response: error("로그인이 필요합니다.", 401) };
  }

  return { account, response: null };
}

function requirePositiveNumber(value: unknown, label: string): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw new RequestError(`${label}은 0보다 큰 숫자여야 합니다.`);
  }
  return numberValue;
}

function validateEntryDates(month: string, buyDate: string, sellDate: string | null): string | null {
  if (!dateBelongsToMonth(buyDate, month)) {
    return "매수일은 기준월 안의 날짜여야 합니다.";
  }

  if (sellDate) {
    if (!dateBelongsToMonth(sellDate, month)) {
      return "매도일은 기준월 안의 날짜여야 합니다.";
    }

    if (sellDate < buyDate) {
      return "매도일은 매수일 이후여야 합니다.";
    }
  }

  return null;
}

async function handleMonths(env: Env, request: Request): Promise<Response> {
  if (request.method !== "GET") {
    return error("허용되지 않은 메서드입니다.", 405);
  }

  return json({ months: await listMonths(env) });
}

async function handleEntries(env: Env, request: Request, url: URL): Promise<Response> {
  if (request.method !== "GET") {
    return error("허용되지 않은 메서드입니다.", 405);
  }

  const month = url.searchParams.get("month") ?? undefined;

  if (month && !isMonthKey(month)) {
    return error("month는 YYYY-MM 형식이어야 합니다.");
  }

  return json({ entries: await listEntries(env, month) });
}

async function handleLeaderboard(env: Env, request: Request, url: URL): Promise<Response> {
  if (request.method !== "GET") {
    return error("허용되지 않은 메서드입니다.", 405);
  }

  const months = await listMonths(env);
  const requestedMonth = url.searchParams.get("month");
  const selectedMonth =
    (requestedMonth ? months.find((month) => month.month === requestedMonth) : months[0]) ?? null;
  const selectedMonthEntries = selectedMonth ? await listEntries(env, selectedMonth.month) : [];
  const allEntries = await listEntries(env);
  const cumulativeEntries = selectedMonth
    ? allEntries.filter((entry) => entry.month <= selectedMonth.month)
    : allEntries;
  const activeParticipants = (await listParticipants(env)).filter((participant) => participant.active);
  const submittedParticipantIds = new Set(selectedMonthEntries.map((entry) => entry.participantId));
  const missingParticipantNames = activeParticipants
    .filter((participant) => !submittedParticipantIds.has(participant.id))
    .map((participant) => participant.name);

  const response: LeaderboardResponse = {
    selectedMonth,
    months,
    participantCount: activeParticipants.length,
    missingParticipantNames,
    entries: selectedMonthEntries,
    monthlyRanking: buildMonthlyRanking(selectedMonthEntries),
    cumulativeRanking: buildCumulativeRanking(cumulativeEntries)
  };

  return json(response);
}

async function handleLogin(env: Env, request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return error("허용되지 않은 메서드입니다.", 405);
  }

  const body = await readJson(request);
  const username = normalizeText(body.username);
  const password = typeof body.password === "string" ? body.password : "";

  if (!username || !password) {
    return error("아이디와 비밀번호를 입력해주세요.");
  }

  const account = await env.DB.prepare(
    "SELECT id, username, display_name AS displayName, password_hash AS passwordHash FROM accounts WHERE username = ?"
  )
    .bind(username)
    .first<{ id: number; username: string; displayName: string; passwordHash: string }>();

  if (!account || !(await verifyPassword(password, account.passwordHash))) {
    return error("아이디 또는 비밀번호가 올바르지 않습니다.", 401);
  }

  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14);
  await env.DB.prepare("INSERT INTO sessions (account_id, token_hash, expires_at) VALUES (?, ?, ?)")
    .bind(account.id, await sha256Base64Url(token), expiresAt.toISOString())
    .run();

  return json(
    {
      account: {
        id: account.id,
        username: account.username,
        displayName: account.displayName
      }
    },
    200,
    { "Set-Cookie": buildSessionCookie(env, token, expiresAt) }
  );
}

async function handleLogout(env: Env, request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return error("허용되지 않은 메서드입니다.", 405);
  }

  await deleteCurrentSession(env, request);
  return json({ ok: true }, 200, { "Set-Cookie": buildExpiredSessionCookie(env) });
}

async function handleAdminMe(env: Env, request: Request): Promise<Response> {
  if (request.method !== "GET") {
    return error("허용되지 않은 메서드입니다.", 405);
  }

  const { account, response } = await requireAccount(env, request);
  return response ?? json({ account });
}

async function handleAdminBootstrap(env: Env, request: Request, url: URL): Promise<Response> {
  if (request.method !== "GET") {
    return error("허용되지 않은 메서드입니다.", 405);
  }

  const { account, response } = await requireAccount(env, request);
  if (response) {
    return response;
  }

  const months = await listMonths(env);
  const requestedMonth = url.searchParams.get("month");
  const selectedMonth =
    (requestedMonth ? months.find((month) => month.month === requestedMonth) : months[0]) ?? null;
  const payload: AdminBootstrapResponse = {
    account: account!,
    accounts: await listAccounts(env),
    months,
    participants: await listParticipants(env),
    entries: selectedMonth ? await listEntries(env, selectedMonth.month) : [],
    selectedMonth
  };

  return json(payload);
}

async function handleAdminAccounts(env: Env, request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return error("허용되지 않은 메서드입니다.", 405);
  }

  const { response } = await requireAccount(env, request);
  if (response) {
    return response;
  }

  const body = await readJson(request);
  const id = normalizeOptionalNumber(body.id);
  const username = normalizeText(body.username);
  const displayName = normalizeText(body.displayName) || username;
  const password = typeof body.password === "string" ? body.password : "";

  if (!username) {
    return error("관리자 아이디를 입력해주세요.");
  }

  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) {
    return error("관리자 아이디는 영문, 숫자, 점, 밑줄, 하이픈 3-40자로 입력해주세요.");
  }

  if (!displayName) {
    return error("관리자 표시 이름을 입력해주세요.");
  }

  if (!id && password.length < 8) {
    return error("비밀번호는 8자 이상이어야 합니다.");
  }

  if (id && password && password.length < 8) {
    return error("새 비밀번호는 8자 이상이어야 합니다.");
  }

  const duplicate = await env.DB.prepare("SELECT id FROM accounts WHERE username = ?")
    .bind(username)
    .first<{ id: number }>();

  if (duplicate && duplicate.id !== id) {
    return error("이미 사용 중인 관리자 아이디입니다.", 409);
  }

  if (id) {
    const existing = await env.DB.prepare("SELECT id FROM accounts WHERE id = ?")
      .bind(id)
      .first<{ id: number }>();

    if (!existing) {
      return error("관리자 계정을 찾을 수 없습니다.", 404);
    }

    if (password) {
      await env.DB.prepare(
        `UPDATE accounts
         SET username = ?,
             display_name = ?,
             password_hash = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
        .bind(username, displayName, await hashPassword(password), id)
        .run();
    } else {
      await env.DB.prepare(
        `UPDATE accounts
         SET username = ?,
             display_name = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
        .bind(username, displayName, id)
        .run();
    }
  } else {
    await env.DB.prepare("INSERT INTO accounts (username, display_name, password_hash) VALUES (?, ?, ?)")
      .bind(username, displayName, await hashPassword(password))
      .run();
  }

  return json({ accounts: await listAccounts(env) });
}

async function handleAdminParticipants(env: Env, request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return error("허용되지 않은 메서드입니다.", 405);
  }

  const { response } = await requireAccount(env, request);
  if (response) {
    return response;
  }

  const body = await readJson(request);
  const id = normalizeOptionalNumber(body.id);
  const name = normalizeText(body.name);
  const memo = normalizeText(body.memo);
  const active = body.active === false ? 0 : 1;

  if (!name) {
    return error("참가자 이름을 입력해주세요.");
  }

  try {
    if (id) {
      await env.DB.prepare(
        "UPDATE participants SET name = ?, memo = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      )
        .bind(name, memo, active, id)
        .run();
    } else {
      await env.DB.prepare("INSERT INTO participants (name, memo, active) VALUES (?, ?, ?)")
        .bind(name, memo, active)
        .run();
    }
  } catch (caughtError) {
    if (String(caughtError).includes("UNIQUE")) {
      return error("이미 같은 이름의 참가자가 있습니다.", 409);
    }
    throw caughtError;
  }

  return json({ participants: await listParticipants(env) });
}

async function handleAdminDeleteParticipant(env: Env, request: Request, participantId: number): Promise<Response> {
  if (request.method !== "DELETE") {
    return error("허용되지 않은 메서드입니다.", 405);
  }

  const { response } = await requireAccount(env, request);
  if (response) {
    return response;
  }

  const participant = await env.DB.prepare(
    "SELECT id FROM participants WHERE id = ? AND deleted_at IS NULL"
  )
    .bind(participantId)
    .first<{ id: number }>();

  if (!participant) {
    return error("참가자를 찾을 수 없습니다.", 404);
  }

  await env.DB.prepare(
    `UPDATE participants
     SET active = 0,
         deleted_at = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(new Date().toISOString(), participantId)
    .run();

  return json({ participants: await listParticipants(env) });
}

async function handleAdminMonths(env: Env, request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return error("허용되지 않은 메서드입니다.", 405);
  }

  const { response } = await requireAccount(env, request);
  if (response) {
    return response;
  }

  const body = await readJson(request);
  const id = normalizeOptionalNumber(body.id);
  const month = normalizeText(body.month);
  const title = normalizeText(body.title);
  const startDate = normalizeText(body.startDate) || getMonthStart(month);
  const endDate = normalizeText(body.endDate) || getMonthEnd(month);
  const status = ["draft", "open", "finalized"].includes(String(body.status))
    ? String(body.status)
    : "open";

  if (!isMonthKey(month)) {
    return error("기준월은 YYYY-MM 형식이어야 합니다.");
  }

  if (!dateBelongsToMonth(startDate, month) || !dateBelongsToMonth(endDate, month)) {
    return error("시작일과 종료일은 기준월 안의 날짜여야 합니다.");
  }

  if (!isDateRangeValid(startDate, endDate)) {
    return error("종료일은 시작일 이후여야 합니다.");
  }

  try {
    if (id) {
      await env.DB.prepare(
        `UPDATE contest_months
         SET month = ?, title = ?, start_date = ?, end_date = ?, status = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
        .bind(month, title, startDate, endDate, status, id)
        .run();
    } else {
      await env.DB.prepare(
        "INSERT INTO contest_months (month, title, start_date, end_date, status) VALUES (?, ?, ?, ?, ?)"
      )
        .bind(month, title, startDate, endDate, status)
        .run();
    }
  } catch (caughtError) {
    if (String(caughtError).includes("UNIQUE")) {
      return error("이미 같은 기준월이 있습니다.", 409);
    }
    throw caughtError;
  }

  return json({ months: await listMonths(env) });
}

async function handleAdminCreateEntry(env: Env, request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return error("허용되지 않은 메서드입니다.", 405);
  }

  const { response } = await requireAccount(env, request);
  if (response) {
    return response;
  }

  const body = await readJson(request);
  const monthId = requirePositiveNumber(body.monthId, "기준월");
  const participantId = requirePositiveNumber(body.participantId, "참가자");
  const stockName = normalizeText(body.stockName);
  const stockCode = normalizeText(body.stockCode);
  const buyDate = normalizeText(body.buyDate);
  const buyClose = requirePositiveNumber(body.buyClose, "매수가");
  const endClose = normalizeOptionalNumber(body.endClose);
  const sellDate = normalizeText(body.sellDate) || null;
  const sellClose = normalizeOptionalNumber(body.sellClose);
  const ideaMemo = typeof body.ideaMemo === "string" ? body.ideaMemo.trim() : "";

  if (!stockName) {
    return error("종목명을 입력해주세요.");
  }

  if ((sellDate && sellClose === null) || (!sellDate && sellClose !== null)) {
    return error("매도일과 매도 확정가는 함께 입력해야 합니다.");
  }

  const month = await getMonthById(env, monthId);
  if (!month) {
    return error("기준월을 찾을 수 없습니다.", 404);
  }

  const dateError = validateEntryDates(month.month, buyDate, sellDate);
  if (dateError) {
    return error(dateError);
  }

  try {
    await env.DB.prepare(
      `INSERT INTO entries (
        month_id,
        participant_id,
        stock_name,
        stock_code,
        buy_date,
        buy_close,
        end_close,
        sell_date,
        sell_close,
        idea_memo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        monthId,
        participantId,
        stockName,
        stockCode,
        buyDate,
        buyClose,
        endClose,
        sellDate,
        sellClose,
        ideaMemo
      )
      .run();
  } catch (caughtError) {
    if (String(caughtError).includes("UNIQUE")) {
      return error("이 참가자는 해당 기준월에 이미 종목을 등록했습니다.", 409);
    }
    throw caughtError;
  }

  return json({ entries: await listEntries(env, month.month) }, 201);
}

async function handleAdminPatchEntry(env: Env, request: Request, entryId: number): Promise<Response> {
  if (request.method !== "PATCH") {
    return error("허용되지 않은 메서드입니다.", 405);
  }

  const { response } = await requireAccount(env, request);
  if (response) {
    return response;
  }

  const entry = await getEntryById(env, entryId);
  if (!entry) {
    return error("참가 종목을 찾을 수 없습니다.", 404);
  }

  if (entry.finalizedAt) {
    return error("확정된 결과는 기본 수정 화면에서 변경할 수 없습니다.", 409);
  }

  const body = await readJson(request);
  const stockName = normalizeText(body.stockName) || entry.stockName;
  const stockCode = body.stockCode === undefined ? entry.stockCode : normalizeText(body.stockCode);
  const buyDate = normalizeText(body.buyDate) || entry.buyDate;
  const buyClose = body.buyClose === undefined ? entry.buyClose : requirePositiveNumber(body.buyClose, "매수가");
  const endClose = body.endClose === undefined ? entry.endClose : normalizeOptionalNumber(body.endClose);
  const sellDate =
    body.sellDate === undefined ? entry.sellDate : normalizeText(body.sellDate) || null;
  const sellClose =
    body.sellClose === undefined ? entry.sellClose : normalizeOptionalNumber(body.sellClose);
  const ideaMemo = typeof body.ideaMemo === "string" ? body.ideaMemo.trim() : entry.ideaMemo;

  if ((sellDate && sellClose === null) || (!sellDate && sellClose !== null)) {
    return error("매도일과 매도 확정가는 함께 입력해야 합니다.");
  }

  const dateError = validateEntryDates(entry.month, buyDate, sellDate);
  if (dateError) {
    return error(dateError);
  }

  await env.DB.prepare(
    `UPDATE entries
     SET stock_name = ?,
         stock_code = ?,
         buy_date = ?,
         buy_close = ?,
         end_close = ?,
         sell_date = ?,
         sell_close = ?,
         idea_memo = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(stockName, stockCode, buyDate, buyClose, endClose, sellDate, sellClose, ideaMemo, entryId)
    .run();

  return json({ entries: await listEntries(env, entry.month) });
}

async function handleAdminFinalizeEntry(env: Env, request: Request, entryId: number): Promise<Response> {
  if (request.method !== "POST") {
    return error("허용되지 않은 메서드입니다.", 405);
  }

  const { response } = await requireAccount(env, request);
  if (response) {
    return response;
  }

  const entry = await getEntryById(env, entryId);
  if (!entry) {
    return error("참가 종목을 찾을 수 없습니다.", 404);
  }

  if (entry.finalizedAt) {
    return error("이미 확정된 결과입니다.", 409);
  }

  const exitDate = entry.sellDate ?? entry.monthEndDate;
  const exitClose = entry.sellClose ?? entry.endClose;

  if (!exitDate || !isIsoDate(exitDate) || exitClose === null) {
    return error("매도 확정가 또는 월말 종가가 있어야 결과를 확정할 수 있습니다.");
  }

  const finalReturnPercent = calculateReturnPercent(entry.buyClose, exitClose);
  await env.DB.prepare(
    `UPDATE entries
     SET final_exit_date = ?,
         final_exit_close = ?,
         final_return_percent = ?,
         finalized_at = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(exitDate, exitClose, finalReturnPercent, new Date().toISOString(), entryId)
    .run();

  return json({ entries: await listEntries(env, entry.month) });
}

async function handleAdminRefreshQuotes(env: Env, request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return error("허용되지 않은 메서드입니다.", 405);
  }

  const { response } = await requireAccount(env, request);
  if (response) {
    return response;
  }

  const body = await readJson(request);
  const month = normalizeText(body.month) || undefined;

  if (month && !isMonthKey(month)) {
    return error("month는 YYYY-MM 형식이어야 합니다.");
  }

  const results = await refreshQuotesForMonth(env, month);
  const payload: QuoteRefreshResponse = {
    updated: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    results,
    entries: await listEntries(env, month)
  };

  return json(payload);
}

async function handleAdminCheckQuote(env: Env, request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return error("허용되지 않은 메서드입니다.", 405);
  }

  const { response } = await requireAccount(env, request);
  if (response) {
    return response;
  }

  const body = await readJson(request);
  const stockCode = normalizeText(body.stockCode);

  if (!stockCode) {
    return json<QuoteCheckResponse>({
      ok: false,
      stockCode,
      price: null,
      priceAt: null,
      symbol: null,
      source: null,
      error: "종목코드 없음"
    });
  }

  try {
    const quote = await fetchQuote(stockCode);
    return json<QuoteCheckResponse>({
      ok: true,
      stockCode,
      price: quote.price,
      priceAt: quote.priceAt,
      symbol: quote.symbol,
      source: quote.source,
      error: null
    });
  } catch (caughtError) {
    return json<QuoteCheckResponse>({
      ok: false,
      stockCode,
      price: null,
      priceAt: null,
      symbol: null,
      source: null,
      error: caughtError instanceof Error ? caughtError.message.slice(0, 500) : "시세 조회 실패"
    });
  }
}

async function handleAdminHistoricalClose(env: Env, request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return error("허용되지 않은 메서드입니다.", 405);
  }

  const { response } = await requireAccount(env, request);
  if (response) {
    return response;
  }

  const body = await readJson(request);
  const stockCode = normalizeText(body.stockCode);
  const date = normalizeText(body.date);

  if (!stockCode || !date) {
    return json<HistoricalCloseResponse>({
      ok: false,
      stockCode,
      date,
      close: null,
      tradeDate: null,
      symbol: null,
      source: null,
      error: !stockCode ? "종목코드 없음" : "매수일 없음"
    });
  }

  try {
    const close = await fetchHistoricalClose(stockCode, date);
    return json<HistoricalCloseResponse>({
      ok: true,
      stockCode,
      date,
      close: close.close,
      tradeDate: close.tradeDate,
      symbol: close.symbol,
      source: close.source,
      error: null
    });
  } catch (caughtError) {
    return json<HistoricalCloseResponse>({
      ok: false,
      stockCode,
      date,
      close: null,
      tradeDate: null,
      symbol: null,
      source: null,
      error: caughtError instanceof Error ? caughtError.message.slice(0, 500) : "매수일 종가 조회 실패"
    });
  }
}

async function handleAdminStockSearch(env: Env, request: Request, url: URL): Promise<Response> {
  if (request.method !== "GET") {
    return error("허용되지 않은 메서드입니다.", 405);
  }

  const { response } = await requireAccount(env, request);
  if (response) {
    return response;
  }

  const query = normalizeText(url.searchParams.get("q") ?? "");

  if (!query) {
    return json<StockSearchResponse>({
      query,
      results: []
    });
  }

  try {
    return json<StockSearchResponse>({
      query,
      results: await searchKoreanStocks(query)
    });
  } catch (caughtError) {
    return error(caughtError instanceof Error ? caughtError.message : "종목명 검색 실패", 502);
  }
}

async function routeApi(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/api/months") {
    return handleMonths(env, request);
  }

  if (url.pathname === "/api/entries") {
    return handleEntries(env, request, url);
  }

  if (url.pathname === "/api/leaderboard") {
    return handleLeaderboard(env, request, url);
  }

  if (url.pathname === "/api/auth/login") {
    return handleLogin(env, request);
  }

  if (url.pathname === "/api/auth/logout") {
    return handleLogout(env, request);
  }

  if (url.pathname === "/api/admin/me") {
    return handleAdminMe(env, request);
  }

  if (url.pathname === "/api/admin/bootstrap") {
    return handleAdminBootstrap(env, request, url);
  }

  if (url.pathname === "/api/admin/accounts") {
    return handleAdminAccounts(env, request);
  }

  if (url.pathname === "/api/admin/participants") {
    return handleAdminParticipants(env, request);
  }

  const deleteParticipantMatch = url.pathname.match(/^\/api\/admin\/participants\/(\d+)$/);
  if (deleteParticipantMatch) {
    return handleAdminDeleteParticipant(env, request, Number(deleteParticipantMatch[1]));
  }

  if (url.pathname === "/api/admin/months") {
    return handleAdminMonths(env, request);
  }

  if (url.pathname === "/api/admin/entries") {
    return handleAdminCreateEntry(env, request);
  }

  if (url.pathname === "/api/admin/quotes/refresh") {
    return handleAdminRefreshQuotes(env, request);
  }

  if (url.pathname === "/api/admin/quotes/check") {
    return handleAdminCheckQuote(env, request);
  }

  if (url.pathname === "/api/admin/quotes/historical-close") {
    return handleAdminHistoricalClose(env, request);
  }

  if (url.pathname === "/api/admin/stocks/search") {
    return handleAdminStockSearch(env, request, url);
  }

  const finalizeMatch = url.pathname.match(/^\/api\/admin\/entries\/(\d+)\/finalize$/);
  if (finalizeMatch) {
    return handleAdminFinalizeEntry(env, request, Number(finalizeMatch[1]));
  }

  const patchMatch = url.pathname.match(/^\/api\/admin\/entries\/(\d+)$/);
  if (patchMatch) {
    return handleAdminPatchEntry(env, request, Number(patchMatch[1]));
  }

  return error("API 경로를 찾을 수 없습니다.", 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      try {
        return await routeApi(env, request);
      } catch (caughtError) {
        if (caughtError instanceof RequestError) {
          return error(caughtError.message, caughtError.status);
        }
        return error(caughtError instanceof Error ? caughtError.message : "알 수 없는 오류가 발생했습니다.", 500);
      }
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(refreshQuotesForMonth(env));
  }
};
