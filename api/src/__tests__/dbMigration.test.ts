import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Database = require('better-sqlite3') as any;

interface DbModule {
  getDb: (typeof import('../db.js'))['getDb'];
  insertCase: (typeof import('../db.js'))['insertCase'];
  insertAuditRecord: (typeof import('../db.js'))['insertAuditRecord'];
  getCases: (typeof import('../db.js'))['getCases'];
  getAuditLog: (typeof import('../db.js'))['getAuditLog'];
}

function seedLegacyDb(filePath: string): void {
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // Recreate the *original* schema where study_hash had a UNIQUE constraint and
  // there was no `name` column. This mimics what an existing user's on-disk DB
  // looks like before the migration in db.ts ever runs.
  db.exec(`
    CREATE TABLE cases (
      id TEXT PRIMARY KEY,
      study_hash TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'draft',
      findings TEXT NOT NULL DEFAULT '[]',
      narrative TEXT,
      preprocessor_version TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      model_version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE audit_log (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES cases(id),
      action TEXT NOT NULL,
      actor_id TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL
    );
  `);

  const now = '2026-04-01T10:00:00.000Z';
  db.prepare(
    `INSERT INTO cases (id, study_hash, status, findings, preprocessor_version, prompt_version, model_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('case-legacy-1', 'a'.repeat(64), 'draft', '[]', '0.1.0', '1.0.0', 'gpt-5.4-mini', now, now);

  db.prepare(
    `INSERT INTO audit_log (id, case_id, action, actor_id, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run('audit-1', 'case-legacy-1', 'case_created', null, null, now);

  db.close();
}

async function loadFreshDbModule(dbPath: string): Promise<DbModule> {
  vi.resetModules();
  process.env['DB_PATH'] = dbPath;
  return (await import('../db.js')) as unknown as DbModule;
}

function tableHasUniqueOnStudyHash(filePath: string): boolean {
  const db = new Database(filePath, { readonly: true });
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='cases'")
    .get() as { sql: string } | undefined;
  db.close();
  return /study_hash[^,]*UNIQUE/i.test(row?.sql ?? '');
}

describe('db migration on legacy schema', () => {
  let tmp: string;
  let dbPath: string;
  let originalDbPath: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'somnotouch-mig-'));
    dbPath = path.join(tmp, 'cases.sqlite');
    originalDbPath = process.env['DB_PATH'];
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    if (originalDbPath !== undefined) {
      process.env['DB_PATH'] = originalDbPath;
    } else {
      delete process.env['DB_PATH'];
    }
    vi.resetModules();
  });

  it('drops the legacy UNIQUE constraint on study_hash', async () => {
    seedLegacyDb(dbPath);
    expect(tableHasUniqueOnStudyHash(dbPath)).toBe(true);

    await loadFreshDbModule(dbPath); // triggers migration on first getDb() call

    // Force migration to run by making any read call:
    const mod = await loadFreshDbModule(dbPath);
    mod.getCases();

    expect(tableHasUniqueOnStudyHash(dbPath)).toBe(false);
  });

  it('preserves existing case rows and audit log across migration', async () => {
    seedLegacyDb(dbPath);
    const mod = await loadFreshDbModule(dbPath);

    const cases = mod.getCases();
    expect(cases).toHaveLength(1);
    expect(cases[0]?.id).toBe('case-legacy-1');
    expect(cases[0]?.studyHash).toBe('a'.repeat(64));

    const log = mod.getAuditLog('case-legacy-1');
    expect(log).toHaveLength(1);
    expect(log[0]?.action).toBe('case_created');
  });

  it('backfills name on legacy rows so it is non-empty and unique', async () => {
    seedLegacyDb(dbPath);
    const mod = await loadFreshDbModule(dbPath);

    const cases = mod.getCases();
    expect(cases[0]?.name).toBeTruthy();
    expect(cases[0]?.name).toMatch(/^legacy-/);
  });

  it('allows re-uploading an artifact with the same study_hash after migration', async () => {
    seedLegacyDb(dbPath);
    const mod = await loadFreshDbModule(dbPath);
    mod.getCases(); // force migration

    const now = new Date().toISOString();
    expect(() =>
      mod.insertCase({
        id: 'case-new',
        studyHash: 'a'.repeat(64), // same as legacy row - must NOT collide
        name: 'new-case-with-same-hash',
        status: 'draft',
        cohort: 'adult',
        findings: [],
        preprocessorVersion: '0.3.1',
        promptVersion: '1.2.0',
        modelVersion: 'gpt-5.4-mini',
        createdAt: now,
        updatedAt: now
      })
    ).not.toThrow();
  });

  it('is idempotent - second module load on a migrated db does not error', async () => {
    seedLegacyDb(dbPath);
    let mod = await loadFreshDbModule(dbPath);
    mod.getCases();
    mod = await loadFreshDbModule(dbPath);
    expect(() => mod.getCases()).not.toThrow();
  });

  it('restores foreign-key enforcement after rebuilding the legacy table', async () => {
    seedLegacyDb(dbPath);
    const mod = await loadFreshDbModule(dbPath);
    mod.getCases();

    expect(mod.getDb().pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('creates account tables and the action_plan column on first migration', async () => {
    seedLegacyDb(dbPath);
    const mod = await loadFreshDbModule(dbPath);
    mod.getCases(); // force migration

    const db = new Database(dbPath, { readonly: true });
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toEqual(expect.arrayContaining(['users', 'organizations', 'licenses', 'auth_otps']));

    const caseCols = (
      db.prepare('PRAGMA table_info(cases)').all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(caseCols).toEqual(expect.arrayContaining(['action_plan', 'created_by', 'organization_id']));
    db.close();
  });

  it('preserves action_plan/created_by/organization_id values across the legacy table rebuild', async () => {
    // Seed a legacy DB and add the new columns + a value before triggering rebuild.
    seedLegacyDb(dbPath);
    {
      const db = new Database(dbPath);
      db.exec('ALTER TABLE cases ADD COLUMN action_plan TEXT');
      db.exec('ALTER TABLE cases ADD COLUMN created_by TEXT');
      db.exec('ALTER TABLE cases ADD COLUMN organization_id TEXT');
      db.prepare('UPDATE cases SET action_plan = ?, created_by = ?, organization_id = ? WHERE id = ?')
        .run('{"priorityActions":[]}', 'user-123', 'org-456', 'case-legacy-1');
      db.close();
    }

    const mod = await loadFreshDbModule(dbPath);
    const cases = mod.getCases();
    expect(cases).toHaveLength(1);
    expect(cases[0]?.actionPlan).toMatchObject({ priorityActions: [] });
    expect(cases[0]?.createdBy).toBe('user-123');
    expect(cases[0]?.organizationId).toBe('org-456');
  });
});
