/**
 * 어드민 API — 기획서 v1.1 §9.2
 */

import type { FastifyInstance } from 'fastify';
import ExcelJS from 'exceljs';
import {
  ALL_TIERS,
  DAILY_RESET_PRIZE_QTY,
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
import { db, getActiveRule, getEventConfig, listPrizes, logAudit, publishRuleVersion } from './db.js';
import { ServiceError, computeAvailability, expirePendingClaims } from './sessionService.js';
import { requireAdmin, requireDashboard, requireOperator } from './routes.js';

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

  /* ---------- 경품 · 확률 설정 페이지(/admin/dashboard) 전용 요약 ---------- */

  app.get('/api/admin/dashboard-summary', async (req, reply) => {
    if (!requireDashboard(req, reply)) return;
    const event = getEventConfig();
    const rule = getActiveRule();
    return reply.send({
      event,
      ruleVersion: rule.versionId,
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
    });
  });

  /* ---------- 일별 지급 통계 (당첨 vs 지급) — DB 스키마 변경 없이 기존 테이블만 조회 ---------- */

  const VN_OFFSET = '+07:00';
  const vnDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });

  app.get('/api/admin/stats/daily', async (req, reply) => {
    if (!requireDashboard(req, reply)) return;
    const q = req.query as { date?: string };
    const date = q.date ?? vnDate(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
      return reply.code(400).send({ error: 'BAD_DATE', message: 'date must be YYYY-MM-DD' });
    }
    // 베트남 시간(UTC+7) 기준 하루 경계 → UTC ISO 문자열
    const start = new Date(`${date}T00:00:00${VN_OFFSET}`);
    const end = new Date(start.getTime() + 24 * 3600_000);
    const s = start.toISOString();
    const e = end.toISOString();

    // 당첨: 해당 날짜에 추첨된 건 (무효/중단 제외, 테스트 제외)
    const won = db
      .prepare(
        `SELECT d.result_tier AS tier, s.status AS status, COUNT(*) AS c
         FROM draws d JOIN sessions s USING(session_id)
         WHERE d.is_test = 0 AND d.created_at >= ? AND d.created_at < ?
           AND s.status NOT IN ('VOIDED','ABORTED')
         GROUP BY d.result_tier, s.status`,
      )
      .all(s, e) as { tier: ResultTier; status: string; c: number }[];

    // 지급: 해당 날짜에 실제로 수령 처리된 건 (추첨일과 무관)
    const given = db
      .prepare(
        `SELECT d.result_tier AS tier, COUNT(*) AS c
         FROM claims c JOIN draws d USING(session_id)
         WHERE d.is_test = 0 AND c.claimed_at >= ? AND c.claimed_at < ?
         GROUP BY d.result_tier`,
      )
      .all(s, e) as { tier: ResultTier; c: number }[];

    // 기준 수량·잔여: 오늘은 prizes 테이블의 실제 값(day_start_qty / remaining_qty).
    // 과거 날짜는 일별 스냅샷이 없으므로(DB 변경 없이) 일일 기본 수량 − 당첨 수로 추정한다.
    const isToday = date === vnDate(new Date());
    const prizeRows = listPrizes();

    // 수동 재고 조정(±)은 audit_log의 prize.adjust에 before/after로 남는다 — 과거 날짜 추정에 가산한다.
    const adjusts = db
      .prepare(
        `SELECT target, before, after FROM audit_log
         WHERE action = 'prize.adjust' AND at >= ? AND at < ?`,
      )
      .all(s, e) as { target: string | null; before: string | null; after: string | null }[];
    const adjustedByTier: Record<string, number> = {};
    for (const a of adjusts) {
      try {
        const delta =
          (JSON.parse(a.after ?? '{}').remainingQty ?? 0) - (JSON.parse(a.before ?? '{}').remainingQty ?? 0);
        if (a.target) adjustedByTier[a.target] = (adjustedByTier[a.target] ?? 0) + delta;
      } catch {
        /* 파싱 불가한 로그는 무시 */
      }
    }

    const items = WIN_TIERS.map((tier) => {
      const rows = won.filter((r) => r.tier === tier);
      const sum = (pred: (st: string) => boolean) =>
        rows.filter((r) => pred(r.status)).reduce((a, r) => a + r.c, 0);
      const wonTotal = rows.reduce((a, r) => a + r.c, 0);
      const prize = prizeRows.find((p) => p.tier === tier);
      const adjustedQty = adjustedByTier[tier] ?? 0;
      const baseQty = DAILY_RESET_PRIZE_QTY[tier];
      const initialQty = isToday
        ? (prize?.dayStartQty ?? null)
        : baseQty === undefined ? null : baseQty + adjustedQty;
      const remainingQty = isToday
        ? (prize?.remainingQty ?? null)
        : initialQty === null ? null : Math.max(initialQty - wonTotal, 0);
      return {
        tier,
        initialQty,
        adjustedQty,
        remainingQty,
        won: wonTotal,
        wonClaimed: sum((st) => st === 'CLAIMED'),
        wonPending: sum((st) => st === 'PENDING_CLAIM'),
        wonExpired: sum((st) => st === 'EXPIRED'),
        givenOnDay: given.find((g) => g.tier === tier)?.c ?? 0,
      };
    });

    // event_config.open_at/close_at는 매일 오늘로 굴러가므로 날짜 목록은 첫 추첨일 ~ 오늘로 만든다.
    const dates: string[] = [];
    const minRow = db.prepare('SELECT MIN(created_at) AS m FROM draws WHERE is_test = 0').get() as { m: string | null };
    const first = new Date(`${vnDate(minRow.m ? new Date(minRow.m) : new Date())}T00:00:00Z`);
    const last = new Date(`${vnDate(new Date())}T00:00:00Z`);
    for (let t = first.getTime(); t <= last.getTime() && dates.length < 366; t += 24 * 3600_000) {
      dates.push(new Date(t).toISOString().slice(0, 10));
    }
    if (!dates.includes(date)) dates.push(date);

    const sumNullable = (k: 'initialQty' | 'remainingQty') =>
      items.some((i) => i[k] !== null) ? items.reduce((a, i) => a + (i[k] ?? 0), 0) : null;

    return reply.send({
      date,
      today: vnDate(new Date()),
      estimated: !isToday,
      dates: dates.sort(),
      items,
      total: {
        initialQty: sumNullable('initialQty'),
        remainingQty: sumNullable('remainingQty'),
        won: items.reduce((a, i) => a + i.won, 0),
        wonClaimed: items.reduce((a, i) => a + i.wonClaimed, 0),
        wonPending: items.reduce((a, i) => a + i.wonPending, 0),
        wonExpired: items.reduce((a, i) => a + i.wonExpired, 0),
        givenOnDay: items.reduce((a, i) => a + i.givenOnDay, 0),
      },
    });
  });

  /* ---------- 확률 설정 게시 (§9.3) ---------- */

  app.post('/api/admin/rules/validate', async (req, reply) => {
    if (!requireDashboard(req, reply)) return;
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
    if (!requireDashboard(req, reply)) return;
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

      const versionId = publishRuleVersion({
        probabilities,
        depletionPolicy,
        pacing,
        gameConfig,
        publishedBy,
        reason,
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
    if (!requireDashboard(req, reply)) return;
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
    if (!requireDashboard(req, reply)) return;
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
    if (!requireDashboard(req, reply)) return;
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
    if (!requireDashboard(req, reply)) return;
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

  /** 참가자(세션) 전체 조회 — 엑셀 내보내기와 같은 필드 + 경품명·플레이 지표. 문서: docs/api-participants.md */
  app.get('/api/admin/export/all', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const q = req.query as {
      from?: string; to?: string; status?: string; tier?: string;
      deviceId?: string; includeTest?: string; limit?: string; offset?: string;
    };
    const isDate = (v?: string) => v === undefined || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)));
    if (!isDate(q.from) || !isDate(q.to)) {
      return reply.code(400).send({ error: 'BAD_DATE', message: 'from/to must be YYYY-MM-DD' });
    }

    const where: string[] = [];
    const args: (string | number)[] = [];
    if (q.includeTest !== '1') where.push('s.is_test = 0');
    if (q.from) {
      where.push('s.created_at >= ?');
      args.push(new Date(`${q.from}T00:00:00${VN_OFFSET}`).toISOString());
    }
    if (q.to) {
      where.push('s.created_at < ?');
      args.push(new Date(new Date(`${q.to}T00:00:00${VN_OFFSET}`).getTime() + 24 * 3600_000).toISOString());
    }
    const statuses = q.status?.split(',').map((x) => x.trim()).filter(Boolean) ?? [];
    if (statuses.length) {
      where.push(`s.status IN (${statuses.map(() => '?').join(',')})`);
      args.push(...statuses);
    }
    if (q.tier) {
      where.push('d.result_tier = ?');
      args.push(q.tier);
    }
    if (q.deviceId) {
      where.push('s.device_id = ?');
      args.push(q.deviceId);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const from = `FROM sessions s
         LEFT JOIN draws d USING(session_id)
         LEFT JOIN claims c USING(session_id)
         LEFT JOIN play_metrics m USING(session_id)
         LEFT JOIN prizes p ON p.prize_id = d.prize_id
         ${whereSql}`;

    const limit = Math.min(Math.max(Math.trunc(Number(q.limit ?? 1000)) || 1000, 1), 20000);
    const offset = Math.max(Math.trunc(Number(q.offset ?? 0)) || 0, 0);

    const total = (db.prepare(`SELECT COUNT(*) AS c ${from}`).get(...args) as { c: number }).c;
    const rows = db
      .prepare(
        `SELECT s.session_id, s.device_id, s.operator_id, s.is_test, s.status, s.rule_version,
                s.created_at, s.played_at, s.closed_at, s.expires_at,
                d.result_tier, p.name AS prize_name,
                c.claim_code, c.claimed_at, c.claimed_by, c.void_reason,
                m.aim_duration_ms, m.catch_x, m.auto_catch, m.min_fps, m.fps_bucket
         ${from} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, offset) as Record<string, unknown>[];

    return reply.send({
      total,
      limit,
      offset,
      items: rows.map((r) => ({
        sessionId: r.session_id,
        deviceId: r.device_id,
        operatorId: r.operator_id,
        isTest: r.is_test === 1,
        status: r.status,
        ruleVersion: r.rule_version,
        createdAt: r.created_at,
        playedAt: r.played_at,
        closedAt: r.closed_at,
        expiresAt: r.expires_at,
        resultTier: r.result_tier ?? null,
        win: r.result_tier != null && r.result_tier !== 'miss',
        prizeName: r.prize_name ? JSON.parse(String(r.prize_name)) : null,
        claimCode: r.claim_code ?? null,
        claimedAt: r.claimed_at ?? null,
        claimedBy: r.claimed_by ?? null,
        voidReason: r.void_reason ?? null,
        aimDurationMs: r.aim_duration_ms ?? null,
        catchX: r.catch_x ?? null,
        autoCatch: r.auto_catch == null ? null : r.auto_catch === 1,
        minFps: r.min_fps ?? null,
        fpsBucket: r.fps_bucket ?? null,
      })),
    });
  });

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
