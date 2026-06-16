# LCK + MSI·Worlds 멀티리그 커버 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LCK 전용이던 일정/대진표 사이트를 LCK + 국제대회(MSI·Worlds)까지 커버하도록 확장한다.

**Architecture:** Cloudflare Worker가 3개 리그(LCK·MSI·Worlds)를 lolesports에서 가져와 일정을 병합하고, 대진표는 3개 리그를 통틀어 "진행 중 우선, 없으면 최신" 대회를 자동 선택한다. 진행 중 LCK 녹아웃은 lolesports 라이브 트리, 그 외(완료 대회 및 MSI/Worlds)는 Leaguepedia 정식 트리(A안 하이브리드).

**Tech Stack:** Cloudflare Workers, 바닐라 ES 모듈(브라우저), lolesports 비공식 API, Leaguepedia Cargo API. 단위 테스트는 추가 의존성 없이 node 내장 테스트 러너(`node --test`)로 순수 함수만 검증.

**검증된 상수 (구현 중 추측 금지):**
- 리그 ID: LCK `98767991310872058`, MSI `98767991325878492`, Worlds `98767975604431411`
- Leaguepedia OverviewPage 패턴: LCK `LCK/<연도>%`, MSI `<연도> Mid-Season Invitational%`, Worlds `<연도> Season World Championship%`

---

## File Structure

- `package.json` — `"type": "module"` 추가 (node --test가 ESM `.js`를 import할 수 있도록). wrangler 동작에는 영향 없음.
- `public/util.js` — 순수 헬퍼. `expandRange(range, todayKey)` 추가 (월 범위를 오늘±1로 확장).
- `public/app.js` — `expandRange`로 월 이동 범위 확장 적용.
- `public/schedule.js` — 경기 카드에 리그 배지 렌더.
- `public/styles.css` — 리그 배지 스타일.
- `src/worker.js` — `LEAGUES` 설정, 리그별 일정 fetch·병합(`mergeEvents`), 대진표 대상 선택(`pickTargetTournament`), Leaguepedia 멀티리그 일반화. 순수 함수는 named export로 테스트 가능하게.
- `test/util.test.js` — `expandRange` 테스트.
- `test/worker.test.js` — `mergeEvents`, `normalizeEvent`, `pickTargetTournament` 테스트.

각 파일은 단일 책임 유지: `util.js`=시간/범위 순수 함수, `schedule.js`=일정 렌더, `bracket.js`=대진 렌더(변경 없음), `worker.js`=데이터 프록시/가공.

---

### Task 1: 테스트 인프라 + 월 범위 확장 (`expandRange`)

**Files:**
- Modify: `package.json` (add `"type": "module"`)
- Modify: `public/util.js` (append `expandRange`)
- Modify: `public/app.js:73-74`, `public/app.js:126-128` (use `expandRange`)
- Test: `test/util.test.js` (create)

- [ ] **Step 1: `package.json`에 `"type": "module"` 추가**

`public/private` 줄 아래(혹은 `"version"` 다음)에 추가. 최종 형태:

```json
{
  "name": "lck-vancouver",
  "version": "1.0.0",
  "description": "밴쿠버 시간 기준 LCK 일정 + 플레이오프 대진표",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "node --test"
  },
  "devDependencies": {
    "wrangler": "^4"
  }
}
```

- [ ] **Step 2: 실패하는 테스트 작성** — `test/util.test.js`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { expandRange } from "../public/util.js";

test("expandRange widens to today ±1 when data is narrower", () => {
  const r = expandRange({ min: "2026-06", max: "2026-06" }, "2026-06");
  assert.equal(r.min, "2026-05");
  assert.equal(r.max, "2026-07");
});

test("expandRange keeps wider data bounds", () => {
  const r = expandRange({ min: "2026-01", max: "2026-12" }, "2026-06");
  assert.equal(r.min, "2026-01");
  assert.equal(r.max, "2026-12");
});

