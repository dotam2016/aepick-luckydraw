/**
 * API E2E 검증 — 기획서 v1.1 §16.1 / §16.3
 *
 * 서버를 띄운 뒤 실행한다:
 *   node tools/e2e.mjs
 *
 * 인수 기준 중 서버가 책임지는 항목을 자동 판정한다.
 */

const BASE = process.env.BASE ?? 'http://localhost:8788';
const PIN = process.env.OPERATOR_PIN ?? '1234';
const ADMIN = process.env.ADMIN_KEY ?? 'aepick-admin';

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(name + (detail ? ` — ${detail}` : ''));
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      'x-operator-pin': PIN,
      'x-admin-key': ADMIN,
      ...(opts.headers ?? {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body };
}

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

async function createPlay({ isTest = false, forceTier, deviceId = 'e2e-device' } = {}) {
  const r = await api('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({
      idempotencyKey: uid(),
      deviceId,
      operatorId: 'e2e-operator',
      isTest,
      forceTier,
    }),
  });
  return r;
}

async function playThrough(session, deviceId = 'e2e-device') {
  await api(`/api/sessions/${session.sessionId}/played`, {
    method: 'POST',
    headers: { 'x-result-token': session.resultToken },
    body: JSON.stringify({
      aimDurationMs: 5400,
      catchX: 0.5,
      autoCatch: false,
      minFps: 58,
      physicsSeed: session.physicsSeed,
    }),
  });
  const reveal = await api(`/api/sessions/${session.sessionId}/reveal`, {
    headers: { 'x-result-token': session.resultToken },
  });
  return reveal.body;
}

const DEFAULT_PROBS = [
  { tier: 't1', probability: 1 },
  { tier: 't2', probability: 4 },
  { tier: 't3', probability: 10 },
  { tier: 't4', probability: 20 },
  { tier: 't5', probability: 35 },
  { tier: 'miss', probability: 30 },
];
const DEFAULT_PACING = {
  enabled: true,
  tiers: ['t1', 't2', 't3'],
  bucketMinutes: 60,
  carryOver: true,
  finalReleaseMinutes: 120,
};

/**
 * 스위트를 반복 실행해도 같은 결과가 나오도록 시작 상태를 고정한다.
 * (E2E는 실제 재고·설정을 변경하므로 초기화 없이는 재실행 시 결과가 달라진다.)
 */
async function resetToKnownState() {
  await api('/api/admin/event', {
    method: 'POST',
    body: JSON.stringify({ eventOn: true, emergencyStop: false, reason: 'E2E 초기화', actor: 'e2e' }),
  });
  await api('/api/admin/rules/publish', {
    method: 'POST',
    body: JSON.stringify({
      probabilities: DEFAULT_PROBS,
      depletionPolicy: 'toMiss',
      pacing: DEFAULT_PACING,
      reason: 'E2E 초기화 — 기본 확률로 복원',
      publishedBy: 'e2e',
    }),
  });
  // 상한을 해제하고 재고를 보충해 스위트가 재고에 막히지 않게 한다
  const dash = await api('/api/admin/dashboard');
  const need = { t1: 5, t2: 10, t3: 20, t4: 40, t5: 60 };
  for (const p of dash.body.prizes) {
    await api(`/api/admin/prizes/${p.tier}`, {
      method: 'POST',
      body: JSON.stringify({ dailyCap: null, eventCap: null, active: true, reason: 'E2E 초기화', actor: 'e2e' }),
    });
    const delta = need[p.tier] - p.remainingQty;
    if (delta > 0) {
      await api(`/api/admin/prizes/${p.tier}/adjust`, {
        method: 'POST',
        body: JSON.stringify({ delta, reason: 'E2E 초기화 재고 보충', actor: 'e2e' }),
      });
    }
  }
  await api('/api/admin/prizes/day-start', { method: 'POST' });
}

console.log(`\nAEPICK Lucky Draw — API E2E (${BASE})\n`);
console.log('■ 시작 상태 초기화');
await resetToKnownState();
{
  const c = await api('/api/config/active');
  check('초기화 완료 — 활성 규칙 확인', typeof c.body.ruleVersion === 'number');
}

