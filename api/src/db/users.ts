// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { getDb } from './connection.js';
import type { User, Organization } from '../shared/types.js';

interface DbUserRow {
  id: string;
  email: string;
  name: string | null;
  organization_id: string | null;
  tier: string;
  is_admin: number;
  token_budget: number;
  created_at: string;
  last_seen: string | null;
}

interface DbOrgRow {
  id: string;
  name: string;
  join_code: string;
  created_by: string | null;
  created_at: string;
}

function generateJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 8 }, () => chars[randomInt(0, chars.length)]).join('');
}

function rowToUser(row: DbUserRow): User {
  return {
    id: row.id,
    email: row.email,
    ...(row.name != null ? { name: row.name } : {}),
    organizationId: row.organization_id,
    tier: row.tier ?? 'starter',
    isAdmin: row.is_admin === 1,
    tokenBudget: row.token_budget ?? 5_000_000,
    createdAt: row.created_at,
    lastSeen: row.last_seen,
  };
}

function rowToOrg(row: DbOrgRow): Organization {
  return {
    id: row.id,
    name: row.name,
    joinCode: row.join_code,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export interface HierarchicalUsage {
  tokens4h: number;
  tokensWeek: number;
  budget4h: number;
  budgetWeek: number;
  window4hEndsAt: number;
  weekEndsAt: number;
}

export function createUser(email: string, organizationId?: string): User {
  const id = randomUUID();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      'INSERT INTO users (id, email, organization_id, tier, is_admin, token_budget, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(id, email, organizationId ?? null, 'starter', 0, 5_000_000, now);
  return {
    id,
    email,
    organizationId: organizationId ?? null,
    tier: 'starter',
    isAdmin: false,
    tokenBudget: 5_000_000,
    createdAt: now,
    lastSeen: null,
  };
}

export function getUserByEmail(email: string): User | undefined {
  const row = getDb().prepare('SELECT * FROM users WHERE email = ?').get(email) as
    DbUserRow | undefined;
  return row ? rowToUser(row) : undefined;
}

export function getUserById(id: string): User | undefined {
  const row = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as DbUserRow | undefined;
  return row ? rowToUser(row) : undefined;
}

export function touchLastSeen(userId: string): void {
  getDb()
    .prepare('UPDATE users SET last_seen = ? WHERE id = ?')
    .run(new Date().toISOString(), userId);
}

export function updateUserName(userId: string, name: string): void {
  getDb().prepare('UPDATE users SET name = ? WHERE id = ?').run(name.trim(), userId);
}

export function setUserAdmin(userId: string, isAdmin: boolean): void {
  getDb()
    .prepare('UPDATE users SET is_admin = ? WHERE id = ?')
    .run(isAdmin ? 1 : 0, userId);
}

export interface AdminUserRow {
  id: string;
  email: string;
  displayName: string | null;
  isAdmin: boolean;
  createdAt: string;
  lastSeen: string | null;
  tier: string;
  tokensTotal: number;
}

export function getUsersPage(
  page: number,
  pageSize: number,
): { users: AdminUserRow[]; total: number } {
  const db = getDb();
  const offset = (page - 1) * pageSize;
  interface JoinRow {
    id: string;
    email: string;
    name: string | null;
    tier: string;
    is_admin: number;
    created_at: string;
    last_seen: string | null;
    tokens_total: number;
  }
  const rows = db
    .prepare(
      `
    SELECT u.id, u.email, u.name, u.tier, u.is_admin, u.created_at, u.last_seen,
           COALESCE(SUM(aa.tokens_in + aa.tokens_out), 0) as tokens_total
      FROM users u
      LEFT JOIN analysis_audit aa ON aa.user_id = u.id
     GROUP BY u.id
     ORDER BY u.created_at DESC
     LIMIT ? OFFSET ?
  `,
    )
    .all(pageSize, offset) as JoinRow[];

  const total = (db.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number }).n;

  const users: AdminUserRow[] = rows.map((r) => ({
    id: r.id,
    email: r.email,
    displayName: r.name,
    isAdmin: r.is_admin === 1,
    createdAt: r.created_at,
    lastSeen: r.last_seen,
    tier: r.tier ?? 'starter',
    tokensTotal: Number(r.tokens_total ?? 0),
  }));

  return { users, total };
}

export interface AdminDashboardCounts {
  users: number;
  cases: number;
  signedOff: number;
  pending: number;
  tokensTotal: number;
  casesToday: number;
}

export function getAdminDashboardCounts(): AdminDashboardCounts {
  const db = getDb();
  const todayStartIso = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const q = <T>(sql: string, ...params: unknown[]) => db.prepare(sql).get(...params) as T;

  return {
    users: q<{ n: number }>('SELECT COUNT(*) as n FROM users').n,
    cases: q<{ n: number }>('SELECT COUNT(*) as n FROM cases').n,
    signedOff: q<{ n: number }>("SELECT COUNT(*) as n FROM cases WHERE status = 'signed_off'").n,
    pending: q<{ n: number }>("SELECT COUNT(*) as n FROM cases WHERE status = 'pending_review'").n,
    tokensTotal: q<{ n: number }>(
      'SELECT COALESCE(SUM(tokens_in + tokens_out), 0) as n FROM analysis_audit',
    ).n,
    casesToday: q<{ n: number }>(
      'SELECT COUNT(*) as n FROM cases WHERE created_at >= ?',
      todayStartIso,
    ).n,
  };
}

export function getUserHierarchicalUsage(userId: string, tokenBudget: number): HierarchicalUsage {
  const db = getDb();
  const budgetWeek = Math.floor(tokenBudget / 4);
  const budget4h = Math.floor(budgetWeek / 42);

  const periodMs = 4 * 60 * 60 * 1000;
  const now = Date.now();
  const start4hMs = now - (now % periodMs);
  const start4hIso = new Date(start4hMs).toISOString();

  const d = new Date();
  const daysToMonday = d.getUTCDay() === 0 ? 6 : d.getUTCDay() - 1;
  d.setUTCDate(d.getUTCDate() - daysToMonday);
  d.setUTCHours(0, 0, 0, 0);
  const startWeekIso = d.toISOString();
  const startWeekMs = d.getTime();

  function tokensUsedSince(since: string): number {
    const row = db
      .prepare(
        'SELECT COALESCE(SUM(tokens_in + tokens_out), 0) as total FROM analysis_audit WHERE user_id = ? AND created_at >= ?',
      )
      .get(userId, since) as { total: number };
    return row.total;
  }

  return {
    tokens4h: tokensUsedSince(start4hIso),
    tokensWeek: tokensUsedSince(startWeekIso),
    budget4h,
    budgetWeek,
    window4hEndsAt: start4hMs + periodMs,
    weekEndsAt: startWeekMs + 7 * 24 * 60 * 60 * 1000,
  };
}

export function upsertOtp(email: string, code: string, ttlMs = 10 * 60 * 1000): void {
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  getDb()
    .prepare(
      'INSERT OR REPLACE INTO auth_otps (email, code, expires_at, attempts) VALUES (?, ?, ?, 0)',
    )
    .run(email, otpDigest(email, code), expiresAt);
}

export function verifyAndConsumeOtp(email: string, code: string): boolean {
  interface DbOtpRow {
    email: string;
    code: string;
    expires_at: string;
    attempts: number;
  }
  const db = getDb();
  return db.transaction(() => {
    const row = db.prepare('SELECT * FROM auth_otps WHERE email = ?').get(email) as
      DbOtpRow | undefined;
    if (!row) return false;
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      db.prepare('DELETE FROM auth_otps WHERE email = ?').run(email);
      return false;
    }

    const expected = Buffer.from(otpDigest(email, code), 'hex');
    const stored = Buffer.from(row.code, 'hex');
    const matches = stored.length === expected.length && timingSafeEqual(stored, expected);
    if (matches) {
      db.prepare('DELETE FROM auth_otps WHERE email = ?').run(email);
      return true;
    }

    if (row.attempts + 1 >= 5) {
      db.prepare('DELETE FROM auth_otps WHERE email = ?').run(email);
    } else {
      db.prepare('UPDATE auth_otps SET attempts = attempts + 1 WHERE email = ?').run(email);
    }
    return false;
  })();
}

