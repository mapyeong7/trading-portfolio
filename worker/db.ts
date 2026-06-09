import { getEntryPreview } from "../shared/calculations";
import type { AdminAccount, ContestMonth, Entry, EntryPreview, MonthStatus, Participant } from "../shared/types";
import type { Env } from "./auth";

type MonthRow = {
  id: number;
  month: string;
  title: string;
  start_date: string;
  end_date: string;
  status: MonthStatus;
};

type ParticipantRow = {
  id: number;
  name: string;
  memo: string;
  active: number;
};

type AccountRow = {
  id: number;
  username: string;
  display_name: string;
  created_at: string;
  updated_at: string;
};

type EntryRow = {
  id: number;
  month_id: number;
  month: string;
  month_title: string;
  month_end_date: string;
  participant_id: number;
  participant_name: string;
  stock_name: string;
  stock_code: string;
  buy_date: string;
  buy_close: number;
  end_close: number | null;
  sell_date: string | null;
  sell_close: number | null;
  idea_memo: string;
  final_exit_date: string | null;
  final_exit_close: number | null;
  final_return_percent: number | null;
  finalized_at: string | null;
  current_price: number | null;
  current_price_at: string | null;
  current_price_source: string | null;
  current_price_symbol: string | null;
  current_return_percent: number | null;
  current_price_error: string | null;
};

function mapMonth(row: MonthRow): ContestMonth {
  return {
    id: row.id,
    month: row.month,
    title: row.title,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status
  };
}

function mapParticipant(row: ParticipantRow): Participant {
  return {
    id: row.id,
    name: row.name,
    memo: row.memo,
    active: row.active === 1
  };
}

function mapAccount(row: AccountRow): AdminAccount {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapEntry(row: EntryRow): Entry {
  return {
    id: row.id,
    monthId: row.month_id,
    month: row.month,
    monthTitle: row.month_title,
    monthEndDate: row.month_end_date,
    participantId: row.participant_id,
    participantName: row.participant_name,
    stockName: row.stock_name,
    stockCode: row.stock_code,
    buyDate: row.buy_date,
    buyClose: row.buy_close,
    endClose: row.end_close,
    sellDate: row.sell_date,
    sellClose: row.sell_close,
    ideaMemo: row.idea_memo,
    finalExitDate: row.final_exit_date,
    finalExitClose: row.final_exit_close,
    finalReturnPercent: row.final_return_percent,
    finalizedAt: row.finalized_at,
    currentPrice: row.current_price,
    currentPriceAt: row.current_price_at,
    currentPriceSource: row.current_price_source,
    currentPriceSymbol: row.current_price_symbol,
    currentReturnPercent: row.current_return_percent,
    currentPriceError: row.current_price_error
  };
}

export async function listMonths(env: Env): Promise<ContestMonth[]> {
  const result = await env.DB.prepare(
    "SELECT id, month, title, start_date, end_date, status FROM contest_months ORDER BY month DESC"
  ).all<MonthRow>();

  return result.results.map(mapMonth);
}

export async function getMonthById(env: Env, id: number): Promise<ContestMonth | null> {
  const row = await env.DB.prepare(
    "SELECT id, month, title, start_date, end_date, status FROM contest_months WHERE id = ?"
  )
    .bind(id)
    .first<MonthRow>();

  return row ? mapMonth(row) : null;
}

export async function getMonthByKey(env: Env, month: string): Promise<ContestMonth | null> {
  const row = await env.DB.prepare(
    "SELECT id, month, title, start_date, end_date, status FROM contest_months WHERE month = ?"
  )
    .bind(month)
    .first<MonthRow>();

  return row ? mapMonth(row) : null;
}

export async function listParticipants(env: Env): Promise<Participant[]> {
  const result = await env.DB.prepare(
    "SELECT id, name, memo, active FROM participants WHERE deleted_at IS NULL ORDER BY active DESC, name ASC"
  ).all<ParticipantRow>();

  return result.results.map(mapParticipant);
}

export async function listAccounts(env: Env): Promise<AdminAccount[]> {
  const result = await env.DB.prepare(
    "SELECT id, username, display_name, created_at, updated_at FROM accounts ORDER BY username ASC"
  ).all<AccountRow>();

  return result.results.map(mapAccount);
}

export async function countActiveParticipants(env: Env): Promise<number> {
  const result = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM participants WHERE active = 1 AND deleted_at IS NULL"
  ).first<{ count: number }>();

  return result?.count ?? 0;
}

export async function listEntries(env: Env, month?: string): Promise<EntryPreview[]> {
  const baseSql = `SELECT
      entries.id,
      entries.month_id,
      contest_months.month,
      contest_months.title AS month_title,
      contest_months.end_date AS month_end_date,
      entries.participant_id,
      participants.name AS participant_name,
      entries.stock_name,
      entries.stock_code,
      entries.buy_date,
      entries.buy_close,
      entries.end_close,
      entries.sell_date,
      entries.sell_close,
      entries.idea_memo,
      entries.final_exit_date,
      entries.final_exit_close,
      entries.final_return_percent,
      entries.finalized_at,
      entries.current_price,
      entries.current_price_at,
      entries.current_price_source,
      entries.current_price_symbol,
      entries.current_return_percent,
      entries.current_price_error
    FROM entries
    INNER JOIN contest_months ON contest_months.id = entries.month_id
    INNER JOIN participants ON participants.id = entries.participant_id`;

  const query = month
    ? env.DB.prepare(`${baseSql} WHERE contest_months.month = ? ORDER BY participants.name ASC`).bind(month)
    : env.DB.prepare(`${baseSql} ORDER BY contest_months.month ASC, participants.name ASC`);

  const result = await query.all<EntryRow>();
  return result.results.map((row) => getEntryPreview(mapEntry(row)));
}

export async function getEntryById(env: Env, id: number): Promise<EntryPreview | null> {
  const result = await env.DB.prepare(
    `SELECT
      entries.id,
      entries.month_id,
      contest_months.month,
      contest_months.title AS month_title,
      contest_months.end_date AS month_end_date,
      entries.participant_id,
      participants.name AS participant_name,
      entries.stock_name,
      entries.stock_code,
      entries.buy_date,
      entries.buy_close,
      entries.end_close,
      entries.sell_date,
      entries.sell_close,
      entries.idea_memo,
      entries.final_exit_date,
      entries.final_exit_close,
      entries.final_return_percent,
      entries.finalized_at,
      entries.current_price,
      entries.current_price_at,
      entries.current_price_source,
      entries.current_price_symbol,
      entries.current_return_percent,
      entries.current_price_error
    FROM entries
    INNER JOIN contest_months ON contest_months.id = entries.month_id
    INNER JOIN participants ON participants.id = entries.participant_id
    WHERE entries.id = ?`
  )
    .bind(id)
    .first<EntryRow>();

  return result ? getEntryPreview(mapEntry(result)) : null;
}