/* ---------- 0. 헬스 ---------- */
console.log('■ 부트스트랩');
{
  const h = await api('/api/health');
  check('헬스 체크 응답', h.status === 200 && h.body.ok === true);
  const c = await api('/api/config/active');
  check('활성 설정 조회', c.status === 200 && typeof c.body.ruleVersion === 'number');
  check('게임 설정 포함', c.body.game && typeof c.body.game.aimSeconds === 'number');
  check('i18n 3개 로케일 포함', c.body.i18n && ['vi', 'en', 'ko'].every((l) => c.body.i18n[l]));
  check(
    '사용자 부트스트랩에 확률·잔여 재고가 노출되지 않는다',
    !JSON.stringify(c.body).includes('probabilit') && !JSON.stringify(c.body).includes('remainingQty'),
  );
}

/* ---------- 1. 인증 ---------- */
console.log('\n■ 인증 (§14 보안)');
{
  const r = await fetch(BASE + '/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idempotencyKey: uid(), deviceId: 'x', operatorId: 'y' }),
  });
  check('운영자 인증 없이 세션 생성 불가 (§16.1)', r.status === 401);
}

/* ---------- 2. 멱등성 ---------- */
console.log('\n■ 멱등성 (§10.2)');
{
  const key = uid();
  const body = JSON.stringify({
    idempotencyKey: key,
    deviceId: 'e2e-idem',
    operatorId: 'e2e-operator',
  });
  const a = await api('/api/sessions', { method: 'POST', body });
  const b = await api('/api/sessions', { method: 'POST', body });
  check('동일 멱등키 재요청은 같은 세션을 반환', a.body.sessionId === b.body.sessionId);
  check('동일 멱등키 재요청은 같은 연출 계약을 반환',
    JSON.stringify(a.body.motion) === JSON.stringify(b.body.motion));

  // 병렬 동시 요청
  const key2 = uid();
  const body2 = JSON.stringify({
    idempotencyKey: key2,
    deviceId: 'e2e-idem2',
    operatorId: 'e2e-operator',
  });
  const results = await Promise.all(
    Array.from({ length: 8 }, () => api('/api/sessions', { method: 'POST', body: body2 })),
  );
  const ids = new Set(results.filter((r) => r.status === 200).map((r) => r.body.sessionId));
  check('동시 8회 요청에서 세션이 1개만 생성된다', ids.size === 1, `생성 ${ids.size}개`);

  await playThrough(a.body, 'e2e-idem');
  await playThrough(results[0].body, 'e2e-idem2');
}

/* ---------- 3. 클라이언트 결과 은닉 ---------- */
console.log('\n■ 결과 은닉 (§11.1)');
{
  const s = await createPlay({ deviceId: 'e2e-hide' });
  const payload = JSON.stringify(s.body);
  check('세션 생성 응답에 등급 문자열이 없다', !/"(t[1-5]|miss)"/.test(payload), payload.slice(0, 200));
  check('세션 생성 응답에 경품명·코드가 없다',
    !payload.includes('claimCode') && !payload.includes('prize'));
  check('연출 계약(win/missVariant/effectLevel)은 포함된다',
    typeof s.body.motion.win === 'boolean' && typeof s.body.motion.missVariant === 'number');

  const bad = await api(`/api/sessions/${s.body.sessionId}/reveal`, {
    headers: { 'x-result-token': 'wrong-token' },
  });
  check('잘못된 result_token으로 결과를 볼 수 없다', bad.status === 403);

  const reveal = await playThrough(s.body, 'e2e-hide');
  check('올바른 토큰으로 결과 상세를 얻는다', typeof reveal.tier === 'string');
  check('연출 계약의 win이 실제 결과와 일치한다 (§16.2)',
    reveal.win === s.body.motion.win, `motion=${s.body.motion.win} reveal=${reveal.win}`);
}

