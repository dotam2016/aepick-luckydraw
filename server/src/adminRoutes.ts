/**
 * 어드민 API — 기획서 v1.1 §9.2
 */

import type { FastifyInstance } from 'fastify';
import ExcelJS from 'exceljs';
import {
  ALL_TIERS,
  WIN_TIERS,
  mergeValidation,
  validateGameConfig,
  validatePacing,
  validateProbabilities,
  type GameConfig,
  type PacingConfig,
  type ResultTier,
  type TierProbability,
} from '@aepick/shared';
import { db, getActiveRule, getEventConfig, listPrizes, logAudit, transact } from './db.js';
import { ServiceError, computeAvailability, expirePendingClaims } from './sessionService.js';
import { requireAdmin, requireOperator } from './routes.js';

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  /* ---------- 운영 대시보드 ---------- */

  app.get('/api/admin/dashboard', async (req, reply) => {
    if (!requireOperator(req, reply)) return;

    const event = getEventConfig();
    const rule = getActiveRule();
    const since = event.openAt;

    const counts = db
      .prepare(
        `SELECT s.status AS status, COUNT(*) AS c
         FROM sessions s WHERE s.is_test = 0 AND s.created_at >= ?
         GROUP BY s.status`,
      )
      .all(since) as { status: string; c: number }[];

    const tiers = db
      .prepare(
        `SELECT d.result_tier AS tier, COUNT(*) AS c
         FROM draws d JOIN sessions s USING(session_id)
         WHERE d.is_test = 0 AND d.created_at >= ? AND s.status NOT IN ('VOIDED','ABORTED')
         GROUP BY d.result_tier`,
      )
      .all(since) as { tier: ResultTier; c: number }[];

    const metrics = db
      .prepare(
        `SELECT AVG(m.aim_duration_ms) AS avgAim, AVG(m.min_fps) AS avgMinFps, COUNT(*) AS n
         FROM play_metrics m JOIN sessions s USING(session_id)
         WHERE s.is_test = 0 AND m.created_at >= ?`,
      )
      .get(since) as { avgAim: number | null; avgMinFps: number | null; n: number };

    // §10.4 — 결과 확정 시각과 지급 완료 시각의 평균 격차 (지급 큐 동선 검증 지표)
    const claimGap = db
      .prepare(
        `SELECT AVG((julianday(c.claimed_at) - julianday(s.played_at)) * 1440) AS avgMinutes, COUNT(*) AS n
         FROM claims c JOIN sessions s USING(session_id)
         WHERE c.claimed_at IS NOT NULL AND s.played_at IS NOT NULL AND s.is_test = 0 AND s.created_at >= ?`,
      )
      .get(since) as { avgMinutes: number | null; n: number };

    const lowFps = db
      .prepare(
        `SELECT COUNT(*) AS c FROM play_metrics m JOIN sessions s USING(session_id)
         WHERE s.is_test = 0 AND m.created_at >= ? AND m.min_fps < 30`,
      )
      .get(since) as { c: number };

    const errors = db
      .prepare('SELECT COUNT(*) AS c FROM app_errors WHERE at >= ?')
      .get(since) as { c: number };

    const statusMap: Record<string, number> = {};
    for (const r of counts) statusMap[r.status] = r.c;
    const tierMap: Record<string, number> = {};
    for (const r of tiers) tierMap[r.tier] = r.c;

    const totalDraws = ALL_TIERS.reduce((a, t) => a + (tierMap[t] ?? 0), 0);
    const configured: Record<string, number> = {};
    for (const p of rule.probabilities) configured[p.tier] = p.probability;

    return reply.send({
      event,
      ruleVersion: rule.versionId,
      sessions: {
        byStatus: statusMap,
        total: Object.values(statusMap).reduce((a, b) => a + b, 0),
        pending: statusMap.PENDING_CLAIM ?? 0,
        claimed: statusMap.CLAIMED ?? 0,
        voided: statusMap.VOIDED ?? 0,
        expired: statusMap.EXPIRED ?? 0,
        aborted: statusMap.ABORTED ?? 0,
      },
      draws: ALL_TIERS.map((tier) => {
        const count = tierMap[tier] ?? 0;
        const actual = totalDraws ? (count / totalDraws) * 100 : 0;
        return {
          tier,
          count,
          actualPercent: Number(actual.toFixed(3)),
          configuredPercent: configured[tier] ?? 0,
          deviation: Number((actual - (configured[tier] ?? 0)).toFixed(3)),
        };
      }),
      prizes: listPrizes().map((p) => ({
        tier: p.tier,
        name: p.name,
        totalQty: p.totalQty,
        remainingQty: p.remainingQty,
        reservedQty: p.reservedQty,
        claimedQty: p.claimedQty,
        dailyCap: p.dailyCap,
        eventCap: p.eventCap,
        active: p.active,
      })),
      availability: computeAvailability().availability,
      kpi: {
        avgAimMs: metrics.avgAim ? Math.round(metrics.avgAim) : null,
        avgMinFps: metrics.avgMinFps ? Number(metrics.avgMinFps.toFixed(1)) : null,
        playCount: metrics.n,
        avgClaimGapMinutes: claimGap.avgMinutes ? Number(claimGap.avgMinutes.toFixed(1)) : null,
        claimedCount: claimGap.n,
        lowFpsCount: lowFps.c,
        errorCount: errors.c,
      },
    });
  });

  /* ---------- 세션 로그 ---------- */

  app.get('/api/admin/sessions', async (req, reply) => {
    if (!requireOperator(req, reply)) return;
    const q = req.query as { limit?: string; includeTest?: string; status?: string };
    const limit = Math.min(Number(q.limit ?? 100), 1000);
    const includeTest = q.includeTest === '1';

    const where: string[] = [];
    const args: (string | number)[] = [];
    if (!includeTest) where.push('s.is_test = 0');
    if (q.status) {
      where.push('s.status = ?');
      args.push(q.status);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = db
      .prepare(
        `SELECT s.session_id, s.device_id, s.operator_id, s.is_test, s.status, s.rule_version,
                s.created_at, s.played_at, s.closed_at, s.expires_at,
                d.result_tier, d.roll_milli, d.blocked_tiers,
                c.claim_code, c.claimed_at, c.claimed_by, c.void_reason,
                m.aim_duration_ms, m.auto_catch, m.min_fps
         FROM sessions s
         LEFT JOIN draws d USING(session_id)
         LEFT JOIN claims c USING(session_id)
         LEFT JOIN play_metrics m USING(session_id)
         ${whereSql}
         ORDER BY s.created_at DESC LIMIT ?`,
      )
      .all(...args, limit);

    return reply.send({ items: rows });
  });

  app.get('/api/admin/sessions/:id/events', async (req, reply) => {
    if (!requireOperator(req, reply)) return;
    const { id } = req.params as { id: string };
    const rows = db
      .prepare('SELECT from_status, to_status, at, actor, note FROM session_events WHERE session_id = ? ORDER BY id')
      .all(id);
    return reply.send({ items: rows });
  });

  /* ---------- 확률 설정 게시 (§9.3) ---------- */

  app.post('/api/admin/rules/validate', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const b = (req.body ?? {}) as {
      probabilities?: TierProbability[];
      pacing?: PacingConfig;
      gameConfig?: GameConfig;
    };
    const current = getActiveRule();
    const result = mergeValidation(
      validateProbabilities(b.probabilities ?? current.probabilities),
      validatePacing(b.pacing ?? current.pacing),
      validateGameConfig(b.gameConfig ?? current.gameConfig),
    );
    // §9.3 — 예상 1,000회 결과 미리보기
    const probs = b.probabilities ?? current.probabilities;
    const preview = probs.map((p) => ({ tier: p.tier, per1000: Math.round(p.probability * 10) }));
    return reply.send({ ...result, preview });
  });

  app.post('/api/admin/rules/publish', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try {
      const b = (req.body ?? {}) as {
        probabilities?: TierProbability[];
        depletionPolicy?: 'toMiss' | 'renormalize';
        pacing?: PacingConfig;
        gameConfig?: GameConfig;
        reason?: string;
        publishedBy?: string;
      };
      if (!b.reason) throw new ServiceError('REASON_REQUIRED', '게시는 변경 사유가 필수입니다.');
      const reason = b.reason;
      const publishedBy = b.publishedBy ?? 'admin';

      const current = getActiveRule();
      const probabilities = b.probabilities ?? current.probabilities;
      const pacing = b.pacing ?? current.pacing;
      const gameConfig = b.gameConfig ?? current.gameConfig;
      const depletionPolicy = b.depletionPolicy ?? current.depletionPolicy;

      const validation = mergeValidation(
        validateProbabilities(probabilities),
        validatePacing(pacing),
        validateGameConfig(gameConfig),
      );
      if (!validation.ok) {
        return reply.code(400).send({ error: 'VALIDATION_FAILED', issues: validation.issues });
      }

      const versionId = transact(() => {
        db.exec('UPDATE rule_versions SET is_active = 0');
        const res = db
          .prepare(
            `INSERT INTO rule_versions
             (probabilities, depletion_policy, pacing, game_config, published_at, published_by, reason, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
          )
          .run(
            JSON.stringify(probabilities),
            depletionPolicy,
            JSON.stringify(pacing),
            JSON.stringify(gameConfig),
            new Date().toISOString(),
            publishedBy,
            reason,
          );
        return Number(res.lastInsertRowid);
      });

      logAudit(publishedBy, 'rules.publish', {
        target: `rule:${versionId}`,
        before: { versionId: current.versionId, probabilities: current.probabilities },
        after: { versionId, probabilities },
        reason,
      });

      // §5.3 — 새 버전은 다음 신규 세션부터 적용된다. 진행 중 세션은 이전 버전을 유지한다.
      return reply.send({ versionId, appliesTo: 'newSessionsOnly' });
    } catch (err) {
      if (err instanceof ServiceError) {
        return reply.code(err.status).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  });

  app.get('/api/admin/rules', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const rows = db
      .prepare(
        `SELECT version_id, probabilities, depletion_policy, pacing, published_at, published_by, reason, is_active
         FROM rule_versions ORDER BY version_id DESC LIMIT 50`,
      )
      .all() as Record<string, unknown>[];
    return reply.send({
      items: rows.map((r) => ({
        versionId: r.version_id,
        probabilities: JSON.parse(String(r.probabilities)),
        depletionPolicy: r.depletion_policy,
        pacing: JSON.parse(String(r.pacing)),
        publishedAt: r.published_at,
        publishedBy: r.published_by,
        reason: r.reason,
        active: r.is_active === 1,
      })),
    });
  });

  /* ---------- 경품 / 재고 조정 ---------- */

  app.post('/api/admin/prizes/:tier', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { tier } = req.params as { tier: string };
    if (!WIN_TIERS.includes(tier as never)) {
      return reply.code(400).send({ error: 'BAD_TIER', message: '당첨 등급만 수정할 수 있습니다.' });
    }
    const b = (req.body ?? {}) as {
      name?: Record<string, string>;
      dailyCap?: number | null;
      eventCap?: number | null;
      active?: boolean;
      reason?: string;
      actor?: string;
    };
    const before = listPrizes().find((p) => p.tier === tier);
    if (!before) return reply.code(404).send({ error: 'NOT_FOUND' });

    db.prepare(
      `UPDATE prizes SET name = ?, daily_cap = ?, event_cap = ?, active = ? WHERE tier = ?`,
    ).run(
      JSON.stringify(b.name ?? before.name),
      b.dailyCap === undefined ? before.dailyCap : b.dailyCap,
      b.eventCap === undefined ? before.eventCap : b.eventCap,
      (b.active === undefined ? before.active : b.active) ? 1 : 0,
      tier,
    );
    logAudit(b.actor ?? 'admin', 'prize.update', { target: tier, before, after: b, reason: b.reason });
    return reply.send({ ok: true });
  });

  app.post('/api/admin/prizes/:tier/adjust', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { tier } = req.params as { tier: string };
    const b = (req.body ?? {}) as { delta?: number; reason?: string; actor?: string };
    const delta = Math.trunc(Number(b.delta ?? 0));
    if (!delta) return reply.code(400).send({ error: 'BAD_DELTA', message: '증감 수량이 필요합니다.' });
    if (!b.reason) return reply.code(400).send({ error: 'REASON_REQUIRED', message: '조정 사유는 필수입니다.' });

    const before = listPrizes().find((p) => p.tier === tier);
    if (!before) return reply.code(404).send({ error: 'NOT_FOUND' });
    if (before.remainingQty + delta < 0) {
      return reply.code(400).send({ error: 'NEGATIVE_STOCK', message: '잔여 재고가 음수가 될 수 없습니다.' });
    }

    db.prepare(
      `UPDATE prizes SET remaining_qty = remaining_qty + ?, total_qty = MAX(total_qty + ?, 0) WHERE tier = ?`,
    ).run(delta, delta, tier);
    const after = listPrizes().find((p) => p.tier === tier);
    logAudit(b.actor ?? 'manager', 'prize.adjust', {
      target: tier,
      before: { remainingQty: before.remainingQty },
      after: { remainingQty: after?.remainingQty },
      reason: b.reason,
    });
    return reply.send({ ok: true, remainingQty: after?.remainingQty });
  });

  /** 일일 오픈 시 day_start_qty를 현재 재고로 리셋 — 고정 쿼터 페이싱의 기준값 */
  app.post('/api/admin/prizes/day-start', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    db.exec('UPDATE prizes SET day_start_qty = remaining_qty');
    logAudit('admin', 'prize.dayStart');
    return reply.send({ ok: true });
  });

  /* ---------- 행사 설정 ---------- */

  app.post('/api/admin/event', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const b = (req.body ?? {}) as Partial<{
      eventOn: boolean;
      emergencyStop: boolean;
      openAt: string;
      closeAt: string;
      claimTtlHours: number;
      offlineGraceSeconds: number;
      reason: string;
      actor: string;
    }>;
    const before = getEventConfig();
    db.prepare(
      `UPDATE event_config SET event_on = ?, emergency_stop = ?, open_at = ?, close_at = ?,
              claim_ttl_hours = ?, offline_grace_seconds = ? WHERE id = 1`,
    ).run(
      (b.eventOn ?? before.eventOn) ? 1 : 0,
      (b.emergencyStop ?? before.emergencyStop) ? 1 : 0,
      b.openAt ?? before.openAt,
      b.closeAt ?? before.closeAt,
      b.claimTtlHours ?? before.claimTtlHours,
      b.offlineGraceSeconds ?? before.offlineGraceSeconds,
    );
    logAudit(b.actor ?? 'admin', 'event.update', { before, after: getEventConfig(), reason: b.reason });
    return reply.send(getEventConfig());
  });

  /* ---------- 리포트 ---------- */

  const REPORT_HEADERS = [
    'session_id', 'created_at', 'played_at', 'device_id', 'operator_id', 'is_test',
    'status', 'rule_version', 'result_tier', 'claim_code', 'claimed_at', 'claimed_by',
    'void_reason', 'aim_duration_ms', 'auto_catch', 'min_fps',
  ] as const;

  function todayStamp(): string {
    return new Date().toISOString().slice(0, 10).replaceAll('-', '');
  }

  function fetchReportRows(): Record<string, unknown>[] {
    return db
      .prepare(
        `SELECT s.session_id, s.created_at, s.played_at, s.device_id, s.operator_id, s.is_test,
                s.status, s.rule_version, d.result_tier, c.claim_code, c.claimed_at, c.claimed_by,
                c.void_reason, m.aim_duration_ms, m.auto_catch, m.min_fps
         FROM sessions s
         LEFT JOIN draws d USING(session_id)
         LEFT JOIN claims c USING(session_id)
         LEFT JOIN play_metrics m USING(session_id)
         ORDER BY s.created_at DESC LIMIT 20000`,
      )
      .all() as Record<string, unknown>[];
  }

  app.get('/api/admin/report.csv', async (req, reply) => {
    if (!requireOperator(req, reply)) return;
    const rows = fetchReportRows();

    const escape = (v: unknown) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
    };
    const csv = [
      REPORT_HEADERS.join(','),
      ...rows.map((r) => REPORT_HEADERS.map((h) => escape(r[h])).join(',')),
    ].join('\n');

    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="luckydraw-sessions-${todayStamp()}.csv"`)
      .send('﻿' + csv);
  });

  app.get('/api/admin/report.xlsx', async (req, reply) => {
    if (!requireOperator(req, reply)) return;
    const rows = fetchReportRows();

    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('sessions');
    sheet.columns = REPORT_HEADERS.map((h) => ({ header: h, key: h, width: 18 }));
    sheet.addRows(rows);

    const buf = await wb.xlsx.writeBuffer();
    return reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="luckydraw-sessions-${todayStamp()}.xlsx"`)
      .send(Buffer.from(buf));
  });

  app.get('/api/admin/audit', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const rows = db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200').all();
    return reply.send({ items: rows });
  });

  app.post('/api/admin/expire-now', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return reply.send({ expired: expirePendingClaims() });
  });
}
