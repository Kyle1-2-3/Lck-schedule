# LCK Global — LCK + 국제대회(MSI·Worlds) 커버 설계

작성일: 2026-06-16

## 배경 / 문제

`lck-global-schedule` 사이트는 lolesports의 **LCK 리그 피드만** 가져온다. 2026-06-16 기준:

- LCK 스플릿2 2026(Road to MSI 포함)이 **2026-06-14에 종료**, 피드의 모든 경기가 `completed`. 피드 마지막 달이 2026-06이고 `newer: None` → 다음 LCK(스플릿3, 2026-07-19 시작)는 아직 피드에 없음 → "다음 달" 버튼이 비활성화돼 넘어갈 수 없다.
- **MSI 2026 (2026-06-27 ~ 2026-07-12)** 는 LCK 리그가 아니라 **별도 국제 리그**(`leagueId 98767991325878492`)다. LCK 피드에 MSI 경기가 아예 없어 현재 구조로는 화살표를 넘겨도 MSI를 볼 수 없다.
- 대진표의 "진행 중 없으면 최신" 로직은 이미 있으나, LCK 소스만 보므로 MSI가 시작돼도 MSI 대진표는 뜨지 않는다.

## 결정 사항 (브레인스토밍 합의)

- **커버 범위:** LCK + 국제대회 전체 (MSI + Worlds). LCK 팀이 나가는 모든 국제대회를 자동 커버.
- **국제대회 경기 범위:** 대회 전경기 (타 지역 팀 경기 포함).
- **대진표 소스:** A안 — 하이브리드. 진행 중 LCK 녹아웃은 lolesports 라이브, 그 외(완료 대회 및 MSI/Worlds)는 Leaguepedia 정식 트리.

## 리그 ID (확인됨)

| slug | leagueId | label |
|---|---|---|
| lck | 98767991310872058 | LCK |
| msi | 98767991325878492 | MSI |
| worlds | 98767975604431411 | Worlds |

## 아키텍처

Worker가 3개 리그를 lolesports에서 가져와 **일정을 병합**하고, **대진표는 "진행 중 우선, 없으면 최신" 대회**를 3개 리그 통틀어 선택해 서빙한다. 브라우저는 기존처럼 same-origin(`/api/schedule`, `/api/bracket`)만 호출.

## 컴포넌트

### 1. 리그 설정 (`src/worker.js`)

```js
const LEAGUES = [
  { slug: "lck",    id: "98767991310872058", label: "LCK" },
  { slug: "msi",    id: "98767991325878492", label: "MSI" },
  { slug: "worlds", id: "98767975604431411", label: "Worlds" },
];
```

기존 `LCK_LEAGUE_ID` 사용처를 이 설정 기반으로 일반화.

### 2. 일정 (`/api/schedule`)

- 각 리그별로 일정을 가져온다(`fetchScheduleEvents`를 leagueId 파라미터화해 재사용). 각 이벤트에 `league`(slug)와 `leagueLabel`을 태그.
- 전부 병합 → matchId 기준 dedupe → `startTime` 오름차순 정렬.
- **best-effort:** 한 리그 fetch가 실패해도 나머지 리그 결과는 유지한다. 단 LCK가 실패하면 전체 에러로 본다(주 데이터).
- **스테이지 태그(RTM/PO 등)는 LCK에만 유지**(현행 `annotateStages` 그대로 LCK 현재 대회 대상). MSI/Worlds는 자체 blockName(Play-In, Bracket 등)이 이미 명확하므로 추가 태깅 없이 blockName + 리그 배지로 구분.
- `normalizeEvent` 출력에 `league`, `leagueLabel` 필드 추가.

### 3. 일정 UI (`public/schedule.js`, `public/app.js`, `public/styles.css`)

- 각 경기 카드에 작은 **리그 배지(LCK / MSI / Worlds)** 추가. 스테이지 라벨 영역(`match-card__stage`) 근처에 표시해 섞인 달도 한눈에 구분.
- **월 이동 범위 확장:** `monthRange`가 데이터 범위만 반환하던 것을, 앱에서 **데이터 범위 ∪ [오늘−1달, 오늘+1달]** 로 확장해 clamp. 빈 달은 기존 `renderSchedule`의 "이 달엔 경기 없어요" 표시 그대로. → 현재 달 ±1은 데이터가 없어도 항상 화살표 이동 가능, MSI 데이터가 들어오면 7월이 자연히 범위에 포함됨.

### 4. 대진표 (`/api/bracket`) — A안 하이브리드

대상 대회를 3개 리그 통틀어 선택:

1. **진행 중 대회 있음** (`startDate <= 오늘 <= endDate`):
   - LCK이고 lol 피드에 녹아웃 매치가 있으면 → **lolesports 라이브 트리**(현행 `getCurrentBracketFromLol`, 리그 인지하도록 일반화).
   - 그 외(MSI/Worlds 진행 중, 또는 lol 녹아웃 없음) → 해당 대회의 **Leaguepedia 정식 트리**.
2. **진행 중 대회 없음** → LCK/MSI/Worlds 중 **가장 최근 완료 대진**을 Leaguepedia에서 선택(현행 `getLeaguepediaBracket`을 멀티 페이지 패턴으로 일반화).

Leaguepedia OverviewPage 패턴(리그별):
- LCK: `LCK/<연도>%`
- MSI: `<연도> Mid-Season Invitational%`  (확인됨: `2025 Mid-Season Invitational`, Tab = `Play-In Day N` / `Bracket Round N` / `Finals`)
- Worlds: `<연도> Season World Championship%` (구현 시 실제 페이지명 재확인)

대진표 헤더의 `(진행 중)` / 대회명 표시는 현행 유지.

> **오늘(2026-06-16) 동작:** 진행 중 대회 없음 → **LCK 스플릿2 플레이오프(최신 완료) 트리** 표시. **2026-06-27 MSI 시작 시 자동으로 MSI 트리로 전환.**

## 데이터 흐름 / 캐시

기존 `withCache` 엣지 캐시 구조 그대로. 동작 변경에 맞춰 `CACHE_BUST` 증가로 엣지 캐시 무효화.

## 에러 처리

- 일정: 리그별 fetch 실패는 best-effort로 흡수(LCK 제외). 기존 캐시 폴백 유지.
- 대진표: 기존 fallback-to-cache 동작 유지. lolesports 일시 오류는 전파(잘못된 완료 대진 캐싱 방지) — 현행 정책 유지.

## 검증 기준

1. `npx wrangler dev` → `GET /api/schedule`에 MSI(2026-06-27+) 이벤트가 존재하고 `league`/`leagueLabel` 태그가 붙는다.
2. 일정 탭에서 **7월로 이동 가능**하고 MSI 경기가 보인다. 현재 달 ±1은 데이터 없어도 화살표 이동 가능.
3. `GET /api/bracket` → 지금은 LCK 스플릿2 PO 트리. 2025 MSI 페이지(`2025 Mid-Season Invitational`)로 임시 쿼리해 국제 정식 트리가 라운드 컬럼으로 렌더되는지 확인.
4. 로컬에서 일정/대진표 탭 전환, 리그 배지 표시, 월 이동 동작 확인. 타임존(밴쿠버/한국) 전환 시 재렌더 정상.

## 범위 밖 (YAGNI)

- 리그별 필터 토글 UI(LCK만 보기 등)는 만들지 않는다 — 요청에 없음.
- MSI/Worlds용 스테이지 약어 태깅은 추가하지 않는다(blockName으로 충분).
