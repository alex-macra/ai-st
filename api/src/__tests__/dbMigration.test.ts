// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
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
  getCaseById: (typeof import('../db.js'))['getCaseById'];
  clearCaseAnalysis: (typeof import('../db.js'))['clearCaseAnalysis'];
  getAuditLog: (typeof import('../db.js'))['getAuditLog'];
}

async function loadFreshDbModule(dbPath: string): Promise<DbModule> {
  vi.resetModules();
  process.env['DB_PATH'] = dbPath;
  return (await import('../db.js')) as unknown as DbModule;
}

function tableSql(filePath: string, table: string): string {
  const db = new Database(filePath, { readonly: true });
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
    .get(table) as { sql: string } | undefined;
  db.close();
  return row?.sql ?? '';
}

function tableNames(filePath: string): string[] {
  const db = new Database(filePath, { readonly: true });
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as Array<{ name: string }>;
  db.close();
  return rows.map((r) => r.name);
}

/**
 * `migrate()` declares the schema once and has no upgrade path — a database
 * written by an older alpha is deleted, not migrated. So what is worth testing
 * is that a fresh database comes out complete and that re-opening it is safe.
 */
describe('schema creation', () => {
  let tmp: string;
  let dbPath: string;
  let originalDbPath: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'somnoscribe-schema-'));
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

  it('creates exactly the three tables the workspace needs', async () => {
    const mod = await loadFreshDbModule(dbPath);
    mod.getDb();
    expect(tableNames(dbPath).filter((n) => !n.startsWith('sqlite_'))).toEqual([
      'audit_log',
      'cases',
      'reference_docs',
    ]);
  });

  it('leaves study_hash non-unique so the same artifact can be re-uploaded', async () => {
    const mod = await loadFreshDbModule(dbPath);
    mod.getDb();
    expect(/study_hash[^,]*UNIQUE/i.test(tableSql(dbPath, 'cases'))).toBe(false);

    const now = new Date().toISOString();
    const base = {
      studyHash: 'a'.repeat(64),
      status: 'draft' as const,
      cohort: 'adult' as const,
      findings: [],
      preprocessorVersion: '0.1.0',
      promptVersion: '1.0.0',
      modelVersion: 'none',
      createdAt: now,
      updatedAt: now,
    };
    mod.insertCase({ ...base, id: 'case-1', name: 'case-1' });
    expect(() => mod.insertCase({ ...base, id: 'case-2', name: 'case-2' })).not.toThrow();
    expect(mod.getCases()).toHaveLength(2);
  });

  it('round-trips provenance and the action_plan column', async () => {
    const mod = await loadFreshDbModule(dbPath);
    const { updateCaseActionPlan } = (await import('../db.js')) as unknown as {
      updateCaseActionPlan: (typeof import('../db.js'))['updateCaseActionPlan'];
    };
    const now = new Date().toISOString();
    mod.insertCase({
      id: 'case-full',
      studyHash: 'b'.repeat(64),
      name: 'case-full',
      status: 'pending_review',
      cohort: 'adult',
      findings: [],
      sourceKind: 'demo_synthetic',
      analysisMode: 'demo',
      preprocessorVersion: '0.3.1',
      promptVersion: '1.2.0',
      modelVersion: 'somnoscribe-offline-demo',
      createdAt: now,
      updatedAt: now,
    });

    const stored = mod.getCaseById('case-full');
    expect(stored?.sourceKind).toBe('demo_synthetic');
    expect(stored?.analysisMode).toBe('demo');

    updateCaseActionPlan(
      'case-full',
      {
        priorityActions: [],
        verifyNext: [],
        artifactCaveats: [],
        clinicalContext: { commonPresentation: '', rareButRelevant: [] },
        generatedAt: now,
        modelVersion: 'somnoscribe-offline-demo',
        promptVersion: '1.0.0',
        analysisMode: 'demo',
        tokensIn: 0,
        tokensOut: 0,
      },
      new Date(Date.now() + 1000).toISOString(),
      stored!.updatedAt,
    );
    expect(mod.getCaseById('case-full')?.actionPlan).toMatchObject({ priorityActions: [] });
  });

  it('enforces the audit foreign key', async () => {
    const mod = await loadFreshDbModule(dbPath);
    expect(() =>
      mod.insertAuditRecord({
        id: 'audit-orphan',
        caseId: 'no-such-case',
        action: 'case_created',
        createdAt: new Date().toISOString(),
      }),
    ).toThrow();
  });

  it('is idempotent — reopening an existing database does not error', async () => {
    const first = await loadFreshDbModule(dbPath);
    first.getDb();
    const second = await loadFreshDbModule(dbPath);
    expect(() => second.getCases()).not.toThrow();
  });

  it('clears persisted report-mode provenance when a draft is cleared', async () => {
    const mod = await loadFreshDbModule(dbPath);
    const now = new Date().toISOString();
    mod.insertCase({
      id: 'case-mode-clear',
      studyHash: 'c'.repeat(64),
      name: 'case-mode-clear',
      status: 'pending_review',
      cohort: 'adult',
      findings: [],
      preprocessorVersion: '0.3.1',
      promptVersion: '1.2.0',
      modelVersion: 'somnoscribe-offline-demo',
      analysisMode: 'demo',
      createdAt: now,
      updatedAt: now,
    });

    expect(mod.clearCaseAnalysis('case-mode-clear')).toBe(true);
    expect(mod.getCaseById('case-mode-clear')?.analysisMode).toBeUndefined();
  });
});
