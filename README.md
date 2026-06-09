# 월간 주식 수익률 대회

React, Vite, Cloudflare Worker, Cloudflare D1로 만든 월간 주식 수익률 대회 MVP입니다.

## 핵심 기능

- 공개 대시보드, 월간 순위, 지속수익률 순위, 참가 종목표
- 운영 계정 로그인 후 참가자, 기준월, 종목, 매수/매도/월말가, 아이디어 메모 관리
- 관리자 화면에서 추가 운영 계정 생성/수정
- 참가자 수 제한 없음
- 한 참가자당 기준월 1개 종목 제한
- 특정일 매수, 선택적 1회 매도, 결과 확정 스냅샷 저장
- 아이디어 메모 줄바꿈 보존, URL 자동 링크, 긴 글 접기/펼치기
- 현재가 수동/자동 갱신, 현재가 기준 진행 수익률 표시

## 로컬 시작

```bash
npm install
npm run db:migrate:local
npm run account:sql -- admin "change-this-password" "관리자"
npm run account:sql -- operator "change-this-password-too" "운영자"
```

위 두 `account:sql` 명령이 출력한 SQL을 각각 D1에 적용합니다.

```bash
npx wrangler d1 execute stock_return_contest --local --command "출력된 SQL"
npm run dev
```

## 배포 전 설정

1. Cloudflare D1 데이터베이스를 생성합니다.
2. `wrangler.jsonc`의 `database_id`를 실제 D1 ID로 바꿉니다.
3. 원격 마이그레이션을 적용합니다.
4. 최초 운영 계정 1개의 SQL을 생성해 원격 D1에 적용합니다.
5. `npm run deploy`로 배포합니다.

```bash
npm run db:migrate:remote
```

초기 로그인 후에는 관리자 화면의 `관리자 계정` 메뉴에서 추가 운영 계정을 만들 수 있습니다.

`wrangler.jsonc`에는 한국 장중 기준 평일 09:00-16:45에 15분마다 현재가를 갱신하는 Cron Trigger가 포함되어 있습니다. Cloudflare Cron은 UTC 기준으로 실행되므로 설정값은 `*/15 0-7 * * 1-5`입니다.

## 현재가 수집

- 국내 6자리 종목코드는 Naver Finance 현재가 JSON을 먼저 사용합니다.
- 그 외 종목코드나 Naver 요청 실패 시 Yahoo Finance 차트 API 후보 심볼로 재시도합니다.
- 종목코드가 없는 참가 종목은 `종목코드 없음`으로 저장할 수 있으며, 자동 현재가 수집 대상에서는 제외됩니다.
- 현재가는 `entries`의 `current_price`, `current_price_at`, `current_price_source`, `current_return_percent`에 저장됩니다.
- 현재가와 진행 수익률은 참고값이며, 공식 월간/지속 순위는 기존 확정 스냅샷 값만 사용합니다.
- 관리자 화면을 열어두면 15분마다 보조 자동 갱신을 실행하고, 공개/관리 화면은 1분마다 저장된 시세를 다시 읽어 최신 값을 표시합니다.

## 데이터 규칙

- 매수일은 기준월 안의 날짜여야 합니다.
- 매도일은 매수일 이후이면서 기준월 안의 날짜여야 합니다.
- 매도하지 않은 종목은 월말 종가가 있어야 확정할 수 있습니다.
- 확정 후에는 `final_exit_date`, `final_exit_close`, `final_return_percent`, `finalized_at`이 저장되어 지속 순위의 영구 기록으로 사용됩니다.