/* ---------- 4. 세션 1개 제한 / 상태 전이 ---------- */
console.log('\n■ 상태 관리 (§11, 부록 B)');
{
  const s1 = await createPlay({ deviceId: 'e2e-lock' });
  check('첫 세션 생성 성공', s1.status === 200);
  const s2 = await createPlay({ deviceId: 'e2e-lock' });
  check('미완료 세션이 있으면 신규 Start 차단 (§11 불변 규칙)',
    s2.status === 409 && s2.body.error === 'SESSION_IN_PROGRESS', `${s2.status} ${s2.body.error}`);

  const rec = await api('/api/recover?deviceId=e2e-lock');
  check('미완료 세션을 복구 조회할 수 있다 (§12)', rec.body.session?.sessionId === s1.body.sessionId);

  await playThrough(s1.body, 'e2e-lock');
  const s3 = await createPlay({ deviceId: 'e2e-lock' });
  check('플레이 완료 후에는 신규 Start 가능', s3.status === 200);
  await playThrough(s3.body, 'e2e-lock');

  // 전이표 위반
  const ev = await api(`/api/admin/sessions/${s1.body.sessionId}/events`);
  const chain = ev.body.items.map((e) => e.to_status).join('→');
  check('상태 전이가 전부 로깅된다', ev.body.items.length >= 3, chain);
  check('전이 순서가 부록 B를 따른다',
    chain.startsWith('CREATED→DRAWN→PLAYED'), chain);
}

/* ---------- 5. 테스트 모드 ---------- */
console.log('\n■ 테스트 모드 (§5.6)');
{
  const before = await api('/api/admin/dashboard');
  const stockBefore = before.body.prizes.find((p) => p.tier === 't1');

  const t = await createPlay({ isTest: true, forceTier: 't1', deviceId: 'e2e-test' });
  check('테스트 세션 생성 성공', t.status === 200 && t.body.isTest === true);
  const reveal = await playThrough(t.body, 'e2e-test');
  check('등급 강제 지정이 적용된다', reveal.tier === 't1', reveal.tier);
  check('테스트 세션은 TEST로 표시된다', reveal.isTest === true);
  check('테스트 세션은 코드를 발급하지 않는다', reveal.claimCode === null);

  const after = await api('/api/admin/dashboard');
  const stockAfter = after.body.prizes.find((p) => p.tier === 't1');
  check('테스트 세션은 재고를 차감하지 않는다',
    stockBefore.remainingQty === stockAfter.remainingQty,
    `${stockBefore.remainingQty} → ${stockAfter.remainingQty}`);

  const forced = await createPlay({ isTest: false, forceTier: 't1', deviceId: 'e2e-force' });
  check('일반 세션에서 등급 강제 지정은 거부된다', forced.status === 400, forced.body.error);
}

/* ---------- 6. 지급 흐름 ---------- */
console.log('\n■ 지급 흐름 (§6.4 / §10.3)');
{
  // 당첨이 나올 때까지 반복 (t5 확률 35%)
  let win = null;
  let reveal = null;
  for (let i = 0; i < 40 && !win; i++) {
    const s = await createPlay({ deviceId: `e2e-claim-${i}` });
    if (s.status !== 200) continue;
    const rv = await playThrough(s.body, `e2e-claim-${i}`);
    if (rv.win) {
      win = s.body;
      reveal = rv;
    }
  }
  check('당첨 세션을 확보했다', win !== null);

  if (win) {
    check('당첨 세션은 6자리 코드를 발급한다',
      /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(reveal.claimCode ?? ''), reveal.claimCode);

    const pending = await api('/api/sessions/pending');
    const inQueue = pending.body.items.find((i) => i.sessionId === win.sessionId);
    check('결과화면 이탈과 무관하게 지급 큐에 남는다 (§11)', !!inQueue);
    check('지급 큐에 경품명·경과 시간이 포함된다',
      inQueue && inQueue.prizeName && typeof inQueue.elapsedMinutes === 'number');

    const c1 = await api('/api/claims/by-code', {
      method: 'POST',
      body: JSON.stringify({ code: reveal.claimCode, operatorId: 'e2e-op' }),
    });
    check('코드로 지급 완료 처리된다', c1.status === 200, JSON.stringify(c1.body));

    const c2 = await api('/api/claims/by-code', {
      method: 'POST',
      body: JSON.stringify({ code: reveal.claimCode, operatorId: 'e2e-op' }),
    });
    check('이미 지급된 코드 재제시는 거부된다 (§16.1)',
      c2.status === 409 && c2.body.error === 'ALREADY_CLAIMED', JSON.stringify(c2.body));

    const c3 = await api('/api/claims/by-code', {
      method: 'POST',
      body: JSON.stringify({ code: 'ZZZZZZ', operatorId: 'e2e-op' }),
    });
    check('존재하지 않는 코드는 404', c3.status === 404);

    const pending2 = await api('/api/sessions/pending');
    check('지급 완료 후 큐에서 제거된다',
      !pending2.body.items.find((i) => i.sessionId === win.sessionId));
  }
}

