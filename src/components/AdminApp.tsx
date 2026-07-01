import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { getMonthEnd, getMonthStart } from "../../shared/validation";
import type {
  AdminAccount,
  AdminBootstrapResponse,
  ContestMonth,
  EntryPreview,
  HistoricalCloseResponse,
  MonthStatus,
  Participant,
  QuoteCheckResponse,
  StockSearchResult
} from "../../shared/types";
import {
  checkQuote,
  createEntry,
  deleteEntry,
  deleteParticipant,
  finalizeEntry,
  getAdminBootstrap,
  login,
  lookupHistoricalClose,
  logout,
  reconcileMonth,
  refreshQuotes,
  saveAccount,
  saveMonth,
  saveParticipant,
  searchKoreanStocks,
  updateEntry,
  type EntryPayload
} from "../lib/api";
import { formatDateTime, formatMoney, formatPercent, formatStockCode, returnClass, toInputNumber } from "../lib/format";
import AppIcon, { type AppIconName } from "./AppIcon";
import MemoText from "./MemoText";
import ParticipantPicker from "./ParticipantPicker";

type Account = AdminBootstrapResponse["account"];

type AccountDraft = {
  id?: number;
  username: string;
  displayName: string;
  password: string;
};

type ParticipantDraft = {
  id?: number;
  name: string;
  memo: string;
  active: boolean;
};

type MonthDraft = {
  id?: number;
  month: string;
  title: string;
  startDate: string;
  endDate: string;
  status: MonthStatus;
};

type EntryDraft = {
  id?: number;
  monthId: string;
  participantId: string;
  stockName: string;
  stockCode: string;
  stockCodeUnavailable: boolean;
  buyDate: string;
  buyClose: string;
  endClose: string;
  sellDate: string;
  sellClose: string;
  ideaMemo: string;
};

type AdminView = "entries" | "participants" | "months" | "accounts";
type AdminNavIcon = Extract<AppIconName, "entries" | "participants" | "months" | "accounts" | "refresh">;

const currentMonth = new Date().toISOString().slice(0, 7);
const AUTO_QUOTE_REFRESH_MS = 15 * 60 * 1000;
const ADMIN_DATA_SYNC_MS = 60 * 1000;
const AUTO_QUOTE_SCHEDULE_LABEL = "평일 장중 / 15분";

function isKoreanMarketRefreshWindow(date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const minutes = hour * 60 + minute;

  return (
    weekday !== "Sat" &&
    weekday !== "Sun" &&
    Number.isFinite(minutes) &&
    minutes >= 9 * 60 &&
    minutes <= 16 * 60 + 45
  );
}

const adminNavItems: Array<{ id: AdminView; label: string; eyebrow: string; icon: AdminNavIcon }> = [
  { id: "entries", label: "참가 종목", eyebrow: "Entries", icon: "entries" },
  { id: "participants", label: "참가자", eyebrow: "People", icon: "participants" },
  { id: "months", label: "기준월", eyebrow: "Months", icon: "months" },
  { id: "accounts", label: "관리자 계정", eyebrow: "Admins", icon: "accounts" }
];

function formatMonthStatus(status: MonthStatus): string {
  if (status === "draft") {
    return "준비중";
  }

  if (status === "open") {
    return "진행중";
  }

  return "마감";
}

function emptyAccountDraft(): AccountDraft {
  return {
    username: "",
    displayName: "",
    password: ""
  };
}

function emptyParticipantDraft(): ParticipantDraft {
  return {
    name: "",
    memo: "",
    active: true
  };
}

function emptyMonthDraft(): MonthDraft {
  return {
    month: currentMonth,
    title: "",
    startDate: getMonthStart(currentMonth),
    endDate: getMonthEnd(currentMonth),
    status: "open"
  };
}

function emptyEntryDraft(month?: ContestMonth | null): EntryDraft {
  return {
    monthId: month ? String(month.id) : "",
    participantId: "",
    stockName: "",
    stockCode: "",
    stockCodeUnavailable: false,
    buyDate: month?.startDate ?? "",
    buyClose: "",
    endClose: "",
    sellDate: "",
    sellClose: "",
    ideaMemo: ""
  };
}