function otpDigest(email: string, code: string): string {
  const pepper =
    process.env['OTP_PEPPER'] ?? process.env['JWT_SECRET'] ?? 'local-development-otp-pepper';
  return createHmac('sha256', pepper).update(`${email}\0${code}`).digest('hex');
}

export function createOrg(name: string, createdBy: string): Organization {
  const id = randomUUID();
  const joinCode = generateJoinCode();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      'INSERT INTO organizations (id, name, join_code, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(id, name, joinCode, createdBy, now);
  return { id, name, joinCode, createdBy, createdAt: now };
}

export function getOrgById(id: string): Organization | undefined {
  const row = getDb().prepare('SELECT * FROM organizations WHERE id = ?').get(id) as
    DbOrgRow | undefined;
  return row ? rowToOrg(row) : undefined;
}

export function getOrgByJoinCode(joinCode: string): Organization | undefined {
  const row = getDb().prepare('SELECT * FROM organizations WHERE join_code = ?').get(joinCode) as
    DbOrgRow | undefined;
  return row ? rowToOrg(row) : undefined;
}

export function addUserToOrg(userId: string, orgId: string): void {
  getDb().prepare('UPDATE users SET organization_id = ? WHERE id = ?').run(orgId, userId);
}

export function getOrgMembers(orgId: string): User[] {
  const rows = getDb()
    .prepare('SELECT * FROM users WHERE organization_id = ? ORDER BY created_at ASC')
    .all(orgId) as DbUserRow[];
  return rows.map(rowToUser);
}
