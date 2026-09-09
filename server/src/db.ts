/**
 * 스키마 및 DB 접근 — 기획서 v1.1 §10.1
 *
 * node:sqlite (Node 22.13+ 내장)를 사용해 네이티브 빌드 의존성을 없앤다.
 * 재고 예약은 BEGIN IMMEDIATE 트랜잭션 + 조건부 UPDATE로 직렬화하여
 * "잔여 수량이 음수가 되는 경로를 원천 차단"한다 (§10.2, §16.3).
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  DEFAULT_DEPLETION_POLICY,
  DEFAULT_EVENT_CONFIG,
  DEFAULT_GAME_CONFIG,
  DEFAULT_PACING,
  DEFAULT_PROBABILITIES,
  WIN_TIERS,
  type EventConfig,
  type GameConfig,
  type LocalizedText,
  type Prize,
  type RuleVersion,
  type SessionStatus,
  type WinTier,
} from '@aepick/shared';

export const DB_PATH = process.env.DB_PATH
  ? resolve(process.env.DB_PATH)
  : resolve(process.cwd(), 'data', 'luckydraw.sqlite');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

/* ---------------- 스키마 ---------------- */

db.exec(`
CREATE TABLE IF NOT EXISTS rule_versions (
  version_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  probabilities    TEXT NOT NULL,
  depletion_policy TEXT NOT NULL,
  pacing           TEXT NOT NULL,
  game_config      TEXT NOT NULL,
  published_at     TEXT NOT NULL,
  published_by     TEXT NOT NULL,
  reason           TEXT NOT NULL,
  is_active        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS prizes (
  prize_id     TEXT PRIMARY KEY,
  tier         TEXT NOT NULL,
  name         TEXT NOT NULL,
  image_key    TEXT,
  total_qty    INTEGER NOT NULL,
  remaining_qty INTEGER NOT NULL,
  reserved_qty INTEGER NOT NULL DEFAULT 0,
  claimed_qty  INTEGER NOT NULL DEFAULT 0,
  daily_cap    INTEGER,
  event_cap    INTEGER,
  active       INTEGER NOT NULL DEFAULT 1,
  day_start_qty INTEGER NOT NULL DEFAULT 0,
  CHECK (remaining_qty >= 0),
  CHECK (reserved_qty >= 0)
);

CREATE TABLE IF NOT EXISTS event_config (
  id                    INTEGER PRIMARY KEY CHECK (id = 1),
  event_on              INTEGER NOT NULL,
  emergency_stop        INTEGER NOT NULL,
  open_at               TEXT NOT NULL,
  close_at              TEXT NOT NULL,
  claim_ttl_hours       INTEGER NOT NULL,
  offline_grace_seconds INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id   TEXT PRIMARY KEY,
  device_id    TEXT NOT NULL,
  operator_id  TEXT NOT NULL,
  is_test      INTEGER NOT NULL DEFAULT 0,
  rule_version INTEGER NOT NULL,
  status       TEXT NOT NULL,
  result_token TEXT NOT NULL,
  physics_seed INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  played_at    TEXT,
  closed_at    TEXT,
  expires_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_status  ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at);

CREATE TABLE IF NOT EXISTS draws (
  session_id    TEXT PRIMARY KEY REFERENCES sessions(session_id),
  result_tier   TEXT NOT NULL,
  prize_id      TEXT,
  random_token  TEXT NOT NULL,
  roll_milli    INTEGER NOT NULL,
  effective     TEXT NOT NULL,
  blocked_tiers TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  is_test       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_draws_tier_time ON draws(result_tier, created_at);

CREATE TABLE IF NOT EXISTS claims (
  session_id   TEXT PRIMARY KEY REFERENCES sessions(session_id),
  claim_code   TEXT UNIQUE,
  claim_status TEXT NOT NULL,
  claimed_at   TEXT,
  claimed_by   TEXT,
  void_reason  TEXT
);
CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(claim_status);

CREATE TABLE IF NOT EXISTS play_metrics (
  session_id      TEXT PRIMARY KEY REFERENCES sessions(session_id),
  aim_duration_ms INTEGER NOT NULL,
  catch_x         REAL NOT NULL,
  auto_catch      INTEGER NOT NULL,
  min_fps         REAL NOT NULL,
  fps_bucket      TEXT NOT NULL,
  physics_seed    INTEGER NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  at          TEXT NOT NULL,
  actor       TEXT NOT NULL,
  note        TEXT
);
CREATE INDEX IF NOT EXISTS idx_session_events_sid ON session_events(session_id);

CREATE TABLE IF NOT EXISTS idempotency (
  key        TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  response   TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  at     TEXT NOT NULL,
  actor  TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  before TEXT,
  after  TEXT,
  reason TEXT
);

CREATE TABLE IF NOT EXISTS app_errors (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      TEXT,
  error_code      TEXT NOT NULL,
  network_state   TEXT,
  app_version     TEXT,
  recovery_action TEXT,
  at              TEXT NOT NULL
);
`);

