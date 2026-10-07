/**
 * 게임 API — 기획서 v1.1 §10.2
 */

import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  DEFAULT_LOCALE,
  LOCALES,
  DICTS,
  type CreateSessionRequest,
  type PlayedRequest,
} from '@aepick/shared';
import { db, getActiveRule, getEventConfig, listPrizes } from './db.js';
import {
  ServiceError,
  claimByCode,
  claimSession,
  computeAvailability,
  createSession,
  findRecoverableSession,
  getReveal,
  listPendingClaims,
  markPlayed,
  voidSession,
} from './sessionService.js';

export const OPERATOR_PIN = process.env.OPERATOR_PIN ?? '1234';
export const ADMIN_KEY = process.env.ADMIN_KEY ?? 'aepick-admin';

/**
 * 경품 · 재고 / 확률 설정 페이지(/admin/dashboard) 전용 — ADMIN_KEY와 별개의 비밀번호.
 * 단기 행사 종료 후 폐기할 프로젝트라 환경변수 대신 코드에 bcrypt 해시로 고정한다
 * (평문이 아니라 해시만 커밋되므로 저장소를 들여다봐도 원문 비밀번호는 알 수 없다).
 * 비밀번호를 바꾸려면 새 해시를 생성해서 교체: bcrypt.hashSync('새 비밀번호', 10)
 */
const DASHBOARD_PASSWORD_HASH = '$2b$10$7lshMGto28pLsLAywcvLV.K2K1GvHQrNxRge953Sp/oyGyPqh0Kgm';

export function requireOperator(req: FastifyRequest, reply: FastifyReply): boolean {
  const pin = req.headers['x-operator-pin'];
  const adminKey = req.headers['x-admin-key'];
  if (pin === OPERATOR_PIN || adminKey === ADMIN_KEY) return true;
  reply.code(401).send({ error: 'UNAUTHORIZED', message: '운영자 인증이 필요합니다.' });
  return false;
}

export function requireAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  if (req.headers['x-admin-key'] === ADMIN_KEY) return true;
  reply.code(401).send({ error: 'UNAUTHORIZED', message: '관리자 인증이 필요합니다.' });
  return false;
}

export function requireDashboard(req: FastifyRequest, reply: FastifyReply): boolean {
  const key = req.headers['x-dashboard-key'];
  if (typeof key === 'string' && bcrypt.compareSync(key, DASHBOARD_PASSWORD_HASH)) return true;
  reply.code(401).send({ error: 'UNAUTHORIZED', message: '경품 · 확률 설정 인증이 필요합니다.' });
  return false;
}

