// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach } from 'vitest';
import supertest from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../app.js';
import { getDb, setUserAdmin, insertCase, insertAnalysisAuditRecord } from '../db.js';
import type { Case } from '../shared/types.js';
import { mintAuthCookie, authedSupertest, type TestAuth } from './authHelper.js';

function createHash32(): string {
  return Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

function makeCase(creatorId: string, overrides: Partial<Case> = {}): Case {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    studyHash: createHash32(),
    name: `admintest-${randomUUID().slice(0, 8)}`,
    status: 'draft',
    cohort: 'adult',
    findings: [],
    createdBy: creatorId,
    preprocessorVersion: '0.1.0',
    promptVersion: 'none',
    modelVersion: 'none',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function mintAdminCookie(): TestAuth {
  const auth = mintAuthCookie();
  setUserAdmin(auth.userId, true);
  return auth;
}

describe('admin API', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp({ rateLimitMax: 1000, uploadRateLimitMax: 1000 });
  });

  describe('access control', () => {
    it('GET /api/admin/dashboard returns 401 without auth', async () => {
      const res = await supertest(app).get('/api/admin/dashboard');
      expect(res.status).toBe(401);
    });

    it('GET /api/admin/dashboard returns 403 for a non-admin user', async () => {
      const nonAdmin = mintAuthCookie();
      const res = await authedSupertest(app, nonAdmin).get('/api/admin/dashboard');
      expect(res.status).toBe(403);
    });

    it('GET /api/admin/dashboard returns 200 for an admin user', async () => {
      const admin = mintAdminCookie();
      const res = await authedSupertest(app, admin).get('/api/admin/dashboard');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        users: expect.any(Number),
        cases: expect.any(Number),
        signedOff: expect.any(Number),
        pending: expect.any(Number),
        tokensTotal: expect.any(Number),
        casesToday: expect.any(Number),
      });
    });
  });

  describe('GET /api/admin/users', () => {
    it('returns paginated results', async () => {
      const admin = mintAdminCookie();
      mintAuthCookie();
      mintAuthCookie();
      mintAuthCookie();

      const res = await authedSupertest(app, admin).get('/api/admin/users?page=1&pageSize=2');
      expect(res.status).toBe(200);
      expect(res.body.page).toBe(1);
      expect(res.body.pageSize).toBe(2);
      expect(res.body.total).toBeGreaterThanOrEqual(4);
      expect(Array.isArray(res.body.users)).toBe(true);
      expect(res.body.users.length).toBeLessThanOrEqual(2);
      for (const u of res.body.users) {
        expect(u).toMatchObject({
          id: expect.any(String),
          email: expect.any(String),
          isAdmin: expect.any(Boolean),
          createdAt: expect.any(String),
          tokensTotal: expect.any(Number),
        });
      }
    });

    it('rejects invalid pageSize', async () => {
      const admin = mintAdminCookie();
      const res = await authedSupertest(app, admin).get('/api/admin/users?pageSize=9999');
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /api/admin/users/:id/admin', () => {
    it('flips the admin bit', async () => {
      const admin = mintAdminCookie();
      const target = mintAuthCookie();
      const r = authedSupertest(app, admin);

      const grant = await r
        .patch(`/api/admin/users/${target.userId}/admin`)
        .send({ isAdmin: true });
      expect(grant.status).toBe(200);
      expect(grant.body.user.isAdmin).toBe(true);

      const revoke = await r
        .patch(`/api/admin/users/${target.userId}/admin`)
        .send({ isAdmin: false });
      expect(revoke.status).toBe(200);
      expect(revoke.body.user.isAdmin).toBe(false);
    });

    it('rejects a non-UUID id', async () => {
      const admin = mintAdminCookie();
      const res = await authedSupertest(app, admin)
        .patch('/api/admin/users/not-a-uuid/admin')
        .send({ isAdmin: true });
      expect(res.status).toBe(400);
    });

    it('rejects a non-boolean body', async () => {
      const admin = mintAdminCookie();
      const target = mintAuthCookie();
      const res = await authedSupertest(app, admin)
        .patch(`/api/admin/users/${target.userId}/admin`)
        .send({ isAdmin: 'yes' });
      expect(res.status).toBe(400);
    });

    it('returns 404 for unknown user id', async () => {
      const admin = mintAdminCookie();
      const ghost = randomUUID();
      const res = await authedSupertest(app, admin)
        .patch(`/api/admin/users/${ghost}/admin`)
        .send({ isAdmin: true });
      expect(res.status).toBe(404);
    });

    it('refuses to let an admin revoke their own admin bit', async () => {
      const admin = mintAdminCookie();
      const res = await authedSupertest(app, admin)
        .patch(`/api/admin/users/${admin.userId}/admin`)
        .send({ isAdmin: false });
      expect(res.status).toBe(409);
      expect(String(res.body.error)).toMatch(/own admin/i);
    });

    it('refuses to demote the last remaining admin', async () => {
      const admin = mintAdminCookie();
      const other = mintAuthCookie();
      const r = authedSupertest(app, admin);

      await r.patch(`/api/admin/users/${other.userId}/admin`).send({ isAdmin: true });
      await r.patch(`/api/admin/users/${other.userId}/admin`).send({ isAdmin: false });

      const peer = mintAdminCookie();
      const demotePeer = await authedSupertest(app, admin)
        .patch(`/api/admin/users/${peer.userId}/admin`)
        .send({ isAdmin: false });
      expect(demotePeer.status).toBe(200);

      // Self-guard fires before the last-admin check, so demoting yourself is 409.
      const lastDemote = await authedSupertest(app, admin)
        .patch(`/api/admin/users/${admin.userId}/admin`)
        .send({ isAdmin: false });
      expect(lastDemote.status).toBe(409);
    });

    it('writes an admin_audit_log entry on toggle', async () => {
      const admin = mintAdminCookie();
      const target = mintAuthCookie();
      await authedSupertest(app, admin)
        .patch(`/api/admin/users/${target.userId}/admin`)
        .send({ isAdmin: true });

      interface AdminAuditRow {
        actor_id: string;
        action: string;
        target_user_id: string | null;
        metadata: string | null;
      }
      const row = getDb()
        .prepare(
          'SELECT actor_id, action, target_user_id, metadata FROM admin_audit_log ORDER BY created_at DESC LIMIT 1',
        )
        .get() as AdminAuditRow | undefined;
      expect(row).toBeDefined();
      expect(row!.action).toBe('set_admin');
      expect(row!.actor_id).toBe(admin.userId);
      expect(row!.target_user_id).toBe(target.userId);
      const meta = JSON.parse(row!.metadata ?? '{}') as { isAdmin?: boolean };
      expect(meta.isAdmin).toBe(true);
    });
  });

  describe('GET /api/admin/export/usage.csv', () => {
    it('returns a CSV with the expected header row', async () => {
      const admin = mintAdminCookie();
      const c = makeCase(admin.userId);
      insertCase(c);
      insertAnalysisAuditRecord(c.id, admin.userId, 1234, 567);

      const res = await authedSupertest(app, admin).get('/api/admin/export/usage.csv');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.headers['content-disposition']).toMatch(/attachment; filename="usage-/);

      const text = res.text;
      const firstLine = text.split('\n')[0];
      expect(firstLine).toBe(
        'case_id,user_id,model,tokens_in,tokens_out,cache_read,cost_usd,created_at',
      );
      expect(text).toContain(c.id);
    });
  });

  describe('GET /api/admin/export/cases.json', () => {
    it('returns rows with the whitelisted columns only — no case_data / findings / narrative', async () => {
      const admin = mintAdminCookie();
      const c = makeCase(admin.userId, {
        status: 'signed_off',
        narrative: 'PHI: patient initials JS, age 47, complains of snoring',
        findings: [{ id: 'f1', claim: 'Severe OSA', evidence: [], confidence: 'high' }],
      });
      insertCase(c);

      const res = await authedSupertest(app, admin).get('/api/admin/export/cases.json');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);

      const rows = res.body as Array<Record<string, unknown>>;
      expect(Array.isArray(rows)).toBe(true);
      expect(rows.length).toBeGreaterThan(0);

      for (const row of rows) {
        expect(row).not.toHaveProperty('case_data');
        expect(row).not.toHaveProperty('findings');
        expect(row).not.toHaveProperty('narrative');
        expect(row).not.toHaveProperty('case_package');
        expect(row).not.toHaveProperty('structured_report');

        const keys = Object.keys(row).sort();
        expect(keys).toEqual([
          'cohort',
          'created_at',
          'id',
          'signed_off_at',
          'status',
          'tokens_in',
          'tokens_out',
        ]);
      }

      // Defense in depth: no inserted PHI substring should survive serialization.
      const raw = JSON.stringify(rows);
      expect(raw).not.toContain('patient initials JS');
      expect(raw).not.toContain('Severe OSA');
    });
  });

  describe('cross-checks', () => {
    it('dashboard totals reflect inserted analysis_audit rows', async () => {
      const admin = mintAdminCookie();
      const c = makeCase(admin.userId);
      insertCase(c);
      insertAnalysisAuditRecord(c.id, admin.userId, 100, 200);
      insertAnalysisAuditRecord(c.id, admin.userId, 50, 25);

      const res = await authedSupertest(app, admin).get('/api/admin/dashboard');
      expect(res.status).toBe(200);
      expect(res.body.tokensTotal).toBeGreaterThanOrEqual(375);
      expect(res.body.cases).toBeGreaterThanOrEqual(1);
    });

    it('PATCH admin requires admin too (not just auth)', async () => {
      const nonAdmin = mintAuthCookie();
      const target = mintAuthCookie();
      const res = await authedSupertest(app, nonAdmin)
        .patch(`/api/admin/users/${target.userId}/admin`)
        .send({ isAdmin: true });
      expect(res.status).toBe(403);
    });
  });

  describe('table integrity', () => {
    it('users.is_admin column exists', () => {
      const cols = getDb().prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
      const names = cols.map((c) => c.name);
      expect(names).toContain('is_admin');
    });
  });
});
