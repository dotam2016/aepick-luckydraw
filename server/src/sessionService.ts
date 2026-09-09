/**
 * 세션 · 추첨 · 재고 · 지급 서비스 — 기획서 v1.1 §5, §10.2, 부록 B
 *
 * 이 모듈이 Layer 2(세션 상태)의 유일한 소유자다.
 * 모든 상태 전이는 여기를 거치고, 부록 B 전이표를 위반하면 거부한다.
 */

import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import {
  WIN_TIERS,
  allAvailable,
  canTransition,
  drawResult,
  generateClaimCode,
  isPacingBlocked,
  isWinTier,
  normalizeClaimCode,
  resolveBucket,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type MotionPlan,
  type PendingClaimItem,
  type PlayedRequest,
  type ResultTier,
  type RevealPlan,
  type SessionStatus,
  type TierAvailability,
  type WinTier,
} from '@aepick/shared';
import {
  db,
  getActiveRule,
  getEventConfig,
  getPrizeByTier,
  getRule,
  listPrizes,
  logAudit,
  logSessionEvent,
  transact,
} from './db.js';

export class ServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const rb = (n: number) => new Uint8Array(randomBytes(n));

/* ---------------- 상태 전이 ---------------- */

interface SessionRow {
  session_id: string;
  device_id: string;
  operator_id: string;
  is_test: number;
  rule_version: number;
  status: SessionStatus;
  result_token: string;
  physics_seed: number;
  created_at: string;
  played_at: string | null;
  closed_at: string | null;
  expires_at: string | null;
}

function getSessionRow(sessionId: string): SessionRow {
  const row = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId) as
    | SessionRow
    | undefined;
  if (!row) throw new ServiceError('SESSION_NOT_FOUND', '세션을 찾을 수 없습니다.', 404);
  return row;
}

function setStatus(sessionId: string, from: SessionStatus, to: SessionStatus, actor: string, note?: string) {
  if (!canTransition(from, to)) {
    throw new ServiceError(
      'INVALID_TRANSITION',
      `허용되지 않은 상태 전이입니다: ${from} → ${to}`,
      409,
    );
  }
  db.prepare('UPDATE sessions SET status = ? WHERE session_id = ?').run(to, sessionId);
  db.prepare('UPDATE claims SET claim_status = ? WHERE session_id = ?').run(to, sessionId);
  logSessionEvent(sessionId, from, to, actor, note);
}

/* ---------------- 재고 가용성 판정 (§5.3 / §5.4) ---------------- */

function countTierWins(tier: WinTier, since: string, until?: string): number {
  const sql = until
    ? `SELECT COUNT(*) AS c FROM draws d JOIN sessions s USING(session_id)
       WHERE d.result_tier = ? AND d.is_test = 0 AND d.created_at >= ? AND d.created_at < ?
         AND s.status NOT IN ('VOIDED','ABORTED')`
    : `SELECT COUNT(*) AS c FROM draws d JOIN sessions s USING(session_id)
       WHERE d.result_tier = ? AND d.is_test = 0 AND d.created_at >= ?
         AND s.status NOT IN ('VOIDED','ABORTED')`;
  const args = until ? [tier, since, until] : [tier, since];
  const row = db.prepare(sql).get(...args) as { c: number };
  return row.c;
}

