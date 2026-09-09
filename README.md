# AEPICK LUCKY DRAW

팝업스토어용 세로형 키오스크 집게 게임 — 확률형 추첨 + 물리 기반 연출.

기획: [애플리케이션 개발 기획서 v1.2](AEPICK_Popup_Lucky_Draw_Game_Production_Plan_v1.2.docx) (구현 반영본) · [v1.1](AEPICK_Popup_Lucky_Draw_Game_Production_Plan_v1.1.docx) · [v1.0 원본](AEPICK_Popup_Lucky_Draw_Game_Production_Plan_v1.0.docx)
검증: [검증보고서](docs/04_검증보고서.md) · [비주얼 스파이크 결과](docs/05_비주얼_스파이크_결과.md) · [3D 전환 기록](docs/06_3D_전환_기록.md)

## 제1원칙

> 물리 시뮬레이션은 결과를 만들지 않는다. 이미 결정된 결과를 설득력 있게 보여줄 뿐이다.

결과는 운영자가 Start를 승인하는 순간 **서버**가 확률·재고·상한·시간대 쿼터를 검증해 확정한다.
클라이언트는 등급을 수신하지 않고 연출 제어용 `motion`(win / missVariant / effectLevel)만 받는다.

## 구성

| 경로 | 내용 | 상태 |
|---|---|---|
| `packages/shared` | 타입 · 추첨 엔진 · 시간대 페이싱 · 세션 코드 · 설정 검증 · i18n(vi/en/ko) | 완료 |
| `server` | Game API + 재고/지급 상태머신 + 어드민 웹(`/admin`) + 추첨 시뮬레이터 | 완료 |
| `tools/e2e.mjs` | API E2E 검증 스위트 (64 항목) | 완료 |
| `apps/kiosk` | 키오스크 체험 앱 (React + Vite + **Three.js + Rapier 3D**, 3화면·6페이즈) | 완료 |
| `tools/autoplay.mts` | 자동 플레이 하네스 — 결과-연출 일치·물리 안정성 자동 판정 | 완료 |
| `apps/spike-3d` | 비주얼 스파이크 — Three.js로 레퍼런스 룩 도달 가능성 검증 | 완료 |
| `android-shell` | (2차) Kotlin WebView 키오스크 쉘 | 예정 |

## 실행

```bash
npm install
npm run dev:server   # http://localhost:8788 (API + 어드민)
npm run dev:kiosk    # http://localhost:5174 (키오스크, /api는 8788로 프록시)
```

- 어드민: http://localhost:8788/admin — 기본 키 `aepick-admin` (`ADMIN_KEY`), 운영자 PIN `1234` (`OPERATOR_PIN`)
- 단위 테스트: `npm test` (추첨 분포 10만 회 · 페이싱 · 설정 검증 · 코드 생성 — 39 항목)
- API E2E: 서버를 띄운 뒤 `npm run e2e` (64 항목)
- 추첨 시뮬레이터: `npm run sim`
- 자동 플레이 하네스: `npm run autoplay` (기본 500회 · 결과 CSV는 `reports/`)
- 비주얼 스파이크: `npm run dev -w @aepick/spike-3d` → http://localhost:5175
- 키오스크 화면 캡처: `node tools/kiosk-shot.mjs --tier t1` (헤드리스로 전 플로우 조작·캡처)
- 대기화면 영상 렌더: `node tools/render-attract.mjs --seconds 8 --fps 30`

### 자동 플레이 하네스 (§15.1)

실제 게임 엔진을 렌더링 없이 가상 클럭(1/60초 고정)으로 돌려 §16.2 인수 기준을 자동 판정한다.
서버는 실제로 호출하므로 세션·추첨·지표·결과 조회가 운영 경로와 동일하다. 실시간 대비 약 45배 빠르다.

```bash
npm run autoplay -- --runs 600 --real 40   # 테스트 600 + 실제 세션 40
npm run autoplay -- --mode capsuleOpen     # 특정 연출 모드만
npm run autoplay -- --runs 60 --fault 50   # 하네스 자기 검사 (결함 주입)
```

판정 항목: 결과-연출 불일치 · 화면 이탈 · 폭발적 튐 · NaN · 영구 진동 · 구슬 누수 ·
등급×연출 모드 커버리지 매트릭스 · 조준 위치 분포.

`--fault N`은 N%의 회차에서 엔진에 넘기는 `win` 값을 뒤집어, 하네스가 불일치를 실제로
검출하는지 확인한다. **통과만 하는 검증 도구는 아무것도 보증하지 못한다.**

### 키오스크 URL 파라미터

| 파라미터 | 용도 |
|---|---|
| `?debug=1` | 디버그 HUD (§15.3) — 페이즈·fps·시드·연출 계약·테스트 여부 |
| `?noTimeout=1` | 무입력 타임아웃·결과 자동 복귀 비활성 (자동 테스트용) |
| `?reveal=grabMiss` / `?reveal=capsuleOpen` | §4.3 A/B안 강제 지정 (서버 설정 무시) |