function fail(reply: FastifyReply, err: unknown) {
  if (err instanceof ServiceError) {
    return reply.code(err.status).send({ error: err.code, message: err.message });
  }
  const message = err instanceof Error ? err.message : String(err);
  return reply.code(500).send({ error: 'INTERNAL', message });
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  /* ---------- 클라이언트 부트스트랩 ---------- */

  app.get('/api/config/active', async (_req, reply) => {
    const rule = getActiveRule();
    const event = getEventConfig();
    const prizes = listPrizes();
    return reply.send({
      ruleVersion: rule.versionId,
      game: rule.gameConfig,
      event: {
        eventOn: event.eventOn,
        emergencyStop: event.emergencyStop,
        openAt: event.openAt,
        closeAt: event.closeAt,
        offlineGraceSeconds: event.offlineGraceSeconds,
      },
      // 대기화면 안내용 — 확률·잔여 재고는 사용자 화면에 노출하지 않는다
      prizeDisplay: prizes
        .filter((p) => p.active)
        .map((p) => ({ tier: p.tier, name: p.name, imageKey: p.imageKey })),
      locales: LOCALES,
      defaultLocale: DEFAULT_LOCALE,
      i18n: DICTS,
      serverTime: new Date().toISOString(),
    });
  });

  /* ---------- 세션 생성 (운영자 승인) ---------- */

  app.post('/api/sessions', async (req, reply) => {
    if (!requireOperator(req, reply)) return;
    try {
      const body = req.body as CreateSessionRequest;
      if (!body?.deviceId || !body?.operatorId) {
        throw new ServiceError('BAD_REQUEST', 'deviceId와 operatorId는 필수입니다.');
      }
      return reply.send(createSession(body));
    } catch (err) {
      return fail(reply, err);
    }
  });

  /* ---------- 플레이 완료 지표 ---------- */

  app.post('/api/sessions/:id/played', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const token = req.headers['x-result-token'];
      const row = db.prepare('SELECT result_token FROM sessions WHERE session_id = ?').get(id) as
        | { result_token: string }
        | undefined;
      if (!row) throw new ServiceError('SESSION_NOT_FOUND', '세션을 찾을 수 없습니다.', 404);
      if (row.result_token !== token) {
        throw new ServiceError('INVALID_RESULT_TOKEN', '결과 토큰이 일치하지 않습니다.', 403);
      }
      return reply.send(markPlayed(id, req.body as PlayedRequest));
    } catch (err) {
      return fail(reply, err);
    }
  });

  /* ---------- 결과 상세 (REVEAL) ---------- */

  app.get('/api/sessions/:id/reveal', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const token = String(req.headers['x-result-token'] ?? '');
      return reply.send(getReveal(id, token));
    } catch (err) {
      return fail(reply, err);
    }
  });

  /* ---------- 복구 (§12) ---------- */

  app.get('/api/recover', async (req, reply) => {
    if (!requireOperator(req, reply)) return;
    const { deviceId } = req.query as { deviceId?: string };
    if (!deviceId) return fail(reply, new ServiceError('BAD_REQUEST', 'deviceId는 필수입니다.'));
    return reply.send({ session: findRecoverableSession(deviceId) });
  });

  /* ---------- 지급 큐 ---------- */

  app.get('/api/sessions/pending', async (req, reply) => {
    if (!requireOperator(req, reply)) return;
    return reply.send({ items: listPendingClaims() });
  });

  app.post('/api/sessions/:id/claim', async (req, reply) => {
    if (!requireOperator(req, reply)) return;
    try {
      const { id } = req.params as { id: string };
      const { operatorId } = (req.body ?? {}) as { operatorId?: string };
      return reply.send(claimSession(id, operatorId ?? 'operator'));
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/claims/by-code', async (req, reply) => {
    if (!requireOperator(req, reply)) return;
    try {
      const { code, operatorId } = (req.body ?? {}) as { code?: string; operatorId?: string };
      if (!code) throw new ServiceError('BAD_REQUEST', 'code는 필수입니다.');
      return reply.send(claimByCode(code, operatorId ?? 'operator'));
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/sessions/:id/void', async (req, reply) => {
    if (!requireOperator(req, reply)) return;
    try {
      const { id } = req.params as { id: string };
      const { reason, actor } = (req.body ?? {}) as { reason?: string; actor?: string };
      return reply.send(voidSession(id, reason ?? '', actor ?? 'manager'));
    } catch (err) {
      return fail(reply, err);
    }
  });

  /* ---------- 진단 ---------- */

  app.get('/api/availability', async (req, reply) => {
    if (!requireOperator(req, reply)) return;
    const { availability, quotas } = computeAvailability();
    return reply.send({ availability, winsInBucket: quotas, at: new Date().toISOString() });
  });

  app.post('/api/errors', async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, string>;
    db.prepare(
      `INSERT INTO app_errors (session_id, error_code, network_state, app_version, recovery_action, at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      b.sessionId ?? null,
      b.errorCode ?? 'UNKNOWN',
      b.networkState ?? null,
      b.appVersion ?? null,
      b.recoveryAction ?? null,
      new Date().toISOString(),
    );
    return reply.send({ ok: true });
  });

  app.get('/api/health', async (_req, reply) => {
    const event = getEventConfig();
    return reply.send({
      ok: true,
      eventOn: event.eventOn,
      emergencyStop: event.emergencyStop,
      serverTime: new Date().toISOString(),
    });
  });
}