function countTierWinsAllTime(tier: WinTier): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM draws d JOIN sessions s USING(session_id)
       WHERE d.result_tier = ? AND d.is_test = 0 AND s.status NOT IN ('VOIDED','ABORTED')`,
    )
    .get(tier) as { c: number };
  return row.c;
}

export interface AvailabilityReport {
  availability: Record<WinTier, TierAvailability>;
  quotas: Record<string, number>;
}

export function computeAvailability(now = new Date()): AvailabilityReport {
  const rule = getActiveRule();
  const event = getEventConfig();
  const openAt = new Date(event.openAt);
  const closeAt = new Date(event.closeAt);
  const bucket = resolveBucket(now, openAt, closeAt, rule.pacing.bucketMinutes);

  const availability = allAvailable();
  const quotas: Record<string, number> = {};
  const prizes = listPrizes();

  for (const tier of WIN_TIERS) {
    const prize = prizes.find((p) => p.tier === tier);

    if (!prize || !prize.active) {
      availability[tier] = { available: false, reason: 'inactive' };
      continue;
    }
    if (prize.remainingQty <= 0) {
      availability[tier] = { available: false, reason: 'noStock' };
      continue;
    }
    if (prize.eventCap !== null && countTierWinsAllTime(tier) >= prize.eventCap) {
      availability[tier] = { available: false, reason: 'eventCap' };
      continue;
    }
    if (prize.dailyCap !== null && countTierWins(tier, event.openAt) >= prize.dailyCap) {
      availability[tier] = { available: false, reason: 'dailyCap' };
      continue;
    }

    const winsInBucket = countTierWins(tier, bucket.start.toISOString(), bucket.end.toISOString());
    const pacingInput = {
      pacing: rule.pacing,
      tier,
      now,
      openAt,
      closeAt,
      remainingQty: prize.remainingQty,
      dayStartQty: prize.dayStartQty,
      winsInBucket,
    };
    quotas[tier] = winsInBucket;
    if (isPacingBlocked(pacingInput)) {
      availability[tier] = { available: false, reason: 'pacingQuota' };
      continue;
    }
    availability[tier] = { available: true };
  }

  return { availability, quotas };
}

/* ---------------- 세션 생성 + 추첨 (§10.2 POST /sessions) ---------------- */

function motionFor(tier: ResultTier, seed: number, revealMode: MotionPlan['revealMode']): MotionPlan {
  const win = isWinTier(tier);
  const effectLevel: MotionPlan['effectLevel'] =
    tier === 't1' || tier === 't2' ? 3 : tier === 't3' ? 2 : 1;
  return {
    win,
    // §16.2 — 미획득 연출 최소 3종 변형
    missVariant: seed % 3,
    effectLevel: win ? effectLevel : 1,
    revealMode,
  };
}

function reserveStock(tier: WinTier): string {
  // 조건부 UPDATE — 동시 요청에서도 remaining_qty가 음수가 될 수 없다
  const res = db
    .prepare(
      `UPDATE prizes SET remaining_qty = remaining_qty - 1, reserved_qty = reserved_qty + 1
       WHERE tier = ? AND active = 1 AND remaining_qty > 0`,
    )
    .run(tier);
  if (res.changes === 0) {
    throw new ServiceError('STOCK_RACE', '재고 예약에 실패했습니다. 다시 시도해 주세요.', 409);
  }
  const prize = getPrizeByTier(tier);
  if (!prize) throw new ServiceError('PRIZE_NOT_FOUND', '경품을 찾을 수 없습니다.', 500);
  return prize.prizeId;
}

function issueClaimCode(): string {
  // §10.3 — 유니크 인덱스로 보장, 충돌 시 최대 5회 재생성
  for (let i = 0; i < 5; i++) {
    const code = generateClaimCode(rb);
    const dup = db.prepare('SELECT 1 FROM claims WHERE claim_code = ?').get(code);
    if (!dup) return code;
  }
  throw new ServiceError('CODE_COLLISION', '세션 코드 생성에 실패했습니다.', 500);
}

export function createSession(req: CreateSessionRequest): CreateSessionResponse {
  if (!req.idempotencyKey) {
    throw new ServiceError('MISSING_IDEMPOTENCY_KEY', 'idempotencyKey는 필수입니다.');
  }

  // 멱등성: 동일 키 재요청은 최초 응답을 그대로 반환한다 (§10.2)
  const existing = db
    .prepare('SELECT response FROM idempotency WHERE key = ?')
    .get(req.idempotencyKey) as { response: string } | undefined;
  if (existing) return JSON.parse(existing.response) as CreateSessionResponse;

  const event = getEventConfig();
  if (!event.eventOn) throw new ServiceError('EVENT_OFF', '행사가 종료되었습니다.', 409);
  if (event.emergencyStop) throw new ServiceError('EMERGENCY_STOP', '긴급 중지 상태입니다.', 409);

  const isTest = req.isTest === true;
  if (req.forceTier && !isTest) {
    throw new ServiceError('FORCE_TIER_NOT_ALLOWED', '등급 강제 지정은 테스트 세션에서만 허용됩니다.');
  }

  // 한 기기에서 동시에 활성화될 수 있는 플레이 세션은 1개뿐이다 (§11 불변 규칙)
  const openSession = db
    .prepare(
      `SELECT session_id FROM sessions
       WHERE device_id = ? AND is_test = 0 AND status IN ('CREATED','DRAWN') LIMIT 1`,
    )
    .get(req.deviceId) as { session_id: string } | undefined;
  if (openSession && !isTest) {
    throw new ServiceError(
      'SESSION_IN_PROGRESS',
      `미완료 세션이 있습니다: ${openSession.session_id}. 이어하기 또는 무효 처리가 필요합니다.`,
      409,
    );
  }

  return transact(() => {
    const rule = getActiveRule();
    const now = new Date();
    const nowIso = now.toISOString();
    const sessionId = randomUUID();
    const resultToken = randomBytes(24).toString('base64url');
    const physicsSeed = randomInt(1, 2 ** 31 - 1);

    const { availability } = computeAvailability(now);

    let tier: ResultTier;
    let rollMilli = -1;
    let effective: Record<string, number> = {};
    let blocked: Record<string, string> = {};

    if (req.forceTier) {
      tier = req.forceTier;
    } else {
      const outcome = drawResult({
        probabilities: rule.probabilities,
        depletionPolicy: rule.depletionPolicy,
        availability,
        rng: () => randomInt(0, 2 ** 31) / 2 ** 31,
      });
      tier = outcome.tier;
      rollMilli = outcome.rollMilli;
      effective = outcome.effectiveMilli;
      blocked = outcome.blocked as Record<string, string>;
    }

    // 테스트 세션은 재고를 예약·차감하지 않는다 (§5.6)
    let prizeId: string | null = null;
    let claimCode: string | null = null;
    if (isWinTier(tier) && !isTest) {
      prizeId = reserveStock(tier);
      claimCode = issueClaimCode();
    } else if (isWinTier(tier) && isTest) {
      const prize = getPrizeByTier(tier);
      prizeId = prize?.prizeId ?? null;
    }

    db.prepare(
      `INSERT INTO sessions
       (session_id, device_id, operator_id, is_test, rule_version, status, result_token, physics_seed, created_at)
       VALUES (?, ?, ?, ?, ?, 'CREATED', ?, ?, ?)`,
    ).run(
      sessionId,
      req.deviceId,
      req.operatorId,
      isTest ? 1 : 0,
      rule.versionId,
      resultToken,
      physicsSeed,
      nowIso,
    );
    logSessionEvent(sessionId, null, 'CREATED', req.operatorId);

    db.prepare(
      `INSERT INTO draws
       (session_id, result_tier, prize_id, random_token, roll_milli, effective, blocked_tiers, created_at, is_test)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      sessionId,
      tier,
      prizeId,
      randomBytes(16).toString('hex'),
      rollMilli,
      JSON.stringify(effective),
      JSON.stringify(blocked),
      nowIso,
      isTest ? 1 : 0,
    );

    db.prepare(
      `INSERT INTO claims (session_id, claim_code, claim_status) VALUES (?, ?, 'DRAWN')`,
    ).run(sessionId, claimCode);

    setStatus(sessionId, 'CREATED', 'DRAWN', req.operatorId, `tier=${isTest ? tier : 'sealed'}`);

    const response: CreateSessionResponse = {
      sessionId,
      resultToken,
      motion: motionFor(tier, physicsSeed, rule.gameConfig.revealMode),
      ruleVersion: rule.versionId,
      physicsSeed,
      game: rule.gameConfig,
      isTest,
      createdAt: nowIso,
    };

    db.prepare(
      'INSERT INTO idempotency (key, session_id, response, created_at) VALUES (?, ?, ?, ?)',
    ).run(req.idempotencyKey, sessionId, JSON.stringify(response), nowIso);

    return response;
  });
}