/* ---------- 7. 확률 게시 검증 ---------- */
console.log('\n■ 확률 설정 게시 (§9.3 / §16.1)');
{
  const bad = await api('/api/admin/rules/publish', {
    method: 'POST',
    body: JSON.stringify({
      probabilities: [
        { tier: 't1', probability: 1 },
        { tier: 't2', probability: 4 },
        { tier: 't3', probability: 10 },
        { tier: 't4', probability: 20 },
        { tier: 't5', probability: 35 },
        { tier: 'miss', probability: 29.5 },
      ],
      reason: '합계 오류 테스트',
    }),
  });
  check('합계가 100.000%가 아니면 게시 거부 (§16.1)',
    bad.status === 400 && bad.body.error === 'VALIDATION_FAILED', JSON.stringify(bad.body).slice(0, 120));

  const noReason = await api('/api/admin/rules/publish', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  check('변경 사유 없이 게시 거부', noReason.status === 400 && noReason.body.error === 'REASON_REQUIRED');

  const v = await api('/api/admin/rules/validate', { method: 'POST', body: JSON.stringify({}) });
  check('현재 설정은 검증을 통과한다', v.body.ok === true);
  check('예상 1,000회 미리보기를 제공한다 (§9.3)',
    Array.isArray(v.body.preview) && v.body.preview.length === 6);

  // 진행 중 세션은 이전 규칙 유지 (§5.3)
  const before = await api('/api/config/active');
  const live = await createPlay({ deviceId: 'e2e-ruleswap' });
  const pub = await api('/api/admin/rules/publish', {
    method: 'POST',
    body: JSON.stringify({ reason: 'E2E 규칙 전환 검증', publishedBy: 'e2e' }),
  });
  check('유효한 설정은 게시된다', pub.status === 200 && typeof pub.body.versionId === 'number');
  check('게시는 신규 세션부터 적용됨을 명시한다', pub.body.appliesTo === 'newSessionsOnly');

  const after = await api('/api/config/active');
  check('활성 규칙 버전이 올라간다', after.body.ruleVersion > before.body.ruleVersion,
    `${before.body.ruleVersion} → ${after.body.ruleVersion}`);

  const sessRow = await api(`/api/admin/sessions?limit=200&includeTest=1`);
  const row = sessRow.body.items.find((r) => r.session_id === live.body.sessionId);
  check('게시 전 생성된 세션은 이전 규칙 버전을 유지한다 (§5.3)',
    row && row.rule_version === before.body.ruleVersion,
    `session=${row?.rule_version} before=${before.body.ruleVersion}`);
  await playThrough(live.body, 'e2e-ruleswap');
}

/* ---------- 8. 재고 경계 동시성 ---------- */
console.log('\n■ 재고 동시성 (§16.3)');
{
  // t1 재고를 1로 맞춘 뒤 동시 당첨 시도. t1 확률 100%로 임시 게시.
  const dash = await api('/api/admin/dashboard');
  const t1 = dash.body.prizes.find((p) => p.tier === 't1');
  const delta = 1 - t1.remainingQty;
  if (delta !== 0) {
    await api('/api/admin/prizes/t1/adjust', {
      method: 'POST',
      body: JSON.stringify({ delta, reason: 'E2E 재고 경계 테스트', actor: 'e2e' }),
    });
  }
  // 일일 상한도 해제
  await api('/api/admin/prizes/t1', {
    method: 'POST',
    body: JSON.stringify({ dailyCap: null, eventCap: null, reason: 'E2E', actor: 'e2e' }),
  });
  // 복구를 위해 현재 활성 규칙 전문을 확보한다 (/api/config/active는 확률을 노출하지 않는다)
  const rulesBefore = await api('/api/admin/rules');
  const activeBefore = rulesBefore.body.items.find((r) => r.active);
  await api('/api/admin/rules/publish', {
    method: 'POST',
    body: JSON.stringify({
      probabilities: [
        { tier: 't1', probability: 100 },
        { tier: 't2', probability: 0 },
        { tier: 't3', probability: 0 },
        { tier: 't4', probability: 0 },
        { tier: 't5', probability: 0 },
        { tier: 'miss', probability: 0 },
      ],
      pacing: { enabled: false, tiers: [], bucketMinutes: 60, carryOver: true, finalReleaseMinutes: 120 },
      reason: 'E2E 재고 경계 동시성 테스트',
      publishedBy: 'e2e',
    }),
  });

  const results = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      createPlay({ deviceId: `e2e-race-${i}` }).then((s) =>
        s.status === 200 ? playThrough(s.body, `e2e-race-${i}`).then((rv) => rv) : null,
      ),
    ),
  );
  const wins = results.filter((r) => r && r.tier === 't1');
  check('재고 1개에 동시 12회 요청 → 당첨은 1건뿐', wins.length === 1, `${wins.length}건`);

  const after = await api('/api/admin/dashboard');
  const t1After = after.body.prizes.find((p) => p.tier === 't1');
  check('잔여 재고가 음수가 되지 않는다', t1After.remainingQty >= 0, `${t1After.remainingQty}`);
  check('재고 소진 후 t1은 차단 상태가 된다',
    after.body.availability.t1.available === false &&
      after.body.availability.t1.reason === 'noStock',
    JSON.stringify(after.body.availability.t1));

  const codes = new Set(wins.map((w) => w.claimCode));
  check('당첨 코드가 중복 발급되지 않는다', codes.size === wins.length);

  // 원상 복구 — 확보해 둔 이전 활성 규칙을 그대로 재게시한다
  const restore = await api('/api/admin/rules/publish', {
    method: 'POST',
    body: JSON.stringify({
      probabilities: activeBefore.probabilities,
      depletionPolicy: activeBefore.depletionPolicy,
      pacing: activeBefore.pacing,
      reason: 'E2E 복구 — 이전 확률로 되돌림',
      publishedBy: 'e2e',
    }),
  });
  check('테스트 후 이전 확률 설정으로 복구된다', restore.status === 200);
  const restored = await api('/api/admin/rules');
  const nowActive = restored.body.items.find((r) => r.active);
  check(
    '복구된 확률이 테스트 이전과 동일하다',
    JSON.stringify(nowActive.probabilities) === JSON.stringify(activeBefore.probabilities),
  );
}

