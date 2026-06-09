export function isMonthKey(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value);
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function getMonthStart(month: string): string {
  return `${month}-01`;
}

export function getMonthEnd(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String(lastDay).padStart(2, "0")}`;
}

export function dateBelongsToMonth(date: string, month: string): boolean {
  return isIsoDate(date) && isMonthKey(month) && date.startsWith(`${month}-`);
}

export function isDateRangeValid(start: string, end: string): boolean {
  return isIsoDate(start) && isIsoDate(end) && start <= end;
}

export function normalizeOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

export function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
