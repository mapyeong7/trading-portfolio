import type { ContestMonth, MonthStatus } from "../shared/types";

export function isMonthStatus(value: unknown): value is MonthStatus {
  return value === "draft" || value === "open" || value === "finalized";
}

export function getPublicMonths(months: ContestMonth[]): ContestMonth[] {
  return months.filter((month) => month.status !== "draft");
}

export function selectContestMonth(months: ContestMonth[], requestedMonth: string | null): ContestMonth | null {
  return (
    (requestedMonth ? months.find((month) => month.month === requestedMonth) : undefined) ??
    months.find((month) => month.status === "open") ??
    months[0] ??
    null
  );
}
