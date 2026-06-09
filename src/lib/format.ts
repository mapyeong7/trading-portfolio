export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "-";
  }

  return value.toLocaleString("ko-KR");
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "미정";
  }

  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function formatStockCode(value: string | null | undefined): string {
  return value?.trim() || "코드 없음";
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "갱신 전";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

export function returnClass(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "muted";
  }

  if (value > 0) {
    return "positive";
  }

  if (value < 0) {
    return "negative";
  }

  return "neutral";
}

export function toInputNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}