/* ---------------- 시드 ---------------- */

const PRIZE_SEED: { tier: WinTier; name: LocalizedText; qty: number; dailyCap: number | null }[] = [
  { tier: 't1', name: { vi: 'Quà Giải Nhất', en: '1st Prize', ko: '1등 경품' }, qty: 3, dailyCap: 1 },
  { tier: 't2', name: { vi: 'Quà Giải Nhì', en: '2nd Prize', ko: '2등 경품' }, qty: 10, dailyCap: 3 },
  { tier: 't3', name: { vi: 'Quà Giải Ba', en: '3rd Prize', ko: '3등 경품' }, qty: 30, dailyCap: 8 },
  { tier: 't4', name: { vi: 'Quà Giải Tư', en: '4th Prize', ko: '4등 경품' }, qty: 120, dailyCap: null },
  { tier: 't5', name: { vi: 'Quà Giải Năm', en: '5th Prize', ko: '5등 경품' }, qty: 300, dailyCap: null },
];

function todayWindow(): { openAt: string; closeAt: string } {
  const now = new Date();
  const open = new Date(now);
  open.setHours(10, 0, 0, 0);
  const close = new Date(now);
  close.setHours(20, 0, 0, 0);
  return { openAt: open.toISOString(), closeAt: close.toISOString() };
}

export function seedIfEmpty(): void {
  const ruleCount = db.prepare('SELECT COUNT(*) AS c FROM rule_versions').get() as { c: number };
  if (ruleCount.c === 0) {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO rule_versions
       (probabilities, depletion_policy, pacing, game_config, published_at, published_by, reason, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    ).run(
      JSON.stringify(DEFAULT_PROBABILITIES),
      DEFAULT_DEPLETION_POLICY,
      JSON.stringify(DEFAULT_PACING),
      JSON.stringify(DEFAULT_GAME_CONFIG),
      now,
      'system',
      '초기 시드 (기획서 §5.2 기본값 — 실제 행사 확률 아님)',
    );
  }

  const prizeCount = db.prepare('SELECT COUNT(*) AS c FROM prizes').get() as { c: number };
  if (prizeCount.c === 0) {
    const stmt = db.prepare(
      `INSERT INTO prizes
       (prize_id, tier, name, image_key, total_qty, remaining_qty, reserved_qty, claimed_qty, daily_cap, event_cap, active, day_start_qty)
       VALUES (?, ?, ?, NULL, ?, ?, 0, 0, ?, NULL, 1, ?)`,
    );
    for (const p of PRIZE_SEED) {
      stmt.run(`prize-${p.tier}`, p.tier, JSON.stringify(p.name), p.qty, p.qty, p.dailyCap, p.qty);
    }
  }

  const evCount = db.prepare('SELECT COUNT(*) AS c FROM event_config').get() as { c: number };
  if (evCount.c === 0) {
    const { openAt, closeAt } = todayWindow();
    db.prepare(
      `INSERT INTO event_config
       (id, event_on, emergency_stop, open_at, close_at, claim_ttl_hours, offline_grace_seconds)
       VALUES (1, 1, 0, ?, ?, ?, ?)`,
    ).run(
      openAt,
      closeAt,
      DEFAULT_EVENT_CONFIG.claimTtlHours,
      DEFAULT_EVENT_CONFIG.offlineGraceSeconds,
    );
  }
}

/* ---------------- 조회 헬퍼 ---------------- */

interface RuleRow {
  version_id: number;
  probabilities: string;
  depletion_policy: string;
  pacing: string;
  game_config: string;
  published_at: string;
  published_by: string;
  reason: string;
}