test("expandRange handles year boundaries", () => {
  const r = expandRange({ min: "2026-12", max: "2026-12" }, "2026-12");
  assert.equal(r.min, "2026-11");
  assert.equal(r.max, "2027-01");
});

test("expandRange tolerates empty/undefined range", () => {
  const r = expandRange(null, "2026-06");
  assert.equal(r.min, "2026-05");
  assert.equal(r.max, "2026-07");
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `node --test test/util.test.js`
Expected: FAIL — `expandRange is not a function` (또는 import 에러).

- [ ] **Step 4: `expandRange` 구현** — `public/util.js` 맨 끝에 추가

```js
// Widen a {min,max} "YYYY-MM" range so the current month and its immediate
// neighbors are always reachable with the arrows, even when the data has no
// matches there yet (e.g. between splits, before the next event is scheduled).
export function expandRange(range, todayKey) {
  const lo = stepMonth(todayKey, -1);
  const hi = stepMonth(todayKey, 1);
  const min = range && range.min && range.min < lo ? range.min : lo;
  const max = range && range.max && range.max > hi ? range.max : hi;
  return { min, max };
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `node --test test/util.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: `app.js`에서 `expandRange` 적용**

`public/app.js:3`의 import에 `expandRange` 추가:

```js
import { todayMonthKey, stepMonth, clampMonth, fmtMonthLabel, getTZ, setTZ, expandRange } from "./util.js";
```

`public/app.js:73-74` (loadSchedule 내부), 기존:
```js
    store.range = monthRange(store.events);
    store.month = clampMonth(todayMonthKey(), store.range.min, store.range.max);
```
변경 후:
```js
    store.range = expandRange(monthRange(store.events), todayMonthKey());
    store.month = clampMonth(todayMonthKey(), store.range.min, store.range.max);
```

`public/app.js:126-128` (onTZChange 내부), 기존:
```js
  if (store.events) {
    store.range = monthRange(store.events);
    store.month = clampMonth(store.month, store.range.min, store.range.max);
```
변경 후:
```js
  if (store.events) {
    store.range = expandRange(monthRange(store.events), todayMonthKey());
    store.month = clampMonth(store.month, store.range.min, store.range.max);
```

- [ ] **Step 7: 커밋**

```bash
git add package.json public/util.js public/app.js test/util.test.js
git commit -m "feat: 월 이동 범위를 오늘±1로 확장 (expandRange) + node --test 도입"
```

---

### Task 2: 리그 설정 + 리그 태깅 + 이벤트 병합 (worker 순수 로직)

**Files:**
- Modify: `src/worker.js` (LEAGUES 설정, `normalizeEvent` 시그니처, `mergeEvents` 추가, `fetchScheduleEvents` 파라미터화)
- Test: `test/worker.test.js` (create)

- [ ] **Step 1: 실패하는 테스트 작성** — `test/worker.test.js`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeEvent, mergeEvents } from "../src/worker.js";

test("normalizeEvent tags league and normalizes http->https", () => {
  const ev = {
    startTime: "2026-06-27T08:00:00Z",
    state: "unstarted",
    blockName: "Play-In",
    match: {
      id: "m1",
      strategy: { count: 3 },
      teams: [
        { code: "T1", name: "T1", image: "http://x.png", result: { gameWins: 0, outcome: null } },
        { code: "GEN", name: "Gen.G", image: "http://y.png", result: { gameWins: 0, outcome: null } },
      ],
    },
  };
  const out = normalizeEvent(ev, { slug: "msi", label: "MSI" });
  assert.equal(out.league, "msi");
  assert.equal(out.leagueLabel, "MSI");
  assert.equal(out.bestOf, 3);
  assert.equal(out.teams[0].image, "https://x.png");
});

test("mergeEvents dedupes by id and sorts by startTime", () => {
  const lck = [{ id: "1", startTime: "2026-06-14T00:00:00Z", league: "lck", blockName: "" }];
  const msi = [
    { id: "1", startTime: "2026-06-14T00:00:00Z", league: "lck", blockName: "" }, // dup id
    { id: "2", startTime: "2026-06-27T00:00:00Z", league: "msi", blockName: "" },
  ];
  const out = mergeEvents([lck, msi]);
  assert.equal(out.length, 2);
  assert.equal(out[0].id, "1");
  assert.equal(out[1].id, "2");
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test test/worker.test.js`
Expected: FAIL — `normalizeEvent`/`mergeEvents` not exported (import 에러).

- [ ] **Step 3: `LEAGUES` 설정 추가 + `LCK_LEAGUE_ID` 대체**

`src/worker.js:9`의 `const LCK_LEAGUE_ID = "98767991310872058";` 를 다음으로 교체:

```js
const LEAGUES = [
  { slug: "lck", id: "98767991310872058", label: "LCK" },
  { slug: "msi", id: "98767991325878492", label: "MSI" },
  { slug: "worlds", id: "98767975604431411", label: "Worlds" },
];
const LCK_LEAGUE = LEAGUES[0];
```

- [ ] **Step 4: `normalizeEvent`를 league 인지 + export로 변경**

`src/worker.js`의 `function normalizeEvent(ev) { ... }` 를 다음으로 교체:

```js
export function normalizeEvent(ev, league) {
  const m = ev.match || {};
  const teams = (m.teams || []).map((t) => ({
    code: t.code || "TBD",
    name: t.name || "TBD",
    image: (t.image || "").replace(/^http:/, "https:"),
    gameWins: t.result?.gameWins ?? null,
    outcome: t.result?.outcome ?? null, // "win" | "loss" | null
  }));
  return {
    id: m.id || null,
    startTime: ev.startTime,
    state: ev.state, // unstarted | inProgress | completed
    blockName: ev.blockName || "",
    bestOf: m.strategy?.count ?? null,
    league: league ? league.slug : "",
    leagueLabel: league ? league.label : "",
    teams,
  };
}
```

- [ ] **Step 5: `mergeEvents` 추가 (export)**

`src/worker.js`의 `normalizeEvent` 바로 아래에 추가:

```js
// Merge per-league event arrays: dedupe by match id (fall back to a composite
// key for TBD matches with no id), then sort ascending by start time.
export function mergeEvents(arrays) {
  const seen = new Set();
  const out = [];
  for (const arr of arrays) {
    for (const ev of arr || []) {
      const id = ev.id || `${ev.startTime}-${ev.league}-${ev.blockName}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(ev);
    }
  }
  out.sort((a, b) => a.startTime.localeCompare(b.startTime));
  return out;
}
```

- [ ] **Step 6: `fetchScheduleEvents`를 리그 파라미터화**

기존 `async function fetchScheduleEvents() { ... }` 를 다음으로 교체 (leagueId 하드코딩 제거, league 태깅 추가):

```js
async function fetchScheduleEvents(league) {
  // The default page is the latest ~80 events; walk a few "older" pages back so
  // the month navigator has recent history + upcoming games to browse.
  const seen = new Set();
  const events = [];
  let token = null;

  for (let i = 0; i < 4; i++) {
    const q = `getSchedule?hl=ko-KR&leagueId=${league.id}` +
      (token ? `&pageToken=${encodeURIComponent(token)}` : "");
    const data = await lolFetch(q);
    const sched = data?.data?.schedule;
    const page = sched?.events || [];
    for (const ev of page) {
      const id = ev?.match?.id || `${ev.startTime}-${ev.blockName}`;
      if (seen.has(id)) continue;
      seen.add(id);
      events.push(normalizeEvent(ev, league));
    }
    token = sched?.pages?.older || null;
    if (!token) break;
  }
  return events;
}
```

- [ ] **Step 7: `getLckTournaments`의 leagueId 참조 수정**

`src/worker.js`의 `getLckTournaments` 내부 `leagueId=${LCK_LEAGUE_ID}` 를 `leagueId=${LCK_LEAGUE.id}` 로 변경.

- [ ] **Step 8: 테스트 통과 확인**

Run: `node --test test/worker.test.js`
Expected: PASS (2 tests).

> 참고: 이 시점에 `getSchedule`/`getCurrentBracketFromLol`은 아직 인자 없는 옛 `fetchScheduleEvents()`를 호출하므로 런타임이 깨진 상태다. Task 3에서 즉시 고친다. (단위 테스트는 통과하며, 커밋은 Task 3 끝에서 함께 한다.)

---

### Task 3: 멀티리그 일정 병합 (`getSchedule`)

**Files:**
- Modify: `src/worker.js` (`getSchedule`)

- [ ] **Step 1: `getSchedule`를 멀티리그 병합으로 교체**

기존 `getSchedule`:
```js
async function getSchedule(ctx) {
  const events = await fetchScheduleEvents();
  await annotateStages(events);
  await applyLightLogos(events, ctx);
  events.sort((a, b) => a.startTime.localeCompare(b.startTime));
  return { events };
}
```
변경 후:
```js
async function getSchedule(ctx) {
  // Fetch every covered league in parallel. LCK (index 0) is the primary feed:
  // if it fails, surface the error. MSI/Worlds are best-effort add-ons.
  const results = await Promise.allSettled(LEAGUES.map((lg) => fetchScheduleEvents(lg)));
  if (results[0].status === "rejected") throw results[0].reason;
  const arrays = results.map((r) => (r.status === "fulfilled" ? r.value : []));

  const events = mergeEvents(arrays);
  await annotateStages(events);          // LCK-only stage tags (RTM/PO/…)
  await applyLightLogos(events, ctx);
  return { events };
}
```

> `mergeEvents`가 이미 정렬하므로 뒤의 `events.sort(...)`는 제거됨. `annotateStages`는 LCK 현재 대회 매치에만 `ev.stage`를 붙이고(`inRange`로 타 리그/타 기간 제외), MSI/Worlds 이벤트는 그대로 둔다 — 변경 불필요.

- [ ] **Step 2: 기존 단위 테스트 회귀 확인**

Run: `node --test`
Expected: PASS (Task 1+2 합쳐 6 tests).

- [ ] **Step 3: `wrangler dev`로 일정 통합 확인**

Run (백그라운드로 dev 서버 띄우고 curl):
```bash
npx wrangler dev --port 8787 &
sleep 6
curl -s http://localhost:8787/api/schedule | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const j=JSON.parse(s); const evs=j.events||[];
  const byLeague={}; for(const e of evs){byLeague[e.league]=(byLeague[e.league]||0)+1;}
  console.log('league counts:', byLeague);
  const msi=evs.filter(e=>e.league==='msi');
  console.log('msi sample:', msi.slice(0,2).map(e=>[e.startTime,e.blockName,e.leagueLabel]));
});"
kill %1 2>/dev/null
```
Expected: `league counts`에 `lck`와 `msi`가 모두 양수(>0). MSI 샘플의 `leagueLabel`이 `"MSI"`, startTime이 2026-06-27 이후.

- [ ] **Step 4: 커밋** (Task 2의 worker 변경 포함)

```bash
git add src/worker.js test/worker.test.js
git commit -m "feat: 일정에 MSI·Worlds 리그 병합 (리그 태깅 + best-effort fetch)"
```

---

### Task 4: 일정 카드 리그 배지

**Files:**
- Modify: `public/schedule.js:36-58` (`matchCard`)
- Modify: `public/styles.css` (배지 스타일 추가)

- [ ] **Step 1: `matchCard`에 리그 배지 추가**

`public/schedule.js`의 `matchCard` 내부, 기존:
```js
  const teams = el("div", "match-card__teams");
  const stageText = ev.stage ? `${ev.stage} · ${ev.blockName}` : ev.blockName;
  if (stageText) teams.append(el("div", "match-card__stage", stageText));
  for (const t of ev.teams) teams.append(teamRow(t));
```
변경 후 (스테이지 라벨에 리그 칩을 prepend):
```js
  const teams = el("div", "match-card__teams");
  const stageText = ev.stage ? `${ev.stage} · ${ev.blockName}` : ev.blockName;
  if (ev.leagueLabel || stageText) {
    const head = el("div", "match-card__stage");
    if (ev.leagueLabel) {
      head.append(el("span", `league-chip league-chip--${ev.league}`, ev.leagueLabel));
    }
    if (stageText) head.append(el("span", "match-card__stage-text", stageText));
    teams.append(head);
  }
  for (const t of ev.teams) teams.append(teamRow(t));
```

> `el(tag, cls, html)`는 3번째 인자를 `innerHTML`로 넣는다(기존 시그니처). 텍스트만 넣으므로 안전. `ev.leagueLabel`/`ev.league`는 Task 2에서 추가된 필드.

- [ ] **Step 2: 배지 CSS 추가** — `public/styles.css` 맨 끝에 추가

```css
/* 리그 배지 (LCK / MSI / Worlds) — 섞인 달에서 대회 구분 */
.league-chip {
  display: inline-block;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  padding: 3px 6px;
  margin-right: 6px;
  border-radius: 6px;
  color: #fff;
  background: #6b7280;
  vertical-align: middle;
}
.league-chip--lck { background: #1f6feb; }
.league-chip--msi { background: #d4a017; }
.league-chip--worlds { background: #b5122e; }
.match-card__stage-text { vertical-align: middle; }
```

- [ ] **Step 3: 브라우저에서 배지 확인**

Run:
```bash
npx wrangler dev --port 8787 &
sleep 6
echo "브라우저로 http://localhost:8787 열어 → 일정 탭 → 화살표로 6월/7월 이동 → MSI 카드에 노란 'MSI' 칩, LCK 카드에 파란 'LCK' 칩 표시 확인"
```
Expected: 6월엔 LCK 칩, 7월(MSI 시작 후)엔 MSI 칩. 시각적 확인 후 `kill %1`.

- [ ] **Step 4: 커밋**

```bash
git add public/schedule.js public/styles.css
git commit -m "feat: 일정 카드에 리그 배지(LCK/MSI/Worlds) 표시"
```

---

### Task 5: 대진표 멀티리그 대상 선택 (`pickTargetTournament`) + Leaguepedia 일반화

**Files:**
- Modify: `src/worker.js` (`pickTargetTournament` 추가, `getBracket`/`getCurrentBracketFromLol`/`getLeaguepediaBracket`/`bracketRows` 일반화, `CACHE_BUST`)
- Test: `test/worker.test.js` (append)

- [ ] **Step 1: 실패하는 테스트 추가** — `test/worker.test.js` 끝에 append

```js
import { pickTargetTournament } from "../src/worker.js";

const TOURS = [
  { league: "lck", startDate: "2026-03-31", endDate: "2026-06-14" }, // completed
  { league: "msi", startDate: "2026-06-27", endDate: "2026-07-12" }, // upcoming
  { league: "lck", startDate: "2026-07-19", endDate: "2026-10-11" }, // upcoming
];

test("pickTargetTournament: picks latest completed when none ongoing", () => {
  const t = pickTargetTournament(TOURS, "2026-06-16T00:00:00Z");
  assert.equal(t.league, "lck");
  assert.equal(t.endDate, "2026-06-14");
});

test("pickTargetTournament: picks ongoing (latest start) once it begins", () => {
  const t = pickTargetTournament(TOURS, "2026-06-30T00:00:00Z");
  assert.equal(t.league, "msi");
});

test("pickTargetTournament: null when no tournaments", () => {
  assert.equal(pickTargetTournament([], "2026-06-16T00:00:00Z"), null);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test test/worker.test.js`
Expected: FAIL — `pickTargetTournament` not exported.

- [ ] **Step 3: `pickTargetTournament` 추가 (export)**

`src/worker.js`의 `currentTournament` 함수 아래에 추가:

```js
// Across all covered leagues, choose the tournament whose bracket to show:
//   1) an ongoing tournament (latest-starting one if several overlap),
//   2) else the most recently COMPLETED tournament,
//   3) else the soonest upcoming, else null.
export function pickTargetTournament(tournaments, todayISO) {
  const today = todayISO.slice(0, 10);
  const ongoing = tournaments.filter((t) => t.startDate <= today && today <= t.endDate);
  if (ongoing.length) {
    return ongoing.slice().sort((a, b) => a.startDate.localeCompare(b.startDate)).pop();
  }
  const completed = tournaments.filter((t) => t.endDate < today);
  if (completed.length) {
    return completed.slice().sort((a, b) => a.endDate.localeCompare(b.endDate)).pop();
  }
  const upcoming = tournaments
    .filter((t) => t.startDate > today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  return upcoming[0] || null;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test test/worker.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: 모든 리그의 대회 수집 헬퍼 추가**

`src/worker.js`의 `getLckTournaments` 아래에 추가:

```js
// Tournaments across every covered league, tagged with their league (best-effort
// per league — one league failing shouldn't blank the bracket).
async function allTournaments() {
  const out = [];
  for (const lg of LEAGUES) {
    try {
      const data = await lolFetch(`getTournamentsForLeague?hl=ko-KR&leagueId=${lg.id}`);
      for (const t of data?.data?.leagues?.[0]?.tournaments || []) {
        if (t.startDate && t.endDate) out.push({ ...t, league: lg.slug, leagueObj: lg });
      }
    } catch (_) { /* skip this league */ }
  }
  return out;
}
```

- [ ] **Step 6: `getBracket`를 멀티리그 선택으로 교체**

기존 `getBracket`:
```js
async function getBracket(ctx) {
  const live = await getCurrentBracketFromLol(ctx);
  if (live && live.rounds.length) return live;
  return getLeaguepediaBracket();
}
```
변경 후:
```js
async function getBracket(ctx) {
  const nowISO = new Date().toISOString();
  const target = pickTargetTournament(await allTournaments(), nowISO);
  if (!target) return getLeaguepediaBracket(LCK_LEAGUE, new Date().getFullYear());

  const today = nowISO.slice(0, 10);
  const ongoing = target.startDate <= today && today <= target.endDate;

  // Ongoing LCK knockout → lolesports live tree (shows TBD slots + live scores).
  if (ongoing && target.league === "lck") {
    const live = await getCurrentBracketFromLol(ctx, target);
    if (live && live.rounds.length) return live;
  }

  // Everything else (completed, or MSI/Worlds) → Leaguepedia proper tree.
  const year = Number(target.startDate.slice(0, 4));
  return getLeaguepediaBracket(target.leagueObj, year);
}
```

- [ ] **Step 7: `getCurrentBracketFromLol`가 대상 대회를 인자로 받도록 변경**

기존 시그니처/앞부분:
```js
async function getCurrentBracketFromLol(ctx) {
  const cur = currentTournament(await getLckTournaments());
  if (!cur) return null;
  const { knockout } = await stageInfo(cur.id);
  if (!knockout) return null; // current tournament has no knockout stage

  const events = await fetchScheduleEvents();
  await applyLightLogos(events, ctx);
```
변경 후 (대회는 인자로, LCK 일정만 fetch):
```js
async function getCurrentBracketFromLol(ctx, cur) {
  const { knockout } = await stageInfo(cur.id);
  if (!knockout) return null; // current tournament has no knockout stage

  const events = await fetchScheduleEvents(LCK_LEAGUE);
  await applyLightLogos(events, ctx);
```
(이하 본문 동일. `tournament: \`LCK ${cur.startDate.slice(0, 4)} · ${knockout.label}\`` 줄은 그대로 둔다.)

- [ ] **Step 8: `getLeaguepediaBracket`/`bracketRows`를 리그·연도 파라미터화**

`bracketRows`의 OverviewPage 패턴 헬퍼를 추가하고 `bracketRows`를 교체.

기존:
```js
function bracketRows(year) {
  return lpCargo({
    tables: "MatchSchedule",
    fields:
      "OverviewPage,Team1,Team2,Team1Score,Team2Score,Winner,Tab,N_TabInPage,N_MatchInTab,BestOf,DateTime_UTC,MatchId",
    where: `MatchSchedule.OverviewPage LIKE "LCK/${year}%" AND ${BRACKET_TAB_OR}`,
    order_by: "MatchSchedule.N_TabInPage,MatchSchedule.N_MatchInTab",
    limit: "200",
  });
}
```
변경 후:
```js
// Leaguepedia OverviewPage prefixes per league (verified against live Cargo data).
function lpPagePattern(league, year) {
  switch (league.slug) {
    case "msi": return `${year} Mid-Season Invitational%`;
    case "worlds": return `${year} Season World Championship%`;
    default: return `LCK/${year}%`;
  }
}

function bracketRows(league, year) {
  return lpCargo({
    tables: "MatchSchedule",
    fields:
      "OverviewPage,Team1,Team2,Team1Score,Team2Score,Winner,Tab,N_TabInPage,N_MatchInTab,BestOf,DateTime_UTC,MatchId",
    where: `MatchSchedule.OverviewPage LIKE "${lpPagePattern(league, year)}" AND ${BRACKET_TAB_OR}`,
    order_by: "MatchSchedule.N_TabInPage,MatchSchedule.N_MatchInTab",
    limit: "300",
  });
}
```

기존 `getLeaguepediaBracket`:
```js
async function getLeaguepediaBracket() {
  const year = new Date().getFullYear();

  let rows = await bracketRows(year);
  let usedYear = year;
  if (!rows.length) {
    rows = await bracketRows(year - 1);
    usedYear = year - 1;
  }
  if (!rows.length) {
    return { available: false, tournament: `LCK ${year}`, rounds: [] };
  }
```
변경 후 (league/year 인자, year-1 폴백 유지):
```js
async function getLeaguepediaBracket(league, year) {
  let rows = await bracketRows(league, year);
  if (!rows.length) {
    rows = await bracketRows(league, year - 1);
  }
  if (!rows.length) {
    return { available: false, tournament: `${league.label} ${year}`, rounds: [] };
  }
```
(이하 본문 — `latestByPage` 선택, `buildRounds`, `prettyTournament(null, chosenPage)` 반환 — 모두 그대로 둔다. `prettyTournament`는 페이지명 기반이라 MSI/Worlds 페이지명도 자연스럽게 표시됨.)

- [ ] **Step 9: `CACHE_BUST` 증가**

`src/worker.js`의 `const CACHE_BUST = "8";` → `const CACHE_BUST = "9";`

- [ ] **Step 10: 단위 테스트 회귀 + dev 통합 확인**

Run:
```bash
node --test
npx wrangler dev --port 8787 &
sleep 6
echo "=== 현재(진행 중 대회 없음) → 최신 완료 = LCK 스플릿2 PO 트리 ==="
curl -s http://localhost:8787/api/bracket | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const j=JSON.parse(s);
  console.log({available:j.available, tournament:j.tournament, ongoing:j.ongoing, rounds:(j.rounds||[]).length});
});"
kill %1 2>/dev/null
```
Expected: `node --test` 8 tests PASS. `/api/bracket`이 `available:true`, `tournament`에 `LCK … 2026`류 문자열, `rounds > 0` (LCK 스플릿2 플레이오프 트리). `ongoing:false`.

- [ ] **Step 11: 커밋**

```bash
git add src/worker.js test/worker.test.js
git commit -m "feat: 대진표를 LCK/MSI/Worlds 통합 '진행 중 우선·없으면 최신'으로 선택 (A안 하이브리드)"
```

---

### Task 6: 통합 검증 (수동) + MSI 트리 스모크 테스트

**Files:** 없음 (검증 전용)

- [ ] **Step 1: MSI Leaguepedia 트리가 실제로 그려지는지 임시 확인**

`getLeaguepediaBracket`이 MSI 페이지를 제대로 파싱하는지, 2025 MSI로 직접 확인:
```bash
npx wrangler dev --port 8787 &
sleep 6
# bracketRows가 MSI 패턴을 쓰는지 Cargo로 직접 검증 (page/tab 구조 확인)
curl -s -G "https://lol.fandom.com/api.php" \
  --data-urlencode "action=cargoquery" --data-urlencode "format=json" \
  --data-urlencode "tables=MatchSchedule" \
  --data-urlencode "fields=Tab,Team1,Team2,Winner" \
  --data-urlencode 'where=MatchSchedule.OverviewPage LIKE "2025 Mid-Season Invitational%" AND MatchSchedule.Tab LIKE "%Final%"' \
  --data-urlencode "limit=3" \
  -H "User-Agent: LCK-Vancouver/1.0 (personal schedule site; bridge11korea@gmail.com)" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('MSI 2025 finals rows:', (j.cargoquery||[]).length);});"
kill %1 2>/dev/null
```
Expected: `MSI 2025 finals rows`가 1 이상 → MSI 패턴이 유효함을 확인. (현재 시점 2026 MSI는 6/27 시작 전이라 비어 있을 수 있어 2025로 검증.)

- [ ] **Step 2: 브라우저 전체 동작 확인**

```bash
npx wrangler dev --port 8787 &
sleep 6
echo "http://localhost:8787 에서 확인:"
echo " 1) 일정 탭: 화살표로 5월/6월/7월 이동 가능. 빈 달은 '경기 없어요' 표시."
echo " 2) 7월 이동 시 MSI 경기 + 노란 MSI 칩 표시."
echo " 3) 대진표 탭: LCK 스플릿2 PO 트리 렌더 (라운드 컬럼)."
echo " 4) 지역 토글(밴쿠버/한국) 전환 시 시간/월 재렌더 정상."
echo "확인 후 kill %1"
```
Expected: 4개 항목 모두 정상.

- [ ] **Step 3: 배포 (사용자 확인 후)**

> 배포는 push 시 GitHub Actions가 자동 수행한다. main에 머지/푸시하면 Cloudflare로 자동 배포됨. 별도 수동 `wrangler deploy` 불필요.

```bash
git log --oneline -6   # 변경 커밋 확인 후 사용자 승인 받아 push
```

---

## Self-Review

**Spec coverage:**
- 일정 MSI/Worlds 병합 → Task 2,3 ✓
- 현재 달 ±1 화살표 이동 → Task 1 (`expandRange`) ✓
- 리그 배지 구분 → Task 4 ✓
- 대진표 "진행 중 우선·없으면 최신" 멀티리그 → Task 5 (`pickTargetTournament` + `getBracket`) ✓
- MSI/Worlds Leaguepedia 정식 트리 (A안) → Task 5 (`lpPagePattern`, `getLeaguepediaBracket`) ✓
- best-effort per-league fetch → Task 3 (`Promise.allSettled`) ✓
- 범위 밖(리그 필터 UI, MSI 스테이지 약어) 미구현 → 계획에 없음 ✓

**Placeholder scan:** 모든 코드 스텝에 실제 코드/명령 포함. Leaguepedia 패턴·리그 ID는 라이브로 검증된 상수. 미확정 항목 없음.

**Type consistency:** `normalizeEvent(ev, league)`가 추가하는 `league`/`leagueLabel`을 Task 4 UI와 `mergeEvents`의 dedupe 키가 동일하게 사용. `pickTargetTournament`가 반환하는 객체의 `league`(slug)/`leagueObj`/`startDate`/`endDate`를 `getBracket`이 일관되게 사용. `getCurrentBracketFromLol(ctx, cur)`·`getLeaguepediaBracket(league, year)`·`bracketRows(league, year)` 시그니처가 호출부와 일치.
