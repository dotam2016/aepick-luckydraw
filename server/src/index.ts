/**
 * 서버 엔트리 — API + 어드민 + (빌드된) 키오스크 정적 서빙
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DAILY_RESET_PROBABILITIES } from '@aepick/shared';
import {
  getActiveRule,
  getProbResetDate,
  logAudit,
  publishRuleVersion,
  resetDailyPrizeStock,
  seedIfEmpty,
  setProbResetDate,
} from './db.js';
import { registerRoutes } from './routes.js';
import { registerAdminRoutes } from './adminRoutes.js';
import { registerAdminPages } from './pages.js';
import { abortStaleSessions, expirePendingClaims } from './sessionService.js';

const PORT = Number(process.env.PORT ?? 8788);
const HOST = process.env.HOST ?? '0.0.0.0';

seedIfEmpty();

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    transport: process.env.NODE_ENV === 'production' ? undefined : undefined,
  },
});

await app.register(cors, { origin: true });

await registerRoutes(app);
await registerAdminRoutes(app);
await registerAdminPages(app);

// 빌드된 키오스크가 있으면 같은 포트에서 서빙한다 (현장 배포 단순화)
const kioskDist = resolve(process.cwd(), '..', 'apps', 'kiosk', 'dist');
if (existsSync(kioskDist)) {
  await app.register(fastifyStatic, { root: kioskDist, prefix: '/kiosk/' });
  app.get('/', async (_req, reply) => reply.redirect('/kiosk/'));
} else {
  app.get('/', async (_req, reply) =>
    reply.type('text/html; charset=utf-8').send(
      `<meta charset="utf-8"><body style="font-family:system-ui;padding:40px">
       <h1>AEPICK Lucky Draw API</h1>
       <p>키오스크 개발 서버: <code>npm run dev:kiosk</code> → http://localhost:5174</p>
       <p>어드민: <a href="/admin">/admin</a></p></body>`,
    ),
  );
}

/** 'YYYY-MM-DD' in Asia/Ho_Chi_Minh — 날짜 경계 비교용 */
function vnDateStr(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
}

/**
 * 매일 0시(VN) 확률을 운영 기본값으로 자동 복원 — 관리자가 하루 동안 바꾼 설정은
 * 다음날 자정에 리셋된다. "오늘 이미 리셋했는지"는 event_config.prob_reset_date로 판단한다
 * (rule_versions.published_at을 쓰면 신규 시드 직후의 published_at도 "오늘"이라
 * 첫 기동 시 리셋이 건너뛰어지는 문제가 있다 — seedIfEmpty는 DEFAULT_PROBABILITIES라는
 * 개발용 placeholder를 심으므로, 첫 기동 시 반드시 운영 기본값으로 덮어써야 한다).
 */
function maybeDailyProbabilityReset(): void {
  const today = vnDateStr(new Date().toISOString());
  if (getProbResetDate() === today) return;

  const rule = getActiveRule();
  const versionId = publishRuleVersion({
    probabilities: DAILY_RESET_PROBABILITIES,
    depletionPolicy: rule.depletionPolicy,
    pacing: rule.pacing,
    gameConfig: rule.gameConfig,
    publishedBy: 'system',
    reason: '일일 자동 리셋 — 운영 기본 확률로 복원',
  });
  setProbResetDate(today);
  logAudit('system', 'rules.dailyReset', {
    target: `rule:${versionId}`,
    before: { versionId: rule.versionId, probabilities: rule.probabilities },
    after: { versionId, probabilities: DAILY_RESET_PROBABILITIES },
  });
  app.log.info({ versionId }, 'daily probability reset');
}

/**
 * 매일 0시(VN) 지정된 등급(경품 · 재고 탭의 ±수량 공식과 동일하게)의 remaining_qty를
 * 고정값으로 복원한다. 이미 오늘 리셋된 등급은 resetDailyPrizeStock 내부에서 건너뛴다.
 */
function maybeDailyPrizeReset(): void {
  const today = vnDateStr(new Date().toISOString());
  const changed = resetDailyPrizeStock(today);
  if (!changed.length) return;

  for (const c of changed) {
    logAudit('system', 'prize.dailyReset', {
      target: c.tier,
      before: { remainingQty: c.before },
      after: { remainingQty: c.after },
    });
  }
  app.log.info({ changed }, 'daily prize stock reset');
}

/* 만료·정리 스케줄러 — 10분 주기 (§10.3 만료 배치, 부록 B ABORTED) */
const SCHEDULE_MS = 10 * 60_000;
function runDailyResets(): void {
  // 서로 독립적인 리셋이므로 한쪽이 실패해도 다른 쪽은 계속 시도한다.
  try {
    maybeDailyProbabilityReset();
  } catch (err) {
    app.log.error({ err }, 'daily probability reset failed');
  }
  try {
    maybeDailyPrizeReset();
  } catch (err) {
    app.log.error({ err }, 'daily prize reset failed');
  }
}

setInterval(() => {
  try {
    const expired = expirePendingClaims();
    const aborted = abortStaleSessions();
    if (expired || aborted) app.log.info({ expired, aborted }, 'scheduler');
  } catch (err) {
    app.log.error({ err }, 'scheduler failed');
  }
  runDailyResets();
}, SCHEDULE_MS).unref();

// 서버가 자정을 지나 재시작된 경우를 대비해 기동 시 1회 즉시 확인한다.
runDailyResets();

await app.listen({ port: PORT, host: HOST });
app.log.info(`admin  → http://localhost:${PORT}/admin`);
