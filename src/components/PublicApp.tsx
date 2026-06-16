import { useEffect, useMemo, useState } from "react";
import type { EntryPreview, LeaderboardResponse } from "../../shared/types";
import { getEntries, getLeaderboard } from "../lib/api";
import { formatDateTime, formatMoney, formatPercent, formatStockCode, returnClass } from "../lib/format";
import MemoText from "./MemoText";

type PublicView = "dashboard" | "quotes" | "monthly" | "cumulative" | "entries";

const publicNavItems: Array<{ id: PublicView; label: string; eyebrow: string }> = [
  { id: "dashboard", label: "대시보드", eyebrow: "Top 3" },
  { id: "quotes", label: "현재가", eyebrow: "Live" },
  { id: "monthly", label: "월간 순위", eyebrow: "Monthly" },
  { id: "cumulative", label: "지속 순위", eyebrow: "Cumulative" },
  { id: "entries", label: "참가 종목", eyebrow: "Ideas" }
];

const ENTRIES_PER_PAGE = 10;
const PUBLIC_DATA_SYNC_MS = 60 * 1000;

function normalizeFindText(value: string): string {
  return value.trim().toLocaleLowerCase("ko-KR");
}

function includesFindText(values: Array<string | number | null | undefined>, query: string): boolean {
  if (!query) {
    return true;
  }

  return values.some((value) => String(value ?? "").toLocaleLowerCase("ko-KR").includes(query));
}