export function getActiveRule(): RuleVersion & { gameConfig: GameConfig } {
  const row = db
    .prepare('SELECT * FROM rule_versions WHERE is_active = 1 ORDER BY version_id DESC LIMIT 1')
    .get() as RuleRow | undefined;
  if (!row) throw new Error('활성 설정 버전이 없습니다.');
  return {
    versionId: row.version_id,
    probabilities: JSON.parse(row.probabilities),
    depletionPolicy: row.depletion_policy as RuleVersion['depletionPolicy'],
    pacing: JSON.parse(row.pacing),
    gameConfig: JSON.parse(row.game_config),
    publishedAt: row.published_at,
    publishedBy: row.published_by,
    reason: row.reason,
  };
}

export function getRule(versionId: number): (RuleVersion & { gameConfig: GameConfig }) | null {
  const row = db.prepare('SELECT * FROM rule_versions WHERE version_id = ?').get(versionId) as
    | RuleRow
    | undefined;
  if (!row) return null;
  return {
    versionId: row.version_id,
    probabilities: JSON.parse(row.probabilities),
    depletionPolicy: row.depletion_policy as RuleVersion['depletionPolicy'],
    pacing: JSON.parse(row.pacing),
    gameConfig: JSON.parse(row.game_config),
    publishedAt: row.published_at,
    publishedBy: row.published_by,
    reason: row.reason,
  };
}

interface PrizeRow {
  prize_id: string;
  tier: string;
  name: string;
  image_key: string | null;
  total_qty: number;
  remaining_qty: number;
  reserved_qty: number;
  claimed_qty: number;
  daily_cap: number | null;
  event_cap: number | null;
  active: number;
  day_start_qty: number;
}

function mapPrize(r: PrizeRow): Prize & { dayStartQty: number } {
  return {
    prizeId: r.prize_id,
    tier: r.tier as WinTier,
    name: JSON.parse(r.name),
    imageKey: r.image_key,
    totalQty: r.total_qty,
    remainingQty: r.remaining_qty,
    reservedQty: r.reserved_qty,
    claimedQty: r.claimed_qty,
    dailyCap: r.daily_cap,
    eventCap: r.event_cap,
    active: r.active === 1,
    dayStartQty: r.day_start_qty,
  };
}

export function listPrizes(): (Prize & { dayStartQty: number })[] {
  const rows = db.prepare('SELECT * FROM prizes ORDER BY tier').all() as unknown as PrizeRow[];
  return rows.map(mapPrize);
}

export function getPrizeByTier(tier: WinTier): (Prize & { dayStartQty: number }) | null {
  const row = db
    .prepare('SELECT * FROM prizes WHERE tier = ? ORDER BY remaining_qty DESC LIMIT 1')
    .get(tier) as PrizeRow | undefined;
  return row ? mapPrize(row) : null;
}

export function getEventConfig(): EventConfig {
  const row = db.prepare('SELECT * FROM event_config WHERE id = 1').get() as {
    event_on: number;
    emergency_stop: number;
    open_at: string;
    close_at: string;
    claim_ttl_hours: number;
    offline_grace_seconds: number;
  };
  return {
    eventOn: row.event_on === 1,
    emergencyStop: row.emergency_stop === 1,
    openAt: row.open_at,
    closeAt: row.close_at,
    claimTtlHours: row.claim_ttl_hours,
    offlineGraceSeconds: row.offline_grace_seconds,
  };
}

/* ---------------- 로그 ---------------- */

export function logSessionEvent(
  sessionId: string,
  from: SessionStatus | null,
  to: SessionStatus,
  actor: string,
  note?: string,
): void {
  db.prepare(
    'INSERT INTO session_events (session_id, from_status, to_status, at, actor, note) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(sessionId, from, to, new Date().toISOString(), actor, note ?? null);
}

export function logAudit(
  actor: string,
  action: string,
  opts: { target?: string; before?: unknown; after?: unknown; reason?: string } = {},
): void {
  db.prepare(
    'INSERT INTO audit_log (at, actor, action, target, before, after, reason) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    new Date().toISOString(),
    actor,
    action,
    opts.target ?? null,
    opts.before === undefined ? null : JSON.stringify(opts.before),
    opts.after === undefined ? null : JSON.stringify(opts.after),
    opts.reason ?? null,
  );
}

/* ---------------- 트랜잭션 ---------------- */

export function transact<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* 이미 롤백된 경우 무시 */
    }
    throw err;
  }
}