export default function AdminApp() {
  const [account, setAccount] = useState<Account | null>(null);
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [months, setMonths] = useState<ContestMonth[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [entries, setEntries] = useState<EntryPreview[]>([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [accountDraft, setAccountDraft] = useState(emptyAccountDraft);
  const [participantDraft, setParticipantDraft] = useState(emptyParticipantDraft);
  const [monthDraft, setMonthDraft] = useState(emptyMonthDraft);
  const [entryDraft, setEntryDraft] = useState<EntryDraft>(emptyEntryDraft());
  const [entryParticipantQuery, setEntryParticipantQuery] = useState("");
  const [quoteCheck, setQuoteCheck] = useState<QuoteCheckResponse | null>(null);
  const [historicalCloseCheck, setHistoricalCloseCheck] = useState<HistoricalCloseResponse | null>(null);
  const [exitCloseCheck, setExitCloseCheck] = useState<HistoricalCloseResponse | null>(null);
  const [stockSearchResults, setStockSearchResults] = useState<StockSearchResult[]>([]);
  const [stockSearchMessage, setStockSearchMessage] = useState("");
  const [loginDraft, setLoginDraft] = useState({ username: "", password: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [quoteRefreshing, setQuoteRefreshing] = useState(false);
  const [monthReconciling, setMonthReconciling] = useState(false);
  const [quoteChecking, setQuoteChecking] = useState(false);
  const [historicalCloseChecking, setHistoricalCloseChecking] = useState(false);
  const [exitCloseChecking, setExitCloseChecking] = useState(false);
  const [stockSearching, setStockSearching] = useState(false);
  const [lastDataSyncAt, setLastDataSyncAt] = useState("");
  const [lastQuoteRefreshAt, setLastQuoteRefreshAt] = useState("");
  const [activeView, setActiveView] = useState<AdminView>("entries");

  const selectedMonthObject = useMemo(
    () => months.find((month) => month.month === selectedMonth) ?? null,
    [months, selectedMonth]
  );
  const latestQuoteAt = useMemo(
    () =>
      entries.reduce<string | null>((latest, entry) => {
        if (!entry.currentPriceAt) {
          return latest;
        }

        if (!latest || new Date(entry.currentPriceAt).getTime() > new Date(latest).getTime()) {
          return entry.currentPriceAt;
        }

        return latest;
      }, null),
    [entries]
  );
  const selectedMonthLabel = selectedMonthObject
    ? `${selectedMonthObject.month}${selectedMonthObject.title ? ` · ${selectedMonthObject.title}` : ""}`
    : "기준월 없음";
  const activeParticipantCount = useMemo(
    () => participants.filter((participant) => participant.active).length,
    [participants]
  );
  const editingEntry = useMemo(
    () => entries.find((entry) => entry.id === entryDraft.id) ?? null,
    [entries, entryDraft.id]
  );
  const getPreviewExitLabel = (entry: EntryPreview) => {
    if (entry.exitSource === "sell") {
      return "매도 기준";
    }

    if (entry.exitSource === "month-end") {
      return "월말 기준";
    }

    if (entry.exitSource === "current") {
      return "최근 조회 기준";
    }

    return "기준 종료";
  };

  const loadBootstrap = useCallback(async (month?: string, options?: { silent?: boolean; keepDrafts?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
    }

    try {
      const response = await getAdminBootstrap(month);
      setAccount(response.account);
      setAccounts(response.accounts);
      setMonths(response.months);
      setParticipants(response.participants);
      setEntries(response.entries);
      setSelectedMonth(response.selectedMonth?.month ?? "");
      setLastDataSyncAt(new Date().toISOString());
      if (!options?.keepDrafts) {
        setEntryDraft((current) =>
          current.id ? current : emptyEntryDraft(response.selectedMonth)
        );
      }
      setError("");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "관리 데이터를 불러오지 못했습니다.");
      if (!options?.silent) {
        setAccount(null);
      }
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, []);

  const refreshQuoteEntries = useCallback(
    async (mode: "manual" | "auto" = "manual") => {
      if (quoteRefreshing) {
        return;
      }

      if (mode === "manual") {
        setError("");
      }

      setQuoteRefreshing(true);
      try {
        const response = await refreshQuotes(selectedMonth || undefined);
        const now = new Date().toISOString();
        setEntries(response.entries);
        setLastQuoteRefreshAt(now);
        setLastDataSyncAt(now);
        if (mode === "manual") {
          setMessage(`현재가를 갱신했습니다. 성공 ${response.updated}개, 실패 ${response.failed}개.`);
        }
      } catch (caughtError) {
        if (mode === "manual") {
          setError(caughtError instanceof Error ? caughtError.message : "현재가를 갱신하지 못했습니다.");
        }
      } finally {
        setQuoteRefreshing(false);
      }
    },
    [quoteRefreshing, selectedMonth]
  );

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);

  useEffect(() => {
    if (!account || !selectedMonth) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      void loadBootstrap(selectedMonth, { silent: true, keepDrafts: true });
    }, ADMIN_DATA_SYNC_MS);

    return () => window.clearInterval(intervalId);
  }, [account, loadBootstrap, selectedMonth]);

  useEffect(() => {
    if (!account || !selectedMonth) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      if (isKoreanMarketRefreshWindow()) {
        void refreshQuoteEntries("auto");
      }
    }, AUTO_QUOTE_REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, [account, refreshQuoteEntries, selectedMonth]);

  useEffect(() => {
    if (!selectedMonthObject) {
      return;
    }

    setEntryDraft((current) => ({
      ...current,
      monthId: current.monthId || String(selectedMonthObject.id),
      buyDate: current.buyDate || selectedMonthObject.startDate
    }));
  }, [selectedMonthObject]);

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await login(loginDraft.username, loginDraft.password);
      setMessage("로그인했습니다.");
      await loadBootstrap();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "로그인하지 못했습니다.");
    }
  }

  async function handleLogout() {
    await logout();
    setAccount(null);
    setMessage("로그아웃했습니다.");
  }

  async function handleMonthChange(month: string) {
    setSelectedMonth(month);
    setEntryDraft(emptyEntryDraft(months.find((item) => item.month === month)));
    setEntryParticipantQuery("");
    setQuoteCheck(null);
    setHistoricalCloseCheck(null);
    setExitCloseCheck(null);
    setStockSearchResults([]);
    setStockSearchMessage("");
    await loadBootstrap(month);
  }

  async function handleParticipantSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const response = await saveParticipant(participantDraft);
      setParticipants(response.participants);
      setParticipantDraft(emptyParticipantDraft());
      setMessage("참가자를 저장했습니다.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "참가자를 저장하지 못했습니다.");
    }
  }

  async function handleAccountSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const response = await saveAccount(accountDraft);
      setAccounts(response.accounts);
      if (accountDraft.id && account?.id === accountDraft.id) {
        const current = response.accounts.find((item) => item.id === accountDraft.id);
        if (current) {
          setAccount({
            id: current.id,
            username: current.username,
            displayName: current.displayName
          });
        }
      }
      setAccountDraft(emptyAccountDraft());
      setMessage(accountDraft.id ? "관리자 계정을 수정했습니다." : "관리자 계정을 추가했습니다.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "관리자 계정을 저장하지 못했습니다.");
    }
  }

  async function handleMonthSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const response = await saveMonth(monthDraft);
      setMonths(response.months);
      setSelectedMonth(monthDraft.month);
      setMonthDraft(emptyMonthDraft());
      await loadBootstrap(monthDraft.month);
      setMessage("기준월을 저장했습니다.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "기준월을 저장하지 못했습니다.");
    }
  }

  async function handleMonthReconcile(month: string) {
    if (!month) {
      setError("보정할 기준월을 선택해주세요.");
      return;
    }

    const confirmed = window.confirm(
      `${month} 참가 종목의 월말 종가와 확정 결과를 기준월 마지막 거래일 기준으로 다시 계산할까요?`
    );

    if (!confirmed) {
      return;
    }

    setError("");
    setMonthReconciling(true);

    try {
      const response = await reconcileMonth(month);
      setEntries(response.entries);
      setMessage(
        `${month} 월말 기준을 재계산했습니다. 수정 ${response.updated}개, 유지 ${response.skipped}개, 확인 필요 ${response.failed}개.`
      );
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "월말 종가를 재계산하지 못했습니다.");
    } finally {
      setMonthReconciling(false);
    }
  }

  async function handleEntrySubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const endClose = entryDraft.endClose || (entryDraft.sellDate && entryDraft.sellClose ? entryDraft.sellClose : "");
    const payload: EntryPayload = {
      id: entryDraft.id,
      monthId: Number(entryDraft.monthId),
      participantId: Number(entryDraft.participantId),
      stockName: entryDraft.stockName,
      stockCode: entryDraft.stockCodeUnavailable ? "" : entryDraft.stockCode,
      buyDate: entryDraft.buyDate,
      buyClose: entryDraft.buyClose,
      endClose,
      sellDate: entryDraft.sellDate,
      sellClose: entryDraft.sellClose,
      ideaMemo: entryDraft.ideaMemo
    };

    if (!payload.participantId) {
      setError("참가자를 선택해주세요.");
      return;
    }

    try {
      const response = entryDraft.id ? await updateEntry(payload) : await createEntry(payload);
      setEntries(response.entries);
      setEntryDraft(emptyEntryDraft(selectedMonthObject));
      setEntryParticipantQuery("");
      setQuoteCheck(null);
      setHistoricalCloseCheck(null);
      setExitCloseCheck(null);
      setStockSearchResults([]);
      setStockSearchMessage("");
      setMessage(entryDraft.id ? "참가 종목을 수정했습니다." : "참가 종목을 등록했습니다.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "참가 종목을 저장하지 못했습니다.");
    }
  }

  async function handleFinalize(entry: EntryPreview) {
    setError("");
    try {
      const response = await finalizeEntry(entry.id);
      setEntries(response.entries);
      const finalizedEntry = response.entries.find((item) => item.id === entry.id);
      setMessage(
        finalizedEntry?.finalizedAt
          ? `${entry.participantName}의 결과를 ${finalizedEntry.finalExitDate} 종가 ${formatMoney(
              finalizedEntry.finalExitClose
            )} 기준으로 확정했습니다.`
          : `${entry.participantName}의 결과를 확정했습니다.`
      );
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "결과를 확정하지 못했습니다.");
    }
  }

  async function handleDeleteEntry(entry: EntryPreview) {
    if (entry.finalizedAt) {
      setError("확정된 결과는 기본 삭제 화면에서 삭제할 수 없습니다.");
      return;
    }

    const confirmed = window.confirm(
      `${entry.participantName}의 ${entry.stockName} 참가 종목을 삭제할까요? 삭제하면 이번 기준월 참가 종목 목록에서 제거됩니다.`
    );

    if (!confirmed) {
      return;
    }

    setError("");
    try {
      const response = await deleteEntry(entry.id);
      setEntries(response.entries);
      if (entryDraft.id === entry.id) {
        setEntryDraft(emptyEntryDraft(selectedMonthObject));
        setEntryParticipantQuery("");
        setQuoteCheck(null);
        setHistoricalCloseCheck(null);
        setExitCloseCheck(null);
        setStockSearchResults([]);
        setStockSearchMessage("");
      }
      setMessage(`${entry.participantName}의 참가 종목을 삭제했습니다.`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "참가 종목을 삭제하지 못했습니다.");
    }
  }

  async function handleRefreshQuotes() {
    await refreshQuoteEntries("manual");
  }

  async function handleQuoteCheck() {
    setError("");

    if (entryDraft.stockCodeUnavailable || !entryDraft.stockCode.trim()) {
      setQuoteCheck({
        ok: false,
        stockCode: "",
        price: null,
        priceAt: null,
        symbol: null,
        source: null,
        error: "종목코드 없음"
      });
      return;
    }

    setQuoteChecking(true);
    try {
      const response = await checkQuote(entryDraft.stockCode);
      setQuoteCheck(response);
    } catch (caughtError) {
      setQuoteCheck({
        ok: false,
        stockCode: entryDraft.stockCode,
        price: null,
        priceAt: null,
        symbol: null,
        source: null,
        error: caughtError instanceof Error ? caughtError.message : "시세 조회 실패"
      });
    } finally {
      setQuoteChecking(false);
    }
  }

  async function handleHistoricalCloseLookup() {
    setError("");

    const stockCode = entryDraft.stockCodeUnavailable ? "" : entryDraft.stockCode.trim();
    const date = entryDraft.buyDate;

    if (!stockCode || !date) {
      setHistoricalCloseCheck({
        ok: false,
        stockCode,
        date,
        close: null,
        tradeDate: null,
        symbol: null,
        source: null,
        error: !stockCode ? "종목코드 없음" : "매수일 없음"
      });
      return;
    }

    setHistoricalCloseChecking(true);
    try {
      const response = await lookupHistoricalClose(stockCode, date);
      setHistoricalCloseCheck(response);

      if (response.ok && response.close !== null) {
        setEntryDraft((current) => ({
          ...current,
          buyClose: String(response.close)
        }));
      }
    } catch (caughtError) {
      setHistoricalCloseCheck({
        ok: false,
        stockCode,
        date,
        close: null,
        tradeDate: null,
        symbol: null,
        source: null,
        error: caughtError instanceof Error ? caughtError.message : "매수일 종가 조회 실패"
      });
    } finally {
      setHistoricalCloseChecking(false);
    }
  }

  async function handleExitCloseLookup() {
    setError("");

    const stockCode = entryDraft.stockCodeUnavailable ? "" : entryDraft.stockCode.trim();
    const date = entryDraft.sellDate || selectedMonthObject?.endDate || "";

    if (!stockCode || !date) {
      setExitCloseCheck({
        ok: false,
        stockCode,
        date,
        close: null,
        tradeDate: null,
        symbol: null,
        source: null,
        error: !stockCode ? "종목코드 없음" : "매도일 또는 기준월 종료일 없음"
      });
      return;
    }

    setExitCloseChecking(true);
    try {
      const response = await lookupHistoricalClose(stockCode, date);
      setExitCloseCheck(response);

      if (response.ok && response.close !== null) {
        setEntryDraft((current) => ({
          ...current,
          endClose: String(response.close),
          sellClose: current.sellDate ? String(response.close) : current.sellClose
        }));
      }
    } catch (caughtError) {
      setExitCloseCheck({
        ok: false,
        stockCode,
        date,
        close: null,
        tradeDate: null,
        symbol: null,
        source: null,
        error: caughtError instanceof Error ? caughtError.message : "종료 종가 조회 실패"
      });
    } finally {
      setExitCloseChecking(false);
    }
  }

  async function handleStockSearch() {
    setError("");
    setStockSearchMessage("");
    setStockSearchResults([]);

    const query = entryDraft.stockName.trim() || entryDraft.stockCode.trim();

    if (!query) {
      setStockSearchMessage("종목명이나 6자리 코드를 입력해주세요.");
      return;
    }

    setStockSearching(true);
    try {
      const response = await searchKoreanStocks(query);
      setStockSearchResults(response.results);
      setStockSearchMessage(
        response.results.length === 0
          ? "검색 결과가 없습니다. 종목명을 조금 더 정확히 입력해주세요."
          : `${response.results.length.toLocaleString("ko-KR")}개 종목을 찾았습니다.`
      );
    } catch (caughtError) {
      setStockSearchMessage(caughtError instanceof Error ? caughtError.message : "종목명 검색 실패");
    } finally {
      setStockSearching(false);
    }
  }

  function applyStockSearchResult(result: StockSearchResult) {
    setEntryDraft({
      ...entryDraft,
      stockName: result.name,
      stockCode: result.code,
      stockCodeUnavailable: false
    });
    setQuoteCheck(null);
    setHistoricalCloseCheck(null);
    setExitCloseCheck(null);
    setStockSearchResults([]);
    setStockSearchMessage(`${result.name} · ${result.code}를 입력했습니다.`);
  }

  async function handleDeleteParticipant(participant: Participant) {
    const confirmed = window.confirm(
      `${participant.name} 참가자를 관리 목록에서 삭제할까요? 과거 참가 종목과 확정 결과는 보존됩니다.`
    );

    if (!confirmed) {
      return;
    }

    setError("");
    try {
      const response = await deleteParticipant(participant.id);
      setParticipants(response.participants);
      if (participantDraft.id === participant.id) {
        setParticipantDraft(emptyParticipantDraft());
      }
      if (entryDraft.participantId === String(participant.id)) {
        setEntryDraft({ ...entryDraft, participantId: "" });
        setEntryParticipantQuery("");
      }
      setMessage(`${participant.name} 참가자를 삭제했습니다.`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "참가자를 삭제하지 못했습니다.");
    }
  }

  function editParticipant(participant: Participant) {
    setParticipantDraft({
      id: participant.id,
      name: participant.name,
      memo: participant.memo,
      active: participant.active
    });
  }

  function editAccount(adminAccount: AdminAccount) {
    setAccountDraft({
      id: adminAccount.id,
      username: adminAccount.username,
      displayName: adminAccount.displayName,
      password: ""
    });
  }

  function editMonth(month: ContestMonth) {
    setMonthDraft({
      id: month.id,
      month: month.month,
      title: month.title,
      startDate: month.startDate,
      endDate: month.endDate,
      status: month.status
    });
  }

  function editEntry(entry: EntryPreview) {
    setEntryDraft({
      id: entry.id,
      monthId: String(entry.monthId),
      participantId: String(entry.participantId),
      stockName: entry.stockName,
      stockCode: entry.stockCode,
      stockCodeUnavailable: !entry.stockCode.trim(),
      buyDate: entry.buyDate,
      buyClose: toInputNumber(entry.buyClose),
      endClose: toInputNumber(entry.endClose),
      sellDate: entry.sellDate ?? "",
      sellClose: toInputNumber(entry.sellClose),
      ideaMemo: entry.ideaMemo
    });
    setEntryParticipantQuery(entry.participantName);
    setQuoteCheck(null);
    setHistoricalCloseCheck(null);
    setExitCloseCheck(null);
    setStockSearchResults([]);
    setStockSearchMessage("");
  }

  if (!account) {
    return (
      <div className="app-shell narrow-shell">
        <header className="app-header">
          <div className="brand-row">
            <img src="/contest-mark.svg" alt="" className="brand-mark" />
            <div>
              <p className="eyebrow">Operator Login</p>
              <h1>관리자 로그인</h1>
            </div>
          </div>
          <nav className="top-nav" aria-label="관리 메뉴">
            <a href="/">대회 화면</a>
          </nav>
        </header>
        <main>
          <section className="section-band">
            <form className="form-grid single" onSubmit={handleLogin}>
              <label>
                아이디
                <input
                  value={loginDraft.username}
                  onChange={(event) => setLoginDraft({ ...loginDraft, username: event.target.value })}
                  autoComplete="username"
                />
              </label>
              <label>
                비밀번호
                <input
                  value={loginDraft.password}
                  onChange={(event) => setLoginDraft({ ...loginDraft, password: event.target.value })}
                  type="password"
                  autoComplete="current-password"
                />
              </label>
              <button className="primary-button" type="submit">
                로그인
              </button>
            </form>
            {loading ? <p className="status">세션을 확인하는 중입니다.</p> : null}
            {error ? <p className="alert">{error}</p> : null}
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell public-shell admin-shell">
      <header className="app-header">
        <div className="brand-row">
          <img src="/contest-mark.svg" alt="" className="brand-mark" />
          <div>
            <p className="eyebrow">Contest Admin</p>
            <h1>
              <span className="desktop-admin-title">대회 관리</span>
              <span className="mobile-admin-title">월간 주식 수익률 대회</span>
            </h1>
          </div>
        </div>
        <a className="admin-mobile-contest-link" href="/" aria-label="대회 화면으로 이동">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 19h16" />
            <path d="M7 16V9" />
            <path d="M12 16V5" />
            <path d="M17 16v-4" />
          </svg>
          <span>대회 화면</span>
        </a>
        <div className="admin-topbar header-ranking-topbar" aria-label="관리 상단 상태">
          <div className="admin-topbar-track">
            <span className="admin-topbar-badge">Admin</span>
            <span className="admin-topbar-item">
              <strong>기준월</strong>
              {selectedMonthLabel}
            </span>
            <span className="admin-topbar-item">
              <strong>참가자</strong>
              {activeParticipantCount.toLocaleString("ko-KR")}명
            </span>
            <span className="admin-topbar-item">
              <strong>참가 종목</strong>
              {entries.length.toLocaleString("ko-KR")}개
            </span>
            <span className="admin-topbar-item">
              <strong>자동 갱신</strong>
              평일 장중 / 15분
            </span>
            <span className="admin-topbar-item">
              <strong>마지막 시세</strong>
              {formatDateTime(latestQuoteAt)}
            </span>
          </div>
        </div>
      </header>

      <main>
        <div className="public-layout admin-layout">
          <aside className="side-menu admin-side-menu" aria-label="관리 화면 메뉴">
            <label>
              관리 기준월
              <select value={selectedMonth} onChange={(event) => void handleMonthChange(event.target.value)}>
                {months.map((month) => (
                  <option key={month.id} value={month.month}>
                    {month.month}
                    {month.title ? ` · ${month.title}` : ""}
                  </option>
                ))}
              </select>
            </label>

            <div className="side-menu-list">
              {adminNavItems.map((item) => (
                <button
                  className={`side-menu-item ${activeView === item.id ? "active" : ""}`}
                  type="button"
                  key={item.id}
                  onClick={() => setActiveView(item.id)}
                >
                  <span className="admin-menu-eyebrow">{item.eyebrow}</span>
                  <span className="admin-mobile-nav-icon" aria-hidden="true">
                    <AppIcon name={item.icon} />
                  </span>
                  <span className="admin-menu-label">{item.label}</span>
                </button>
              ))}
              <button
                className="side-menu-item"
                type="button"
                onClick={() => void handleRefreshQuotes()}
                disabled={quoteRefreshing || !selectedMonth}
              >
                <span className="admin-menu-eyebrow">Manual</span>
                <span className="admin-mobile-nav-icon" aria-hidden="true">
                  <AppIcon name="refresh" />
                </span>
                <span className="admin-menu-label">{quoteRefreshing ? "갱신 중" : "시세 갱신"}</span>
              </button>
            </div>

            <div className="quote-auto-status" aria-label="자동 시세 갱신 상태">
              <span>Auto</span>
              <strong>자동 시세 갱신</strong>
              <p>{AUTO_QUOTE_SCHEDULE_LABEL}</p>
              <small>마지막 시세 {formatDateTime(latestQuoteAt)}</small>
              <small>화면 동기화 {formatDateTime(lastDataSyncAt)}</small>
              {lastQuoteRefreshAt ? <small>직접 갱신 {formatDateTime(lastQuoteRefreshAt)}</small> : null}
            </div>

            <div className="admin-side-actions">
              <a className="primary-button side-action-button" href="/">
                대회 화면
              </a>
              <button className="ghost-button side-action-button logout-button" type="button" onClick={handleLogout}>
                로그아웃
              </button>
            </div>

            <p className="side-note">{account.displayName} 계정으로 로그인 중</p>
          </aside>

          <div className="content-layer">
            {message ? <p className="success">{message}</p> : null}
            {error ? <p className="alert">{error}</p> : null}

            {activeView === "accounts" ? (
        <section id="accounts" className="section-band content-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Admin Accounts</p>
              <h2>관리자 계정</h2>
            </div>
            <span className="status-pill">{accounts.length.toLocaleString("ko-KR")}명</span>
          </div>
          <form className="form-grid" onSubmit={handleAccountSubmit} autoComplete="off">
            <label>
              아이디
              <input
                value={accountDraft.username}
                onChange={(event) => setAccountDraft({ ...accountDraft, username: event.target.value })}
                placeholder="new-admin"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label>
              표시 이름
              <input
                value={accountDraft.displayName}
                onChange={(event) => setAccountDraft({ ...accountDraft, displayName: event.target.value })}
                placeholder="관리자"
                autoComplete="off"
              />
            </label>
            <label>
              비밀번호
              <input
                value={accountDraft.password}
                onChange={(event) => setAccountDraft({ ...accountDraft, password: event.target.value })}
                type="password"
                placeholder={accountDraft.id ? "변경할 때만 입력" : "8자 이상"}
                autoComplete="new-password"
              />
            </label>
            <button className="primary-button" type="submit">
              {accountDraft.id ? "계정 수정" : "계정 추가"}
            </button>
            {accountDraft.id ? (
              <button className="ghost-button" type="button" onClick={() => setAccountDraft(emptyAccountDraft())}>
                취소
              </button>
            ) : null}
          </form>
          <div className="table-wrap">
            <table className="compact-table">
              <thead>
                <tr>
                  <th>아이디</th>
                  <th>표시 이름</th>
                  <th>생성일</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((adminAccount) => (
                  <tr key={adminAccount.id}>
                    <td>
                      {adminAccount.username}
                      {account?.id === adminAccount.id ? <span className="current-account-mark">현재</span> : null}
                    </td>
                    <td>{adminAccount.displayName}</td>
                    <td>{formatDateTime(adminAccount.createdAt)}</td>
                    <td>
                      <div className="table-actions">
                        <button className="small-button" type="button" onClick={() => editAccount(adminAccount)}>
                          수정
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mobile-admin-list" aria-label="관리자 계정 모바일 목록">
            {accounts.map((adminAccount) => (
              <article className="mobile-admin-card" key={adminAccount.id}>
                <div className="mobile-admin-card-main">
                  <strong>{adminAccount.username}</strong>
                  {account?.id === adminAccount.id ? <span className="current-account-mark">현재</span> : null}
                </div>
                <p>{adminAccount.displayName}</p>
                <small>생성 {formatDateTime(adminAccount.createdAt)}</small>
                <div className="mobile-admin-actions">
                  <button className="small-button" type="button" onClick={() => editAccount(adminAccount)}>
                    수정
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
            ) : null}

            {activeView === "participants" ? (
        <section id="participants" className="section-band content-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Participants</p>
              <h2>참가자 관리</h2>
            </div>
            <span className="status-pill">한도 없음</span>
          </div>
          <form className="form-grid" onSubmit={handleParticipantSubmit}>
            <label>
              이름
              <input
                value={participantDraft.name}
                onChange={(event) => setParticipantDraft({ ...participantDraft, name: event.target.value })}
              />
            </label>
            <label>
              운영 메모
              <input
                value={participantDraft.memo}
                onChange={(event) => setParticipantDraft({ ...participantDraft, memo: event.target.value })}
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={participantDraft.active}
                onChange={(event) => setParticipantDraft({ ...participantDraft, active: event.target.checked })}
              />
              활성 참가자
            </label>
            <button className="primary-button" type="submit">
              {participantDraft.id ? "참가자 수정" : "참가자 추가"}
            </button>
            {participantDraft.id ? (
              <button className="ghost-button" type="button" onClick={() => setParticipantDraft(emptyParticipantDraft())}>
                취소
              </button>
            ) : null}
          </form>
          <div className="table-wrap">
            <table className="compact-table">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>상태</th>
                  <th>메모</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                {participants.map((participant) => (
                  <tr key={participant.id}>
                    <td>{participant.name}</td>
                    <td>{participant.active ? "활성" : "비활성"}</td>
                    <td>{participant.memo || "-"}</td>
                    <td>
                      <div className="table-actions">
                        <button className="small-button" type="button" onClick={() => editParticipant(participant)}>
                          수정
                        </button>
                        <button
                          className="small-button danger-button"
                          type="button"
                          onClick={() => void handleDeleteParticipant(participant)}
                        >
                          삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mobile-admin-list" aria-label="참가자 모바일 목록">
            {participants.map((participant) => (
              <article className="mobile-admin-card" key={participant.id}>
                <div className="mobile-admin-card-main">
                  <strong>{participant.name}</strong>
                  <span className={`status-pill ${participant.active ? "status-open" : "status-finalized"}`}>
                    {participant.active ? "활성" : "비활성"}
                  </span>
                </div>
                <p>{participant.memo || "메모 없음"}</p>
                <div className="mobile-admin-actions">
                  <button className="small-button" type="button" onClick={() => editParticipant(participant)}>
                    수정
                  </button>
                  <button
                    className="small-button danger-button"
                    type="button"
                    onClick={() => void handleDeleteParticipant(participant)}
                  >
                    삭제
                  </button>
                </div>
              </article>
            ))}
            {participants.length === 0 ? (
              <div className="empty-state compact">
                <h3>등록된 참가자가 없습니다.</h3>
              </div>
            ) : null}
          </div>
        </section>
            ) : null}

            {activeView === "months" ? (
        <section id="months" className="section-band content-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Contest Month</p>
              <h2>기준월 관리</h2>
            </div>
          </div>
          <form className="form-grid" onSubmit={handleMonthSubmit}>
            <label>
              기준월
              <input
                value={monthDraft.month}
                placeholder="2026-06"
                onChange={(event) => {
                  const month = event.target.value;
                  setMonthDraft({
                    ...monthDraft,
                    month,
                    startDate: /^\d{4}-\d{2}$/.test(month) ? getMonthStart(month) : monthDraft.startDate,
                    endDate: /^\d{4}-\d{2}$/.test(month) ? getMonthEnd(month) : monthDraft.endDate
                  });
                }}
              />
            </label>
            <label>
              표시 제목
              <input
                value={monthDraft.title}
                onChange={(event) => setMonthDraft({ ...monthDraft, title: event.target.value })}
              />
            </label>
            <label>
              시작일
              <input
                type="date"
                value={monthDraft.startDate}
                onChange={(event) => setMonthDraft({ ...monthDraft, startDate: event.target.value })}
              />
            </label>
            <label>
              종료일
              <input
                type="date"
                value={monthDraft.endDate}
                onChange={(event) => setMonthDraft({ ...monthDraft, endDate: event.target.value })}
              />
            </label>
            <label>
              상태
              <select
                value={monthDraft.status}
                onChange={(event) => setMonthDraft({ ...monthDraft, status: event.target.value as MonthStatus })}
              >
                <option value="draft">준비중</option>
                <option value="open">진행중</option>
                <option value="finalized">마감</option>
              </select>
            </label>
            <button className="primary-button" type="submit">
              {monthDraft.id ? "기준월 수정" : "기준월 추가"}
            </button>
            {monthDraft.id ? (
              <button className="ghost-button" type="button" onClick={() => setMonthDraft(emptyMonthDraft())}>
                취소
              </button>
            ) : null}
          </form>
          <div className="month-reconcile-card">
            <div>
              <strong>{selectedMonth || "기준월"} 월말 기준 재계산</strong>
              <p>월중 매도/확정 기록은 유지하고, 월말 이후 잘못 확정된 값만 다시 맞춥니다.</p>
            </div>
            <button
              className="ghost-button"
              type="button"
              onClick={() => void handleMonthReconcile(selectedMonth)}
              disabled={!selectedMonth || monthReconciling}
            >
              {monthReconciling ? "재계산 중" : "월말 종가 재계산"}
            </button>
          </div>
          <div className="month-list">
            {months.map((month) => (
              <button className="month-chip" type="button" key={month.id} onClick={() => editMonth(month)}>
                {month.month}
                <span>{formatMonthStatus(month.status)}</span>
              </button>
            ))}
          </div>
        </section>
            ) : null}

            {activeView === "entries" ? (
        <section id="entries" className="section-band content-panel">
          <div className="admin-entry-mobile-intro">
            <span>ADMIN MODE</span>
            <h2>참가 종목 관리</h2>
            <p>참가자의 종목 매수/매도 정보를 관리합니다.</p>
            <button
              className="admin-entry-list-jump"
              type="button"
              onClick={() => document.getElementById("admin-entry-list")?.scrollIntoView({ behavior: "smooth" })}
            >
              <span aria-hidden="true">←</span>
              대회 종목 바로가기
            </button>
          </div>
          <div className="section-heading">
            <div>
              <p className="eyebrow">Entries</p>
              <h2>참가 종목 관리</h2>
            </div>
            <span className="status-pill">매수 1회 · 매도 1회</span>
          </div>
          <form className="entry-editor-form" onSubmit={handleEntrySubmit}>
            <section className="entry-input-group">
              <div className="entry-group-heading">
                <span>1</span>
                <h3>참가자 및 종목</h3>
              </div>
              <div className="entry-identity-grid">
                <div className="entry-identity-column">
                  <ParticipantPicker
                    participants={participants.filter((participant) => participant.active)}
                    value={entryDraft.participantId}
                    query={entryParticipantQuery}
                    onQueryChange={setEntryParticipantQuery}
                    onChange={(participantId) => setEntryDraft({ ...entryDraft, participantId })}
                  />
                  <label>
                    대회 월
                    <select
                      value={entryDraft.monthId}
                      onChange={(event) => setEntryDraft({ ...entryDraft, monthId: event.target.value })}
                    >
                      <option value="">선택</option>
                      {months.map((month) => (
                        <option key={month.id} value={month.id}>
                          {month.month}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="entry-identity-column">
                  <label>
                    종목명
                    <input
                      value={entryDraft.stockName}
                      placeholder="삼성전자, KODEX 200 등"
                      onChange={(event) => {
                        setEntryDraft({ ...entryDraft, stockName: event.target.value });
                        setStockSearchResults([]);
                        setStockSearchMessage("");
                      }}
                    />
                  </label>
                  <div className="stock-code-block">
                    <label>
                      종목코드
                      <input
                        value={entryDraft.stockCode}
                        disabled={entryDraft.stockCodeUnavailable}
                        placeholder={entryDraft.stockCodeUnavailable ? "코드 없음" : "005930, 0193W0, AAPL 등"}
                        onChange={(event) => {
                          setEntryDraft({ ...entryDraft, stockCode: event.target.value });
                          setQuoteCheck(null);
                          setHistoricalCloseCheck(null);
                          setExitCloseCheck(null);
                        }}
                      />
                    </label>
                    <div className="stock-code-actions">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={entryDraft.stockCodeUnavailable}
                          onChange={(event) => {
                            setEntryDraft({
                              ...entryDraft,
                              stockCode: event.target.checked ? "" : entryDraft.stockCode,
                              stockCodeUnavailable: event.target.checked
                            });
                            setQuoteCheck(null);
                            setHistoricalCloseCheck(null);
                            setExitCloseCheck(null);
                          }}
                        />
                        종목코드 없음
                      </label>
                      <button
                        className="small-button"
                        type="button"
                        onClick={() => void handleQuoteCheck()}
                        disabled={quoteChecking}
                      >
                        {quoteChecking ? "확인 중" : "종목 검증"}
                      </button>
                    </div>
                    {quoteCheck ? (
                      <p className={`quote-check-message ${quoteCheck.ok ? "success-text" : "error-text"}`}>
                        {quoteCheck.ok
                          ? `${quoteCheck.symbol ?? quoteCheck.stockCode} · ${formatMoney(quoteCheck.price)} · ${
                              quoteCheck.source ?? "시세 확인"
                            }`
                          : quoteCheck.error === "종목코드 없음"
                            ? "종목코드 없음: 자동 시세 수집에서 제외됩니다."
                            : `조회 실패: ${quoteCheck.error}`}
                      </p>
                    ) : (
                      <p className="quote-check-message muted">저장 전에 현재가 조회 가능 여부를 확인할 수 있습니다.</p>
                    )}
                  </div>
                  <div className="stock-search-panel">
                    <button
                      className="small-button"
                      type="button"
                      onClick={() => void handleStockSearch()}
                      disabled={stockSearching}
                    >
                      {stockSearching ? "검색 중" : "한국 종목 코드 찾기"}
                    </button>
                    <p className="quote-check-message muted">
                      한국 종목명으로 주식/ETF 코드를 찾습니다. 미국 종목은 티커를 직접 입력하세요.
                    </p>
                    {stockSearchMessage ? (
                      <p className="quote-check-message">{stockSearchMessage}</p>
                    ) : null}
                    {stockSearchResults.length > 0 ? (
                      <div className="stock-search-results">
                        {stockSearchResults.map((result) => (
                          <button
                            key={result.code}
                            type="button"
                            onClick={() => applyStockSearchResult(result)}
                          >
                            <strong>{result.name}</strong>
                            <span>{result.code}</span>
                            <em>{result.market}</em>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>

            <section className="entry-input-group">
              <div className="entry-group-heading">
                <span>2</span>
                <h3>매수 정보</h3>
              </div>
              <div className="entry-input-grid compact">
                <label>
                  매수일
                  <input
                    type="date"
                    value={entryDraft.buyDate}
                    onChange={(event) => {
                      setEntryDraft({ ...entryDraft, buyDate: event.target.value });
                      setHistoricalCloseCheck(null);
                    }}
                  />
                </label>
                <div className="historical-close-field">
                  <label>
                    매수가
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={entryDraft.buyClose}
                      onChange={(event) => {
                        setEntryDraft({ ...entryDraft, buyClose: event.target.value });
                        setHistoricalCloseCheck(null);
                      }}
                    />
                  </label>
                  <button
                    className="small-button"
                    type="button"
                    onClick={() => void handleHistoricalCloseLookup()}
                    disabled={historicalCloseChecking}
                  >
                    {historicalCloseChecking ? "조회 중" : "매수일 종가 조회"}
                  </button>
                  {historicalCloseCheck ? (
                    <p className={`quote-check-message ${historicalCloseCheck.ok ? "success-text" : "error-text"}`}>
                      {historicalCloseCheck.ok && historicalCloseCheck.close !== null
                        ? `${historicalCloseCheck.tradeDate ?? historicalCloseCheck.date} 종가 ${formatMoney(
                            historicalCloseCheck.close
                          )} · ${historicalCloseCheck.symbol ?? historicalCloseCheck.stockCode} · ${
                            historicalCloseCheck.source ?? "종가 조회"
                          }`
                        : `조회 실패: ${historicalCloseCheck.error}`}
                    </p>
                  ) : (
                    <p className="quote-check-message muted">종목코드와 매수일로 종가를 자동 입력합니다.</p>
                  )}
                </div>
              </div>
            </section>

            <section className="entry-input-group">
              <div className="entry-group-heading">
                <span>3</span>
                <h3>매도 / 종료 정보</h3>
              </div>
              <div className="entry-input-grid compact">
                <label>
                  매도일
                  <input
                    type="date"
                    value={entryDraft.sellDate}
                    onChange={(event) => {
                      setEntryDraft({ ...entryDraft, sellDate: event.target.value });
                      setExitCloseCheck(null);
                    }}
                  />
                </label>
                <div className="historical-close-field">
                  <label>
                    월말종가
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={entryDraft.endClose}
                      onChange={(event) => {
                        setEntryDraft({ ...entryDraft, endClose: event.target.value });
                        setExitCloseCheck(null);
                      }}
                    />
                  </label>
                  <button
                    className="small-button"
                    type="button"
                    onClick={() => void handleExitCloseLookup()}
                    disabled={exitCloseChecking}
                  >
                    {exitCloseChecking ? "조회 중" : entryDraft.sellDate ? "매도일 종가 조회" : "월말종가 조회"}
                  </button>
                  {exitCloseCheck ? (
                    <p className={`quote-check-message ${exitCloseCheck.ok ? "success-text" : "error-text"}`}>
                      {exitCloseCheck.ok && exitCloseCheck.close !== null
                        ? `${exitCloseCheck.tradeDate ?? exitCloseCheck.date} 종가 ${formatMoney(
                            exitCloseCheck.close
                          )} · ${exitCloseCheck.symbol ?? exitCloseCheck.stockCode} · ${
                            exitCloseCheck.source ?? "종가 조회"
                          }`
                        : `조회 실패: ${exitCloseCheck.error}`}
                    </p>
                  ) : (
                    <p className="quote-check-message muted">매도일이 있으면 매도일, 없으면 기준월 종료일 종가를 조회합니다.</p>
                  )}
                </div>
                <label>
                  매도 확정가
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={entryDraft.sellClose}
                    onChange={(event) => {
                      setEntryDraft({ ...entryDraft, sellClose: event.target.value });
                      setExitCloseCheck(null);
                    }}
                  />
                </label>
              </div>
            </section>

            <section className="entry-input-group">
              <div className="entry-group-heading">
                <span>4</span>
                <h3>메모</h3>
              </div>
              <label>
                관리자 메모
                <textarea
                  value={entryDraft.ideaMemo}
                  onChange={(event) => setEntryDraft({ ...entryDraft, ideaMemo: event.target.value })}
                  rows={5}
                  placeholder="종목을 고른 이유, 이벤트, 참고 링크를 적어주세요."
                />
              </label>
            </section>

            <div className="entry-submit-bar">
              <button
                className="ghost-button"
                type="button"
                onClick={() => {
                  setEntryDraft(emptyEntryDraft(selectedMonthObject));
                  setEntryParticipantQuery("");
                  setQuoteCheck(null);
                  setHistoricalCloseCheck(null);
                  setExitCloseCheck(null);
                }}
              >
                취소
              </button>
              <button
                className="primary-button entry-finalize-button"
                type="button"
                onClick={() => editingEntry && void handleFinalize(editingEntry)}
                disabled={!editingEntry || Boolean(editingEntry.finalizedAt)}
              >
                결과 확정
              </button>
              <button className="primary-button entry-save-button" type="submit">
                <span className="desktop-save-label">{entryDraft.id ? "참가 종목 수정" : "참가 종목 추가"}</span>
                <span className="mobile-save-label">저장</span>
              </button>
            </div>
          </form>

          <div className="entry-list-heading" id="admin-entry-list">
            <h3>등록된 참가 종목</h3>
            <span>{entries.length.toLocaleString("ko-KR")}개</span>
          </div>
          <div className="admin-entry-list">
            {entries.map((entry) => (
              <article className="admin-entry" key={entry.id}>
                <div>
                  <span className="participant-name">{entry.participantName}</span>
                  <h3>
                    {entry.stockName} <small>{formatStockCode(entry.stockCode)}</small>
                  </h3>
                  <p>
                    매수 {entry.buyDate} {formatMoney(entry.buyClose)} · {getPreviewExitLabel(entry)}{" "}
                    {entry.previewExitDate
                      ? `${entry.previewExitDate} ${formatMoney(entry.previewExitClose)}`
                      : "미정"}
                  </p>
                  <p className={returnClass(entry.previewReturnPercent)}>
                    미리보기 {formatPercent(entry.previewReturnPercent)}
                  </p>
                  <div className="admin-quote-strip">
                    <span>현재가 {formatMoney(entry.currentPrice)}</span>
                    <span className={returnClass(entry.currentReturnPercent)}>
                      {formatPercent(entry.currentReturnPercent)}
                    </span>
                    <span>{formatDateTime(entry.currentPriceAt)}</span>
                    {entry.currentPriceSymbol ? <span>{entry.currentPriceSymbol}</span> : null}
                  </div>
                  {entry.currentPriceError ? (
                    <p className="alert inline">시세 오류: {entry.currentPriceError}</p>
                  ) : null}
                  {entry.finalizedAt ? (
                    <p className="success inline">
                      확정 {entry.finalExitDate} {formatMoney(entry.finalExitClose)} ·{" "}
                      {formatPercent(entry.finalReturnPercent)}
                    </p>
                  ) : null}
                </div>
                <MemoText text={entry.ideaMemo} limit={120} />
                <div className="action-row">
                  <button
                    className="small-button"
                    type="button"
                    onClick={() => editEntry(entry)}
                    disabled={Boolean(entry.finalizedAt)}
                  >
                    수정
                  </button>
                  <button
                    className="small-button primary-small"
                    type="button"
                    onClick={() => void handleFinalize(entry)}
                    disabled={Boolean(entry.finalizedAt)}
                  >
                    결과 확정
                  </button>
                  <button
                    className="small-button danger-button"
                    type="button"
                    onClick={() => void handleDeleteEntry(entry)}
                    disabled={Boolean(entry.finalizedAt)}
                  >
                    삭제
                  </button>
                </div>
              </article>
            ))}
            {entries.length === 0 ? (
              <div className="empty-state compact">
                <h3>등록된 참가 종목이 없습니다.</h3>
                <p>기준월, 참가자, 종목 정보를 입력하면 여기에서 관리할 수 있습니다.</p>
              </div>
            ) : null}
          </div>
        </section>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}