export default function PublicApp() {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [allEntries, setAllEntries] = useState<EntryPreview[]>([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [activeView, setActiveView] = useState<PublicView>("dashboard");
  const [quoteFind, setQuoteFind] = useState("");
  const [monthlyFind, setMonthlyFind] = useState("");
  const [cumulativeFind, setCumulativeFind] = useState("");
  const [entriesFind, setEntriesFind] = useState("");
  const [entriesPage, setEntriesPage] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([getLeaderboard(selectedMonth || undefined), getEntries()])
      .then(([response, entriesResponse]) => {
        if (!active) {
          return;
        }
        setData(response);
        setAllEntries(entriesResponse.entries);
        setSelectedMonth(response.selectedMonth?.month ?? "");
        setError("");
      })
      .catch((caughtError) => {
        if (active) {
          setError(caughtError instanceof Error ? caughtError.message : "데이터를 불러오지 못했습니다.");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [selectedMonth]);

  useEffect(() => {
    if (!selectedMonth) {
      return undefined;
    }

    let active = true;
    const intervalId = window.setInterval(() => {
      Promise.all([getLeaderboard(selectedMonth), getEntries()])
        .then(([response, entriesResponse]) => {
          if (!active) {
            return;
          }

          setData(response);
          setAllEntries(entriesResponse.entries);
          setSelectedMonth(response.selectedMonth?.month ?? selectedMonth);
          setError("");
        })
        .catch((caughtError) => {
          if (active) {
            setError(caughtError instanceof Error ? caughtError.message : "데이터를 불러오지 못했습니다.");
          }
        });
    }, PUBLIC_DATA_SYNC_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [selectedMonth]);

  useEffect(() => {
    setEntriesPage(1);
  }, [entriesFind]);

  const topMonthly = useMemo(() => data?.monthlyRanking.slice(0, 3) ?? [], [data]);
  const topCumulative = useMemo(() => data?.cumulativeRanking.slice(0, 3) ?? [], [data]);
  const dashboardEntries = useMemo(
    () =>
      [...(data?.entries ?? [])].sort(
        (a, b) =>
          a.participantName.localeCompare(b.participantName, "ko-KR") ||
          a.stockName.localeCompare(b.stockName, "ko-KR")
      ),
    [data]
  );
  const quoteFindQuery = useMemo(() => normalizeFindText(quoteFind), [quoteFind]);
  const monthlyFindQuery = useMemo(() => normalizeFindText(monthlyFind), [monthlyFind]);
  const cumulativeFindQuery = useMemo(() => normalizeFindText(cumulativeFind), [cumulativeFind]);
  const entriesFindQuery = useMemo(() => normalizeFindText(entriesFind), [entriesFind]);
  const quoteEntries = useMemo(
    () =>
      [...(data?.entries ?? [])].sort(
        (a, b) =>
          Number(Boolean(a.finalizedAt)) - Number(Boolean(b.finalizedAt)) ||
          (b.currentReturnPercent ?? -Infinity) - (a.currentReturnPercent ?? -Infinity) ||
          a.participantName.localeCompare(b.participantName, "ko-KR")
      ),
    [data]
  );
  const filteredQuoteEntries = useMemo(
    () =>
      quoteEntries.filter((entry) =>
        includesFindText(
          [
            entry.participantName,
            entry.stockName,
            entry.stockCode,
            entry.currentPrice,
            entry.currentReturnPercent,
            entry.currentPriceSymbol,
            entry.currentPriceSource,
            entry.currentPriceError
          ],
          quoteFindQuery
        )
      ),
    [quoteEntries, quoteFindQuery]
  );
  const filteredMonthlyRanking = useMemo(
    () =>
      data?.monthlyRanking.filter((entry) =>
        includesFindText(
          [
            entry.rank,
            entry.participantName,
            entry.stockName,
            entry.stockCode,
            entry.buyDate,
            entry.rankingExitDate,
            entry.rankingExitClose,
            entry.rankingSource === "final" ? "확정" : "현재가",
            entry.rankingReturnPercent
          ],
          monthlyFindQuery
        )
      ) ?? [],
    [data, monthlyFindQuery]
  );
  const filteredCumulativeRanking = useMemo(
    () =>
      data?.cumulativeRanking.filter((item) =>
        includesFindText(
          [
            item.rank,
            item.participantName,
            item.completedMonths,
            item.assetIndex.toFixed(2),
            item.cumulativeReturnPercent.toFixed(2)
          ],
          cumulativeFindQuery
        )
      ) ?? [],
    [data, cumulativeFindQuery]
  );
  const sortedAllEntries = useMemo(
    () =>
      [...allEntries].sort(
        (a, b) =>
          b.month.localeCompare(a.month) ||
          a.participantName.localeCompare(b.participantName, "ko-KR") ||
          a.stockName.localeCompare(b.stockName, "ko-KR")
      ),
    [allEntries]
  );
  const filteredAllEntries = useMemo(
    () =>
      sortedAllEntries.filter((entry) =>
        includesFindText(
          [
            entry.month,
            entry.monthTitle,
            entry.participantName,
            entry.stockName,
            entry.stockCode,
            entry.buyDate,
            entry.buyClose,
            entry.previewExitDate,
            entry.previewExitClose,
            entry.sellDate,
            entry.sellClose,
            entry.endClose,
            entry.finalReturnPercent,
            entry.currentPrice,
            entry.currentReturnPercent,
            entry.ideaMemo
          ],
          entriesFindQuery
        )
      ),
    [entriesFindQuery, sortedAllEntries]
  );
  const entriesPageCount = Math.max(1, Math.ceil(filteredAllEntries.length / ENTRIES_PER_PAGE));
  const boundedEntriesPage = Math.min(entriesPage, entriesPageCount);
  const visibleEntries = useMemo(
    () =>
      filteredAllEntries.slice(
        (boundedEntriesPage - 1) * ENTRIES_PER_PAGE,
        boundedEntriesPage * ENTRIES_PER_PAGE
      ),
    [boundedEntriesPage, filteredAllEntries]
  );
  const getDashboardReturn = (entry: EntryPreview) =>
    entry.finalReturnPercent ?? entry.currentReturnPercent ?? entry.previewReturnPercent;
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

  return (
    <div className="app-shell public-shell">
      <header className="app-header">
        <div className="brand-row">
          <img src="/contest-mark.svg" alt="" className="brand-mark" />
          <div>
            <p className="eyebrow">Monthly Stock Return Contest</p>
            <h1>월간 주식 수익률 대회</h1>
          </div>
        </div>
        {data?.selectedMonth ? (
          <div className="ranking-topbar header-ranking-topbar" aria-label="상단 랭킹 요약">
            <div className="ranking-ticker-track">
              <div className="ranking-ticker-set">
                <RankingTopbarGroup
                  title="월간 TOP3"
                  variant="monthly"
                  items={topMonthly}
                  valueKey="officialReturnPercent"
                />
                <RankingTopbarGroup
                  title="지속 TOP3"
                  variant="cumulative"
                  items={topCumulative}
                  valueKey="cumulativeReturnPercent"
                />
              </div>
              <div className="ranking-ticker-set" aria-hidden="true">
                <RankingTopbarGroup
                  title="월간 TOP3"
                  variant="monthly"
                  items={topMonthly}
                  valueKey="officialReturnPercent"
                />
                <RankingTopbarGroup
                  title="지속 TOP3"
                  variant="cumulative"
                  items={topCumulative}
                  valueKey="cumulativeReturnPercent"
                />
              </div>
            </div>
          </div>
        ) : null}
      </header>

      <main>
        {loading ? <p className="status">데이터를 불러오는 중입니다.</p> : null}
        {error ? <p className="alert">{error}</p> : null}

        {!loading && data?.months.length === 0 ? (
          <section className="empty-state">
            <h2>아직 기준월이 없습니다.</h2>
            <p>관리 화면에서 기준월과 참가 종목을 먼저 등록해주세요.</p>
            <div className="empty-state-actions">
              <a className="side-menu-admin-link" href="/admin">
                관리자 로그인
              </a>
            </div>
          </section>
        ) : null}

        {data?.selectedMonth ? (
          <div className="public-layout">
            <aside className="side-menu" aria-label="대회 화면 메뉴">
              <label>
                기준월
                <select value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
                  {data.months.map((month) => (
                    <option key={month.id} value={month.month}>
                      {month.month}
                    </option>
                  ))}
                </select>
              </label>

              <div className="side-menu-list">
                {publicNavItems.map((item) => (
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
              </div>

              <a className="side-menu-admin-link" href="/admin">
                관리자 모드
              </a>

              <p className="side-note">미확정 순위는 현재가, 확정 순위는 확정일 종가 기준입니다.</p>
            </aside>

            <div className="content-layer">
              {activeView === "dashboard" ? (
                <section className="section-band content-panel">
                  <div className="section-heading dashboard-entry-heading">
                    <div>
                      <p className="eyebrow">This Month Entries</p>
                      <h2>이번달 참가 종목</h2>
                    </div>
                    <span className="missing-participant-pill">
                      <strong>미참가</strong>
                      <span>
                        {data.missingParticipantNames.length > 0
                          ? data.missingParticipantNames.join(", ")
                          : "없음"}
                      </span>
                    </span>
                  </div>

                  <div className="dashboard-entry-grid">
                    {dashboardEntries.map((entry) => (
                      <article className="dashboard-entry-card" key={entry.id}>
                        <span>{entry.participantName}</span>
                        <strong>{entry.stockName}</strong>
                        <em className={returnClass(getDashboardReturn(entry))}>
                          {formatPercent(getDashboardReturn(entry))}
                        </em>
                      </article>
                    ))}
                    {dashboardEntries.length === 0 ? (
                      <div className="empty-state compact">
                        <h3>이번달 참가 종목이 없습니다.</h3>
                        <p>관리 화면에서 기준월의 참가 종목을 등록하면 여기에 표시됩니다.</p>
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {activeView === "quotes" ? (
                <section className="section-band content-panel">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">Live Price</p>
                      <h2>현재가</h2>
                    </div>
                    <span className="status-pill status-open">장중 자동 갱신</span>
                  </div>
                  <p className="panel-note">
                    현재가는 운영자가 즉시 갱신하거나 배포 환경의 장중 자동 수집으로 저장된 참고값입니다.
                  </p>
                  <SearchField
                    value={quoteFind}
                    onChange={setQuoteFind}
                    placeholder="참가자, 종목, 코드 찾기"
                    resultLabel={`${filteredQuoteEntries.length.toLocaleString("ko-KR")} / ${quoteEntries.length.toLocaleString("ko-KR")}개`}
                  />
                  <div className="quote-list">
                    {filteredQuoteEntries.map((entry) => (
                      <article className="quote-row" key={entry.id}>
                        <div>
                          <span className="participant-name">{entry.participantName}</span>
                          <h3>{entry.stockName}</h3>
                          <p>
                            {formatStockCode(entry.stockCode)}
                            {entry.currentPriceSymbol ? ` · ${entry.currentPriceSymbol}` : ""}
                          </p>
                        </div>
                        <div className="quote-metrics">
                          <div>
                            <span>매수가</span>
                            <strong>{formatMoney(entry.buyClose)}</strong>
                          </div>
                          <div>
                            <span>현재가</span>
                            <strong>{formatMoney(entry.currentPrice)}</strong>
                          </div>
                          <div>
                            <span>현재 수익률</span>
                            <strong className={returnClass(entry.currentReturnPercent)}>
                              {formatPercent(entry.currentReturnPercent)}
                            </strong>
                          </div>
                        </div>
                        <div className="quote-meta">
                          <span>{entry.currentPriceSource ?? "시세 미수집"}</span>
                          <span>{formatDateTime(entry.currentPriceAt)}</span>
                          {entry.currentPriceError ? <em>{entry.currentPriceError}</em> : null}
                          {entry.finalizedAt ? <em>확정 결과는 공식 순위 값으로 보존됨</em> : null}
                        </div>
                      </article>
                    ))}
                    {quoteEntries.length === 0 || filteredQuoteEntries.length === 0 ? (
                      <div className="empty-state compact">
                        <h3>{quoteEntries.length === 0 ? "현재 기준월의 참가 종목이 없습니다." : "검색 결과가 없습니다."}</h3>
                        <p>
                          {quoteEntries.length === 0
                            ? "관리 화면에서 참가 종목을 등록하면 현재가 화면에 표시됩니다."
                            : "다른 참가자, 종목명, 종목코드로 찾아보세요."}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {activeView === "monthly" ? (
            <section className="section-band content-panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Monthly Ranking</p>
                  <h2>월간 순위</h2>
                </div>
              </div>
              <SearchField
                value={monthlyFind}
                onChange={setMonthlyFind}
                placeholder="참가자, 종목, 종목코드, 매도 여부로 찾기"
                resultLabel={`${filteredMonthlyRanking.length.toLocaleString("ko-KR")} / ${data.monthlyRanking.length.toLocaleString("ko-KR")}명`}
              />
              <div className="mobile-rank-list" aria-label="월간 순위 모바일 목록">
                {filteredMonthlyRanking.map((entry) => (
                  <article className="mobile-rank-card" key={entry.id}>
                    <div>
                      <strong>{entry.rank}</strong>
                      <span>{entry.participantName}</span>
                    </div>
                    <em className={returnClass(entry.officialReturnPercent)}>
                      {formatPercent(entry.officialReturnPercent)}
                    </em>
                    <p>{entry.stockName}</p>
                    <small>
                      {entry.rankingSource === "final" ? "확정" : "현재가"} {entry.rankingExitDate ?? "-"} · 매수{" "}
                      {entry.buyDate}
                    </small>
                  </article>
                ))}
                {data.monthlyRanking.length === 0 || filteredMonthlyRanking.length === 0 ? (
                  <div className="empty-state compact">
                    <h3>{data.monthlyRanking.length === 0 ? "현재가가 수집된 월간 순위가 없습니다." : "검색 결과가 없습니다."}</h3>
                  </div>
                ) : null}
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>순위</th>
                      <th>참가자</th>
                      <th>종목</th>
                      <th>매수</th>
                      <th>순위 기준</th>
                      <th>상태</th>
                      <th>수익률</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMonthlyRanking.map((entry) => (
                      <tr key={entry.id}>
                        <td>{entry.rank}</td>
                        <td>{entry.participantName}</td>
                        <td>
                          <strong>{entry.stockName}</strong>
                          <span className="subtext">{formatStockCode(entry.stockCode)}</span>
                        </td>
                        <td>
                          {entry.buyDate}
                          <span className="subtext">{formatMoney(entry.buyClose)}</span>
                        </td>
                        <td>
                          {entry.rankingExitDate ?? "-"}
                          <span className="subtext">{formatMoney(entry.rankingExitClose)}</span>
                        </td>
                        <td>{entry.rankingSource === "final" ? "결과 확정" : "현재가 기준"}</td>
                        <td className={returnClass(entry.officialReturnPercent)}>
                          {formatPercent(entry.officialReturnPercent)}
                        </td>
                      </tr>
                    ))}
                    {data.monthlyRanking.length === 0 || filteredMonthlyRanking.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="empty-cell">
                          {data.monthlyRanking.length === 0
                            ? "현재가가 수집된 월간 순위가 없습니다."
                            : "검색 결과가 없습니다."}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
              ) : null}

              {activeView === "cumulative" ? (
            <section className="section-band content-panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Cumulative Ranking</p>
                  <h2>지속 순위</h2>
                </div>
              </div>
              <SearchField
                value={cumulativeFind}
                onChange={setCumulativeFind}
                placeholder="참가자, 순위, 확정 월수로 찾기"
                resultLabel={`${filteredCumulativeRanking.length.toLocaleString("ko-KR")} / ${data.cumulativeRanking.length.toLocaleString("ko-KR")}명`}
              />
              <div className="mobile-rank-list" aria-label="지속 순위 모바일 목록">
                {filteredCumulativeRanking.map((item) => (
                  <article className="mobile-rank-card" key={item.participantId}>
                    <div>
                      <strong>{item.rank}</strong>
                      <span>{item.participantName}</span>
                    </div>
                    <em className={returnClass(item.cumulativeReturnPercent)}>
                      {formatPercent(item.cumulativeReturnPercent)}
                    </em>
                    <p>누적자산지수 {item.assetIndex.toFixed(2)}</p>
                    <small>확정 {item.completedMonths}개월</small>
                  </article>
                ))}
                {data.cumulativeRanking.length === 0 || filteredCumulativeRanking.length === 0 ? (
                  <div className="empty-state compact">
                    <h3>
                      {data.cumulativeRanking.length === 0
                        ? "아직 지속 순위에 반영된 확정 결과가 없습니다."
                        : "검색 결과가 없습니다."}
                    </h3>
                  </div>
                ) : null}
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>순위</th>
                      <th>참가자</th>
                      <th>확정 월수</th>
                      <th>누적자산지수</th>
                      <th>지속수익률</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCumulativeRanking.map((item) => (
                      <tr key={item.participantId}>
                        <td>{item.rank}</td>
                        <td>{item.participantName}</td>
                        <td>{item.completedMonths}</td>
                        <td>{item.assetIndex.toFixed(2)}</td>
                        <td className={returnClass(item.cumulativeReturnPercent)}>
                          {formatPercent(item.cumulativeReturnPercent)}
                        </td>
                      </tr>
                    ))}
                    {data.cumulativeRanking.length === 0 || filteredCumulativeRanking.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="empty-cell">
                          {data.cumulativeRanking.length === 0
                            ? "아직 지속 순위에 반영된 확정 결과가 없습니다."
                            : "검색 결과가 없습니다."}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
              ) : null}

              {activeView === "entries" ? (
            <section className="section-band content-panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Entries</p>
                  <h2>누적 참가 종목과 아이디어</h2>
                </div>
              </div>
              <SearchField
                value={entriesFind}
                onChange={setEntriesFind}
                placeholder="월, 참가자, 종목, 종목코드, 아이디어 메모로 찾기"
                resultLabel={`${filteredAllEntries.length.toLocaleString("ko-KR")} / ${allEntries.length.toLocaleString("ko-KR")}개`}
              />
              <div className="entries-list">
                {visibleEntries.map((entry) => (
                  <article className="entry-row" key={entry.id}>
                    <div className="entry-main">
                      <span className="month-badge">{entry.month}</span>
                      <span className="participant-name">{entry.participantName}</span>
                      <h3>{entry.stockName}</h3>
                      <p>
                        {formatStockCode(entry.stockCode)} · 매수 {entry.buyDate} {formatMoney(entry.buyClose)}
                      </p>
                      <p>
                        {getPreviewExitLabel(entry)}{" "}
                        {entry.previewExitDate
                          ? `${entry.previewExitDate} ${formatMoney(entry.previewExitClose)}`
                          : "미정"}
                      </p>
                      <p className={returnClass(entry.previewReturnPercent)}>
                        미리보기 수익률 {formatPercent(entry.previewReturnPercent)}
                      </p>
                      {entry.currentPrice !== null ? (
                        <p className={returnClass(entry.currentReturnPercent)}>
                          현재가 {formatMoney(entry.currentPrice)} · 현재 수익률{" "}
                          {formatPercent(entry.currentReturnPercent)}
                        </p>
                      ) : null}
                      {entry.finalizedAt ? (
                        <p className={returnClass(entry.finalReturnPercent)}>
                          공식 확정 {formatPercent(entry.finalReturnPercent)}
                        </p>
                      ) : null}
                    </div>
                    <MemoText text={entry.ideaMemo} />
                  </article>
                ))}
                {allEntries.length === 0 || filteredAllEntries.length === 0 ? (
                  <div className="empty-state compact">
                    <h3>{allEntries.length === 0 ? "등록된 참가 종목이 없습니다." : "검색 결과가 없습니다."}</h3>
                    <p>
                      {allEntries.length === 0
                        ? "관리 화면에서 참가 종목을 추가해주세요."
                        : "다른 참가자, 종목명, 종목코드, 월, 메모 키워드로 찾아보세요."}
                    </p>
                  </div>
                ) : null}
              </div>
              {entriesPageCount > 1 ? (
                <Pagination
                  page={boundedEntriesPage}
                  pageCount={entriesPageCount}
                  totalCount={filteredAllEntries.length}
                  pageSize={ENTRIES_PER_PAGE}
                  onPageChange={setEntriesPage}
                />
              ) : null}
            </section>
              ) : null}
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function Pagination({
  page,
  pageCount,
  totalCount,
  pageSize,
  onPageChange
}: {
  page: number;
  pageCount: number;
  totalCount: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalCount);

  return (
    <div className="pagination-bar">
      <span>
        {start.toLocaleString("ko-KR")}-{end.toLocaleString("ko-KR")} /{" "}
        {totalCount.toLocaleString("ko-KR")}
      </span>
      <div className="pagination-actions">
        <button
          className="small-button"
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
        >
          이전
        </button>
        <strong>
          {page} / {pageCount}
        </strong>
        <button
          className="small-button"
          type="button"
          onClick={() => onPageChange(Math.min(pageCount, page + 1))}
          disabled={page >= pageCount}
        >
          다음
        </button>
      </div>
    </div>
  );
}

function SearchField({
  value,
  onChange,
  placeholder,
  resultLabel
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  resultLabel: string;
}) {
  return (
    <div className="find-bar">
      <label>
        찾기
        <input
          type="search"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <div className="find-meta">
        <span>{resultLabel}</span>
        {value ? (
          <button className="text-button" type="button" onClick={() => onChange("")}>
            지우기
          </button>
        ) : null}
      </div>
    </div>
  );
}

function RankingTopbarGroup({
  title,
  variant,
  items,
  valueKey
}: {
  title: string;
  variant: "monthly" | "cumulative";
  items: Array<{ rank: number; participantName: string; [key: string]: unknown }>;
  valueKey: string;
}) {
  return (
    <div className={`ranking-topbar-group ${variant}`}>
      <span>{title}</span>
      <ol>
        {items.map((item) => (
          <li key={`${title}-${item.rank}-${item.participantName}`}>
            <strong>{item.rank}</strong>
            <span>{item.participantName}</span>
            <em className={returnClass(Number(item[valueKey]))}>{formatPercent(Number(item[valueKey]))}</em>
          </li>
        ))}
      </ol>
      {items.length === 0 ? <p className="muted">확정 결과 없음</p> : null}
    </div>
  );
}