화면 구성: 상단 1080×1344 3D 필드 + 하단 1080×576 조작부(좌·우 버튼 + 하강 버튼).
대기화면은 `public/assets/attract.mp4` 프리렌더 루프를 쓴다.

운영자 진입: 좌상단 숨김 핫스팟 **2초 롱프레스** → PIN(`1234`) → 1회 플레이 승인 / 테스트 세션.
테스트 세션 패널에서 등급 강제 지정과 A/B안 런타임 전환이 가능하다.

## 추첨 시뮬레이터

행사 오픈 전 확률·재고·페이싱 값을 확정하는 근거 자료를 만든다. (기획서 §15.2)

```bash
npm run sim -- --visitors 900 --iterations 200 --t1 3 --t2 10 --t3 30 --t4 120 --t5 300
npm run sim -- --pacing-tiers t1,t2,t3,t4,t5   # 페이싱 대상 비교
npm run sim -- --no-pacing                     # 페이싱 미적용 대조
npm run sim -- --renormalize                   # 소진분 비례 재정규화 정책
```

출력: 10만 회 분포 검증(4σ 판정) · 등급별 소진 시점 · **시간대별 당첨률 곡선**.

## 핵심 설계

### 두 계층 상태머신 (기획서 §11, 부록 A·B)

| | Layer 1 — 화면 상태 | Layer 2 — 세션 상태 |
|---|---|---|
| 소유 | 클라이언트 (휘발성) | 서버 / DB (영속) |
| 값 | WAITING → … → RESULT | CREATED → DRAWN → PLAYED → PENDING_CLAIM → CLAIMED |
| 전이 | 입력·타이머·애니메이션 | `sessionService.ts`의 API 호출만 |

화면이 RESULT에서 WAITING으로 복귀해도 세션은 PENDING_CLAIM에 남는다.
이 분리가 **결과화면 자동 복귀 + 지급 큐 비동기 처리**를 성립시킨다.

### 물리와 결과의 관계 (§7.1)

`apps/kiosk/src/game/clawGame.ts`가 물리(**Rapier 3D**)를 소유한다. 구슬 더미의 밀림·회전·연쇄
충돌은 Rigidbody로 계산하되, **대상 구슬의 획득 여부는 서버가 내려준 `motion.win`에 맞춰
구형 조인트(spherical joint)를 연결·해제**해 확정한다. 물리 우연으로 결과가 바뀌는 경로가 없다.

집게 이동은 **1축(X)** 이다 — 물리 차원과 조작 축은 별개 결정이다. 구슬 더미만 3D로 쌓인다.

- 물리 스텝은 1/60초 고정 — 프레임 변동이 결과에 영향을 주지 않는다.
- 격리 안전망: 구슬이 박스를 벗어나면 위치를 되돌린다. §16.2를 확률이 아니라 구조로 보장한다.
- 구슬 배치·연출 랜덤화는 서버가 준 `physicsSeed`로 재현 가능하다.
- `ClawGame.verifyOutcome()`이 매 플레이 종료 시 연출-결과 일치를 자체 판정하고,
  불일치면 `REVEAL_MISMATCH` 오류를 서버로 보고한다 (§16.2).

클라이언트는 등급·경품명·코드를 세션 생성 시점에 받지 않는다. 연출에 필요한
`motion`(win / missVariant / effectLevel)만 받고, 결과 상세는 REVEAL 시점에
`resultToken`으로 조회한다.

### 무결성

- 모든 세션 생성은 `idempotencyKey` 필수. 동일 키 재요청은 최초 응답을 그대로 반환한다.
- 재고 예약은 `BEGIN IMMEDIATE` + 조건부 `UPDATE ... WHERE remaining_qty > 0`. 음수 재고 경로가 없다.
- 확률 연산은 전부 milli-percent 정수(0~100000). 부동소수 드리프트가 없다.
- 확률 합계가 100.000%가 아니면 게시 API가 거부한다.
- 세션 상태 전이는 부록 B 전이표를 위반하면 409로 거부한다.

### 테스트 모드 (§5.6)

`isTest: true`로 생성한 세션은 재고를 예약·차감하지 않고 통계에서 제외되며,
`forceTier`로 등급을 강제 지정해 연출을 점검할 수 있다. 결과화면에 `TEST` 워터마크가 표시된다.

## 환경변수 (server)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | 8788 | API 포트 |
| `ADMIN_KEY` | aepick-admin | 어드민 인증 키 |
| `OPERATOR_PIN` | 1234 | 운영자 PIN |
| `DB_PATH` | `server/data/luckydraw.sqlite` | SQLite 파일 경로 |

## Node 요구사항

Node 22.13+ (내장 `node:sqlite` 사용 — 네이티브 빌드 의존성 없음). 개발·검증은 Node 24.14에서 수행했다.
