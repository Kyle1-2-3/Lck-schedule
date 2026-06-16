# LCK · Vancouver

밴쿠버 현지 시각로 보는 LCK 경기 일정+ 대진표
네이버 e스포츠 일정의 두 가지 불편(모바일 월 이동 불가, 토너먼트 대진 트리 미표시)을 해결하려고 만든 개인용 사이트.

## 기능
- **일정 탭** — 월별 경기 일정. `‹ 2026년 6월 ›` 직접 만든 월 이동 컨트롤이라 **모바일에서도 확실히 동작**. 모든 시각은 밴쿠버 현지 시각(서머타임 자동 처리). 팀 로고·스코어·BO·라이브/종료/예정 상태 표시.
- **대진표 탭** — 플레이오프 더블 엘리미네이션 **대진 트리**(라운드별 컬럼, 모바일은 가로 스크롤). 진행 중 플레이오프가 없으면 가장 최근 완료 대진을 보여주고, 라이브가 시작되면 자동 전환.
- Meta 커머스 디자인 시스템(흰 캔버스, pill 탭/버튼, 플랫 카드).

## 데이터 소스
| 용도 | 출처 | 비고 |
|---|---|---|
| 경기 일정 | lolesports 비공식 API | 로고·한국어·라이브 상태, CloudFront 캐시 |
| 대진표 | Leaguepedia Cargo API | 진짜 더블엘리 트리, 레이트리밋 → Worker가 30분 캐시 |

두 소스 모두 Cloudflare Worker가 서버측에서 프록시 → 브라우저는 **같은 오리진**만 호출(CORS·API 키 노출 없음).

## 구조
```
public/
  index.html      셸 + 탭
  styles.css      Meta 디자인 시스템
  util.js         밴쿠버 시간 변환 헬퍼
  schedule.js     일정 렌더 + 월 범위
  bracket.js      대진 트리 렌더
  app.js          탭/월 이동/데이터 로딩
src/
  worker.js       정적 서빙 + /api/schedule + /api/bracket
wrangler.toml
```

## 로컬 실행
```bash
npm install          # 또는 npx 사용 시 생략 가능
npx wrangler dev     # http://localhost:8787
```

## 배포 (Cloudflare Workers)
```bash
npx wrangler deploy
```
정적 자산은 `[assets]` 바인딩으로 Worker가 함께 서빙하므로 **배포 한 번**이면 끝.

## API
- `GET /api/schedule` → `{ events:[{startTime,state,blockName,bestOf,teams[]}], updatedAt }`
- `GET /api/bracket` → `{ available, tournament, ongoing, rounds:[{name,order,matches[]}], updatedAt }`
- `GET /api/health`

## 참고
- lolesports/Leaguepedia 모두 비공식 소스라 사양이 바뀔 수 있음. 실패 시 Worker는 캐시된 직전 응답으로 폴백하고, UI는 "다시 시도" 버튼 표시.