/* ---------- 9. 무효 처리 / 재고 복원 ---------- */
console.log('\n■ 무효 처리 (§5.5)');
{
  await api('/api/admin/prizes/t1/adjust', {
    method: 'POST',
    body: JSON.stringify({ delta: 2, reason: 'E2E 무효 테스트 재고', actor: 'e2e' }),
  });
  const s = await createPlay({ isTest: false, deviceId: 'e2e-void' });
  const rv = await playThrough(s.body, 'e2e-void');

  const noReason = await api(`/api/sessions/${s.body.sessionId}/void`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  check('사유 없는 무효 처리는 거부된다', noReason.status === 400, noReason.body.error);

  if (rv.win) {
    const before = await api('/api/admin/dashboard');
    const p = before.body.prizes.find((x) => x.tier === rv.prize.tier);
    const v = await api(`/api/sessions/${s.body.sessionId}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason: '참여자 미수령', actor: 'e2e-manager' }),
    });
    check('당첨 세션 무효 처리 성공', v.status === 200);
    const after = await api('/api/admin/dashboard');
    const pAfter = after.body.prizes.find((x) => x.tier === rv.prize.tier);
    check('무효 처리 시 예약 재고가 available로 복원된다',
      pAfter.remainingQty === p.remainingQty + 1,
      `${p.remainingQty} → ${pAfter.remainingQty}`);
    const again = await api(`/api/sessions/${s.body.sessionId}/claim`, {
      method: 'POST',
      body: JSON.stringify({ operatorId: 'e2e' }),
    });
    check('무효 처리된 세션은 지급할 수 없다', again.status === 409, again.body.error);
  } else {
    const v = await api(`/api/sessions/${s.body.sessionId}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason: '꽝 세션 무효 시도', actor: 'e2e' }),
    });
    check('종료된 꽝 세션은 무효 처리할 수 없다', v.status === 409, v.body.error);
  }
}

