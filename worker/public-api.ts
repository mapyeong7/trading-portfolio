import { buildCumulativeRanking, buildMonthlyRanking } from "../shared/calculations";
import type { LeaderboardResponse } from "../shared/types";
import { isMonthKey } from "../shared/validation";
import type { Env } from "./auth";
import { listEntries, listMonths, listParticipants } from "./db";
import { error, json } from "./http";
import { getPublicMonths, selectContestMonth } from "./months";

export async function handleMonths(env: Env, request: Request): Promise<Response> {
  if (request.method !== "GET") {
    return error("허용되지 않은 메서드입니다.", 405);
  }

  return json({ months: getPublicMonths(await listMonths(env)) });
}

export async function handleEntries(env: Env, request: Request, url: URL): Promise<Response> {
  if (request.method !== "GET") {
    return error("허용되지 않은 메서드입니다.", 405);
  }

  const month = url.searchParams.get("month") ?? undefined;

  if (month && !isMonthKey(month)) {
    return error("month는 YYYY-MM 형식이어야 합니다.");
  }

  const publicMonths = getPublicMonths(await listMonths(env));
  const publicMonthKeys = new Set(publicMonths.map((item) => item.month));

  if (month) {
    return json({ entries: publicMonthKeys.has(month) ? await listEntries(env, month) : [] });
  }

  const publicEntries = (await listEntries(env)).filter((entry) => publicMonthKeys.has(entry.month));
  return json({ entries: publicEntries });
}

export async function handleLeaderboard(env: Env, request: Request, url: URL): Promise<Response> {
  if (request.method !== "GET") {
    return error("허용되지 않은 메서드입니다.", 405);
  }

  const months = getPublicMonths(await listMonths(env));
  const requestedMonth = url.searchParams.get("month");
  const selectedMonth = selectContestMonth(months, requestedMonth);
  const selectedMonthEntries = selectedMonth ? await listEntries(env, selectedMonth.month) : [];
  const publicMonthKeys = new Set(months.map((month) => month.month));
  const allEntries = (await listEntries(env)).filter((entry) => publicMonthKeys.has(entry.month));
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