/* ---------------- 플레이 완료 (§10.2 POST /sessions/:id/played) ---------------- */

export function markPlayed(sessionId: string, body: PlayedRequest): { status: SessionStatus } {
  return transact(() => {
    const s = getSessionRow(sessionId);
    if (s.status === 'PLAYED' || s.status === 'PENDING_CLAIM' || s.status === 'CLAIMED') {
      return { status: s.status }; // 재전송 흡수
    }
    if (s.status !== 'DRAWN') {
      throw new ServiceError('INVALID_STATE', `플레이 완료를 기록할 수 없는 상태입니다: ${s.status}`, 409);
    }

    const now = new Date();
    db.prepare(
      `INSERT OR REPLACE INTO play_metrics
       (session_id, aim_duration_ms, catch_x, auto_catch, min_fps, fps_bucket, physics_seed, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      sessionId,
      Math.round(body.aimDurationMs),
      body.catchX,
      body.autoCatch ? 1 : 0,
      body.minFps,
      fpsBucket(body.minFps),
      body.physicsSeed,
      now.toISOString(),
    );

    db.prepare('UPDATE sessions SET played_at = ? WHERE session_id = ?').run(
      now.toISOString(),
      sessionId,
    );
    setStatus(sessionId, 'DRAWN', 'PLAYED', 'client');

    const draw = db.prepare('SELECT result_tier FROM draws WHERE session_id = ?').get(sessionId) as {
      result_tier: ResultTier;
    };

    // 부록 B: 당첨은 PENDING_CLAIM, 꽝은 지급 대상이 없으므로 즉시 종료
    if (isWinTier(draw.result_tier) && !(s.is_test === 1)) {
      const event = getEventConfig();
      const expires = new Date(now.getTime() + event.claimTtlHours * 3_600_000);
      const closeAt = new Date(event.closeAt);
      const expiresAt = new Date(Math.min(expires.getTime(), closeAt.getTime()));
      db.prepare('UPDATE sessions SET expires_at = ? WHERE session_id = ?').run(
        expiresAt.toISOString(),
        sessionId,
      );
      setStatus(sessionId, 'PLAYED', 'PENDING_CLAIM', 'system');
      return { status: 'PENDING_CLAIM' as SessionStatus };
    }

    db.prepare('UPDATE sessions SET closed_at = ? WHERE session_id = ?').run(
      now.toISOString(),
      sessionId,
    );
    setStatus(sessionId, 'PLAYED', 'CLAIMED', 'system', '지급 대상 없음');
    return { status: 'CLAIMED' as SessionStatus };
  });
}

function fpsBucket(minFps: number): string {
  if (minFps >= 55) return '55+';
  if (minFps >= 45) return '45-55';
  if (minFps >= 30) return '30-45';
  return '<30';
}

/* ---------------- 결과 상세 조회 (REVEAL 시점) ---------------- */

export function getReveal(sessionId: string, token: string): RevealPlan {
  const s = getSessionRow(sessionId);
  if (s.result_token !== token) {
    throw new ServiceError('INVALID_RESULT_TOKEN', '결과 토큰이 일치하지 않습니다.', 403);
  }

  const draw = db
    .prepare('SELECT result_tier, prize_id FROM draws WHERE session_id = ?')
    .get(sessionId) as { result_tier: ResultTier; prize_id: string | null };
  const claim = db.prepare('SELECT claim_code FROM claims WHERE session_id = ?').get(sessionId) as {
    claim_code: string | null;
  };
  const rule = getRule(s.rule_version) ?? getActiveRule();

  const win = isWinTier(draw.result_tier);
  let prize: RevealPlan['prize'] = null;
  if (win && draw.prize_id) {
    const row = db
      .prepare('SELECT tier, name, image_key FROM prizes WHERE prize_id = ?')
      .get(draw.prize_id) as { tier: WinTier; name: string; image_key: string | null } | undefined;
    if (row) prize = { tier: row.tier, name: JSON.parse(row.name), imageKey: row.image_key };
  }

  return {
    win,
    tier: draw.result_tier,
    prize,
    claimCode: claim?.claim_code ?? null,
    effectLevel: motionFor(draw.result_tier, s.physics_seed, rule.gameConfig.revealMode).effectLevel,
    isTest: s.is_test === 1,
    resultSeconds: win ? rule.gameConfig.resultSecondsWin : rule.gameConfig.resultSecondsMiss,
  };
}

/* ---------------- 지급 (§6.4 / §10.2 POST /sessions/:id/claim) ---------------- */

export function claimByCode(rawCode: string, operatorId: string): { sessionId: string; tier: ResultTier } {
  const code = normalizeClaimCode(rawCode);
  const row = db
    .prepare('SELECT session_id, claim_status, claimed_at, claimed_by FROM claims WHERE claim_code = ?')
    .get(code) as
    | { session_id: string; claim_status: SessionStatus; claimed_at: string | null; claimed_by: string | null }
    | undefined;

  if (!row) throw new ServiceError('CODE_NOT_FOUND', '해당 코드를 찾을 수 없습니다.', 404);
  if (row.claim_status === 'CLAIMED') {
    throw new ServiceError(
      'ALREADY_CLAIMED',
      `이미 지급된 코드입니다. 지급 시각 ${row.claimed_at}, 처리자 ${row.claimed_by}`,
      409,
    );
  }
  if (row.claim_status === 'VOIDED') {
    throw new ServiceError('ALREADY_VOIDED', '무효 처리된 세션입니다.', 409);
  }
  return claimSession(row.session_id, operatorId);
}

export function claimSession(sessionId: string, operatorId: string): { sessionId: string; tier: ResultTier } {
  return transact(() => {
    const s = getSessionRow(sessionId);
    if (s.status === 'CLAIMED') {
      throw new ServiceError('ALREADY_CLAIMED', '이미 지급 완료된 세션입니다.', 409);
    }
    if (s.status !== 'PENDING_CLAIM' && s.status !== 'EXPIRED') {
      throw new ServiceError('INVALID_STATE', `지급할 수 없는 상태입니다: ${s.status}`, 409);
    }

    const draw = db
      .prepare('SELECT result_tier, prize_id FROM draws WHERE session_id = ?')
      .get(sessionId) as { result_tier: ResultTier; prize_id: string | null };

    if (draw.prize_id) {
      const res = db
        .prepare(
          `UPDATE prizes SET reserved_qty = reserved_qty - 1, claimed_qty = claimed_qty + 1
           WHERE prize_id = ? AND reserved_qty > 0`,
        )
        .run(draw.prize_id);
      if (res.changes === 0) {
        throw new ServiceError('RESERVATION_MISSING', '예약된 재고를 찾을 수 없습니다.', 409);
      }
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE claims SET claimed_at = ?, claimed_by = ? WHERE session_id = ?').run(
      now,
      operatorId,
      sessionId,
    );
    db.prepare('UPDATE sessions SET closed_at = ? WHERE session_id = ?').run(now, sessionId);
    setStatus(sessionId, s.status, 'CLAIMED', operatorId);
    logAudit(operatorId, 'claim', { target: sessionId, after: { tier: draw.result_tier } });

    return { sessionId, tier: draw.result_tier };
  });
}

/* ---------------- 무효 처리 ---------------- */

export function voidSession(sessionId: string, reason: string, actor: string): { sessionId: string } {
  if (!reason) throw new ServiceError('REASON_REQUIRED', '무효 처리는 사유가 필수입니다.');

  return transact(() => {
    const s = getSessionRow(sessionId);
    if (!canTransition(s.status, 'VOIDED')) {
      throw new ServiceError('INVALID_STATE', `무효 처리할 수 없는 상태입니다: ${s.status}`, 409);
    }

    const draw = db.prepare('SELECT prize_id FROM draws WHERE session_id = ?').get(sessionId) as
      | { prize_id: string | null }
      | undefined;

    // 예약 재고 복원 (§5.5 voided)
    if (draw?.prize_id) {
      db.prepare(
        `UPDATE prizes SET reserved_qty = reserved_qty - 1, remaining_qty = remaining_qty + 1
         WHERE prize_id = ? AND reserved_qty > 0`,
      ).run(draw.prize_id);
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE claims SET void_reason = ? WHERE session_id = ?').run(reason, sessionId);
    db.prepare('UPDATE sessions SET closed_at = ? WHERE session_id = ?').run(now, sessionId);
    setStatus(sessionId, s.status, 'VOIDED', actor, reason);
    logAudit(actor, 'void', { target: sessionId, reason });

    return { sessionId };
  });
}

/** 미완료 세션 정리 — 부록 B의 ABORTED 경로 */
export function abortSession(sessionId: string, actor: string, note = '미완료 세션 정리'): void {
  transact(() => {
    const s = getSessionRow(sessionId);
    if (!canTransition(s.status, 'ABORTED')) {
      throw new ServiceError('INVALID_STATE', `중단 처리할 수 없는 상태입니다: ${s.status}`, 409);
    }
    const draw = db.prepare('SELECT prize_id FROM draws WHERE session_id = ?').get(sessionId) as
      | { prize_id: string | null }
      | undefined;
    if (draw?.prize_id) {
      db.prepare(
        `UPDATE prizes SET reserved_qty = reserved_qty - 1, remaining_qty = remaining_qty + 1
         WHERE prize_id = ? AND reserved_qty > 0`,
      ).run(draw.prize_id);
    }
    db.prepare('UPDATE sessions SET closed_at = ? WHERE session_id = ?').run(
      new Date().toISOString(),
      sessionId,
    );
    setStatus(sessionId, s.status, 'ABORTED', actor, note);
  });
}

/* ---------------- 지급 큐 (§6.4) ---------------- */

export function listPendingClaims(includeExpired = true): PendingClaimItem[] {
  const statuses = includeExpired ? `('PENDING_CLAIM','EXPIRED')` : `('PENDING_CLAIM')`;
  const rows = db
    .prepare(
      `SELECT s.session_id, s.device_id, s.played_at, s.expires_at, s.status,
              c.claim_code, d.result_tier, p.name AS prize_name
       FROM sessions s
       JOIN claims c USING(session_id)
       JOIN draws  d USING(session_id)
       LEFT JOIN prizes p ON p.prize_id = d.prize_id
       WHERE s.status IN ${statuses} AND s.is_test = 0
       ORDER BY s.played_at DESC`,
    )
    .all() as {
    session_id: string;
    device_id: string;
    played_at: string | null;
    expires_at: string | null;
    status: SessionStatus;
    claim_code: string | null;
    result_tier: WinTier;
    prize_name: string | null;
  }[];

  const now = Date.now();
  return rows.map((r) => ({
    sessionId: r.session_id,
    claimCode: r.claim_code ?? '',
    tier: r.result_tier,
    prizeName: r.prize_name ? JSON.parse(r.prize_name) : { vi: '-', en: '-', ko: '-' },
    deviceId: r.device_id,
    playedAt: r.played_at ?? '',
    expiresAt: r.expires_at ?? '',
    elapsedMinutes: r.played_at ? Math.floor((now - new Date(r.played_at).getTime()) / 60_000) : 0,
  }));
}

/* ---------------- 만료 배치 ---------------- */

export function expirePendingClaims(now = new Date()): number {
  const rows = db
    .prepare(
      `SELECT session_id, status FROM sessions
       WHERE status = 'PENDING_CLAIM' AND expires_at IS NOT NULL AND expires_at <= ?`,
    )
    .all(now.toISOString()) as { session_id: string; status: SessionStatus }[];

  for (const r of rows) {
    transact(() => setStatus(r.session_id, 'PENDING_CLAIM', 'EXPIRED', 'system', '지급 기한 경과'));
  }
  return rows.length;
}

/** 플레이가 시작되지 않은 채 오래 남은 세션 정리 */
export function abortStaleSessions(maxAgeMinutes = 30, now = new Date()): number {
  const cutoff = new Date(now.getTime() - maxAgeMinutes * 60_000).toISOString();
  const rows = db
    .prepare(
      `SELECT session_id FROM sessions
       WHERE status IN ('CREATED','DRAWN') AND created_at <= ?`,
    )
    .all(cutoff) as { session_id: string }[];

  for (const r of rows) {
    try {
      abortSession(r.session_id, 'system', '미완료 세션 자동 정리');
    } catch {
      /* 이미 전이된 경우 무시 */
    }
  }
  return rows.length;
}

/* ---------------- 미완료 세션 조회 (§12 복구) ---------------- */

export function findRecoverableSession(deviceId: string) {
  const row = db
    .prepare(
      `SELECT s.session_id, s.status, s.created_at, s.result_token, s.physics_seed, s.rule_version, s.is_test
       FROM sessions s
       WHERE s.device_id = ? AND s.status IN ('CREATED','DRAWN')
       ORDER BY s.created_at DESC LIMIT 1`,
    )
    .get(deviceId) as
    | {
        session_id: string;
        status: SessionStatus;
        created_at: string;
        result_token: string;
        physics_seed: number;
        rule_version: number;
        is_test: number;
      }
    | undefined;
  if (!row) return null;

  const draw = db.prepare('SELECT result_tier FROM draws WHERE session_id = ?').get(row.session_id) as
    | { result_tier: ResultTier }
    | undefined;
  const rule = getRule(row.rule_version) ?? getActiveRule();

  return {
    sessionId: row.session_id,
    status: row.status,
    createdAt: row.created_at,
    resultToken: row.result_token,
    physicsSeed: row.physics_seed,
    ruleVersion: row.rule_version,
    isTest: row.is_test === 1,
    game: rule.gameConfig,
    motion: draw
      ? motionFor(draw.result_tier, row.physics_seed, rule.gameConfig.revealMode)
      : null,
  };
}
