/**
 * 서버 엔트리 — API + 어드민 + (빌드된) 키오스크 정적 서빙
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { seedIfEmpty } from './db.js';
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

/* 만료·정리 스케줄러 — 10분 주기 (§10.3 만료 배치, 부록 B ABORTED) */
const SCHEDULE_MS = 10 * 60_000;
setInterval(() => {
  try {
    const expired = expirePendingClaims();
    const aborted = abortStaleSessions();
    if (expired || aborted) app.log.info({ expired, aborted }, 'scheduler');
  } catch (err) {
    app.log.error({ err }, 'scheduler failed');
  }
}, SCHEDULE_MS).unref();

await app.listen({ port: PORT, host: HOST });
app.log.info(`admin  → http://localhost:${PORT}/admin`);
