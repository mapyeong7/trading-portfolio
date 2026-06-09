import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { getMonthEnd, getMonthStart } from "../../shared/validation";
import type {
  AdminAccount,
  AdminBootstrapResponse,
  ContestMonth,
  EntryPreview,
  Participant,
  QuoteCheckResponse
} from "../../shared/types";
import {
  checkQuote,
  createEntry,
  deleteParticipant,
  finalizeEntry,
  getAdminBootstrap,
  login,
  logout,
  refreshQuotes,
  saveAccount,
  saveMonth,
  saveParticipant,
  updateEntry,
  type EntryPayload
} from "../lib/api";
import { formatDateTime, formatMoney, formatPercent, formatStockCode, returnClass, toInputNumber } from "../lib/format";
import MemoText from "./MemoText";

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
  status: string;
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

const adminNavItems: Array<{ id: AdminView; label: string; eyebrow: string }> = [
  { id: "entries", label: "참가 종목", eyebrow: "Entries" },
  { id: "participants", label: "참가자", eyebrow: "People" },
  { id: "months", label: "기준월", eyebrow: "Months" },
  { id: "accounts", label: "관리자 계정", eyebrow: "Admins" }
];

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
  const [loginDraft, setLoginDraft] = useState({ username: "", password: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [quoteRefreshing, setQuoteRefreshing] = useState(false);
  const [quoteChecking, setQuoteChecking] = useState(false);
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

  async function handleEntrySubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const payload: EntryPayload = {
      id: entryDraft.id,
      monthId: Number(entryDraft.monthId),
      participantId: Number(entryDraft.participantId),
      stockName: entryDraft.stockName,
      stockCode: entryDraft.stockCodeUnavailable ? "" : entryDraft.stockCode,
      buyDate: entryDraft.buyDate,
      buyClose: entryDraft.buyClose,
      endClose: entryDraft.endClose,
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
      setMessage(`${entry.participantName}의 결과를 확정했습니다.`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "결과를 확정하지 못했습니다.");
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
            <h1>대회 관리</h1>
          </div>
        </div>
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
                  <span>{item.eyebrow}</span>
                  {item.label}
                </button>
              ))}
              <button
                className="side-menu-item"
                type="button"
                onClick={() => void handleRefreshQuotes()}
                disabled={quoteRefreshing || !selectedMonth}
              >
                <span>Manual</span>
                {quoteRefreshing ? "갱신 중" : "수동 갱신"}
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
                onChange={(event) => setMonthDraft({ ...monthDraft, status: event.target.value })}
              >
                <option value="draft">draft</option>
                <option value="open">open</option>
                <option value="finalized">finalized</option>
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
          <div className="month-list">
            {months.map((month) => (
              <button className="month-chip" type="button" key={month.id} onClick={() => editMonth(month)}>
                {month.month}
                <span>{month.status}</span>
              </button>
            ))}
          </div>
        </section>
            ) : null}

            {activeView === "entries" ? (
        <section id="entries" className="section-band content-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Entries</p>
              <h2>참가 종목 관리</h2>
            </div>
            <span className="status-pill">매수 1회 · 매도 1회</span>
          </div>
          <form className="form-grid wide" onSubmit={handleEntrySubmit}>
            <label>
              기준월
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
            <ParticipantPicker
              participants={participants.filter((participant) => participant.active)}
              value={entryDraft.participantId}
              query={entryParticipantQuery}
              onQueryChange={setEntryParticipantQuery}
              onChange={(participantId) => setEntryDraft({ ...entryDraft, participantId })}
            />
            <label>
              종목명
              <input
                value={entryDraft.stockName}
                onChange={(event) => setEntryDraft({ ...entryDraft, stockName: event.target.value })}
              />
            </label>
            <label>
              종목코드
              <input
                value={entryDraft.stockCode}
                disabled={entryDraft.stockCodeUnavailable}
                placeholder={entryDraft.stockCodeUnavailable ? "코드 없음" : "005930, AAPL, SPY 등"}
                onChange={(event) => {
                  setEntryDraft({ ...entryDraft, stockCode: event.target.value });
                  setQuoteCheck(null);
                }}
              />
            </label>
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
                }}
              />
              종목코드 없음
            </label>
            <div className="quote-check-field">
              <button
                className="small-button"
                type="button"
                onClick={() => void handleQuoteCheck()}
                disabled={quoteChecking}
              >
                {quoteChecking ? "확인 중" : "코드 확인"}
              </button>
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
            <label>
              매수일
              <input
                type="date"
                value={entryDraft.buyDate}
                onChange={(event) => setEntryDraft({ ...entryDraft, buyDate: event.target.value })}
              />
            </label>
            <label>
              매수가
              <input
                type="number"
                min="0"
                step="0.01"
                value={entryDraft.buyClose}
                onChange={(event) => setEntryDraft({ ...entryDraft, buyClose: event.target.value })}
              />
            </label>
            <label>
              월말 종가
              <input
                type="number"
                min="0"
                step="0.01"
                value={entryDraft.endClose}
                onChange={(event) => setEntryDraft({ ...entryDraft, endClose: event.target.value })}
              />
            </label>
            <label>
              매도일
              <input
                type="date"
                value={entryDraft.sellDate}
                onChange={(event) => setEntryDraft({ ...entryDraft, sellDate: event.target.value })}
              />
            </label>
            <label>
              매도 확정가
              <input
                type="number"
                min="0"
                step="0.01"
                value={entryDraft.sellClose}
                onChange={(event) => setEntryDraft({ ...entryDraft, sellClose: event.target.value })}
              />
            </label>
            <label className="textarea-label">
              아이디어 메모
              <textarea
                value={entryDraft.ideaMemo}
                onChange={(event) => setEntryDraft({ ...entryDraft, ideaMemo: event.target.value })}
                rows={5}
                placeholder="종목을 고른 이유, 이벤트, 참고 링크를 적어주세요."
              />
            </label>
            <button className="primary-button" type="submit">
              {entryDraft.id ? "참가 종목 수정" : "참가 종목 추가"}
            </button>
            {entryDraft.id ? (
              <button
                className="ghost-button"
                type="button"
                onClick={() => {
                  setEntryDraft(emptyEntryDraft(selectedMonthObject));
                  setEntryParticipantQuery("");
                  setQuoteCheck(null);
                }}
              >
                취소
              </button>
            ) : null}
          </form>

          <div className="admin-entry-list">
            {entries.map((entry) => (
              <article className="admin-entry" key={entry.id}>
                <div>
                  <span className="participant-name">{entry.participantName}</span>
                  <h3>
                    {entry.stockName} <small>{formatStockCode(entry.stockCode)}</small>
                  </h3>
                  <p>
                    매수 {entry.buyDate} {formatMoney(entry.buyClose)} · 기준 종료{" "}
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

function ParticipantPicker({
  participants,
  value,
  query,
  onQueryChange,
  onChange
}: {
  participants: Participant[];
  value: string;
  query: string;
  onQueryChange: (query: string) => void;
  onChange: (participantId: string) => void;
}) {
  const selectedParticipant = participants.find((participant) => String(participant.id) === value) ?? null;
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  const filteredParticipants = participants
    .filter((participant) => {
      if (!normalizedQuery) {
        return true;
      }

      return [participant.name, participant.memo].some((item) =>
        item.toLocaleLowerCase("ko-KR").includes(normalizedQuery)
      );
    })
    .slice(0, 8);

  function handleQueryChange(nextQuery: string) {
    onQueryChange(nextQuery);

    const exactParticipant = participants.find((participant) => participant.name === nextQuery.trim());
    onChange(exactParticipant ? String(exactParticipant.id) : "");
  }

  function selectParticipant(participant: Participant) {
    onChange(String(participant.id));
    onQueryChange(participant.name);
  }

  return (
    <div className="participant-picker">
      <label>
        참가자
        <input
          type="search"
          value={query}
          placeholder="이름 검색"
          autoComplete="off"
          onChange={(event) => handleQueryChange(event.target.value)}
        />
      </label>
      <div className="participant-choice-list">
        {filteredParticipants.map((participant) => (
          <button
            className={`participant-choice ${selectedParticipant?.id === participant.id ? "active" : ""}`}
            type="button"
            key={participant.id}
            onClick={() => selectParticipant(participant)}
          >
            <span>{participant.name}</span>
            {participant.memo ? <em>{participant.memo}</em> : null}
          </button>
        ))}
        {filteredParticipants.length === 0 ? <p className="picker-empty">검색 결과 없음</p> : null}
      </div>
      {selectedParticipant ? <p className="picker-state">선택됨: {selectedParticipant.name}</p> : null}
    </div>
  );
}