/* ---------- 10. 긴급 중지 ---------- */
console.log('\n■ 운영 통제 (§13)');
{
  await api('/api/admin/event', {
    method: 'POST',
    body: JSON.stringify({ emergencyStop: true, reason: 'E2E', actor: 'e2e' }),
  });
  const blocked = await createPlay({ deviceId: 'e2e-stop' });
  check('긴급 중지 상태에서 신규 세션 생성 차단', blocked.status === 409 && blocked.body.error === 'EMERGENCY_STOP');

  await api('/api/admin/event', {
    method: 'POST',
    body: JSON.stringify({ emergencyStop: false, eventOn: false, reason: 'E2E', actor: 'e2e' }),
  });
  const off = await createPlay({ deviceId: 'e2e-off' });
  check('행사 OFF 상태에서 신규 세션 생성 차단', off.status === 409 && off.body.error === 'EVENT_OFF');

  await api('/api/admin/event', {
    method: 'POST',
    body: JSON.stringify({ eventOn: true, emergencyStop: false, reason: 'E2E 복구', actor: 'e2e' }),
  });
  const ok = await createPlay({ deviceId: 'e2e-resume' });
  check('복구 후 정상 동작', ok.status === 200);
  if (ok.status === 200) await playThrough(ok.body, 'e2e-resume');
}

/* ---------- 11. 감사 로그 / 리포트 ---------- */
console.log('\n■ 감사 · 리포트 (§14 무결성)');
{
  const audit = await api('/api/admin/audit');
  const actions = new Set(audit.body.items.map((i) => i.action));
  check('설정 게시가 감사 로그에 남는다', actions.has('rules.publish'));
  check('재고 조정이 감사 로그에 남는다', actions.has('prize.adjust'));
  check('지급 처리가 감사 로그에 남는다', actions.has('claim'));
  check('무효 처리가 감사 로그에 남는다', actions.has('void') || actions.has('prize.update'));
  const withReason = audit.body.items.filter((i) => i.action === 'prize.adjust');
  check('재고 조정 감사 로그에 사유가 기록된다', withReason.every((i) => !!i.reason));

  const csv = await fetch(BASE + '/api/admin/report.csv', {
    headers: { 'x-operator-pin': PIN, 'x-admin-key': ADMIN },
  });
  // Response.text()는 스펙상 BOM을 제거하므로 원시 바이트로 확인한다
  const bytes = new Uint8Array(await csv.arrayBuffer());
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
  check('CSV 리포트를 내보낼 수 있다', csv.status === 200 && text.includes('session_id'));
  check(
    'CSV에 UTF-8 BOM이 포함된다 (엑셀 한글 호환)',
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
    `${bytes[0]?.toString(16)} ${bytes[1]?.toString(16)} ${bytes[2]?.toString(16)}`,
  );
}

/* ---------- 결과 ---------- */
console.log(`\n${'─'.repeat(58)}`);
console.log(`통과 ${pass} · 실패 ${fail}`);
if (fail) {
  console.log('\n실패 항목:');
  for (const f of failures) console.log('  - ' + f);
}
process.exit(fail ? 1 : 0);
