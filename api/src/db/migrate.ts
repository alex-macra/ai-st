// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import type BetterSqlite3 from 'better-sqlite3';
import { createLicenseTable } from '../license.js';

export function migrate(db: BetterSqlite3.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      join_code  TEXT NOT NULL UNIQUE,
      created_by TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id              TEXT PRIMARY KEY,
      email           TEXT NOT NULL UNIQUE,
      organization_id TEXT REFERENCES organizations(id),
      name            TEXT,
      tier            TEXT NOT NULL DEFAULT 'starter',
      is_admin        INTEGER NOT NULL DEFAULT 0,
      is_demo         INTEGER NOT NULL DEFAULT 0,
      demo_expires_at TEXT,
      token_budget    INTEGER NOT NULL DEFAULT 5000000,
      created_at      TEXT NOT NULL,
      last_seen       TEXT
    );

    CREATE TABLE IF NOT EXISTS auth_otps (
      email      TEXT PRIMARY KEY,
      code       TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempts   INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_users_org ON users(organization_id);
  `);

  createLicenseTable(db, { trackUsedBy: true });

  // CREATE TABLE IF NOT EXISTS does not add columns to an existing installation.
  const licCols: string[] = db
    .prepare('PRAGMA table_info(licenses)')
    .all()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((r: any) => r.name as string);
  if (!licCols.includes('tier')) {
    db.exec("ALTER TABLE licenses ADD COLUMN tier TEXT NOT NULL DEFAULT 'starter'");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS cases (
      id TEXT PRIMARY KEY,
      study_hash TEXT NOT NULL,
      name TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      findings TEXT NOT NULL DEFAULT '[]',
      narrative TEXT,
      case_package TEXT,
      token_stats TEXT,
      source_kind TEXT NOT NULL DEFAULT 'upload',
      analysis_mode TEXT,
      preprocessor_version TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      model_version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES cases(id),
      action TEXT NOT NULL,
      actor_id TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reference_docs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      cohort TEXT NOT NULL,
      type TEXT NOT NULL,
      license TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS analysis_audit (
      id         TEXT PRIMARY KEY,
      case_id    TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      tokens_in  INTEGER NOT NULL,
      tokens_out INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    -- Admin actions audit trail. Distinct from audit_log (which is case-scoped
    -- via a NOT NULL FK to cases) because admin actions (toggle-admin, exports)
    -- are not case-scoped. Persistent on-DB record so reviewers don't have to
    -- depend on log files.
    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id              TEXT PRIMARY KEY,
      actor_id        TEXT NOT NULL,
      action          TEXT NOT NULL,
      target_user_id  TEXT,
      metadata        TEXT,
      created_at      TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cases_study_hash ON cases(study_hash);
    CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
    CREATE INDEX IF NOT EXISTS idx_audit_case_id ON audit_log(case_id);
    CREATE INDEX IF NOT EXISTS idx_refs_cohort ON reference_docs(cohort);
    CREATE INDEX IF NOT EXISTS idx_analysis_audit_user ON analysis_audit(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at DESC);
  `);

  // Additive migrations for existing databases (idempotent)

  // Older installations may not have analysis usage auditing yet.
  db.exec(`
    CREATE TABLE IF NOT EXISTS analysis_audit (
      id         TEXT PRIMARY KEY,
      case_id    TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      tokens_in  INTEGER NOT NULL,
      tokens_out INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_analysis_audit_user ON analysis_audit(user_id, created_at);
  `);

  // User tier/admin/budget columns
  const userCols: string[] = db
    .prepare('PRAGMA table_info(users)')
    .all()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((r: any) => r.name as string);
  if (!userCols.includes('tier')) {
    db.exec("ALTER TABLE users ADD COLUMN tier TEXT NOT NULL DEFAULT 'starter'");
  }
  if (!userCols.includes('is_admin')) {
    db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
  }
  if (!userCols.includes('token_budget')) {
    db.exec('ALTER TABLE users ADD COLUMN token_budget INTEGER NOT NULL DEFAULT 5000000');
  }
  if (!userCols.includes('name')) {
    db.exec('ALTER TABLE users ADD COLUMN name TEXT');
  }
  if (!userCols.includes('is_demo')) {
    db.exec('ALTER TABLE users ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0');
  }
  if (!userCols.includes('demo_expires_at')) {
    db.exec('ALTER TABLE users ADD COLUMN demo_expires_at TEXT');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_demo_expiry ON users(is_demo, demo_expires_at)');

  // Do not classify legacy `demo@example.test` rows here. Before the isolated
  // demo principal existed, that account could hold arbitrary uploaded data;
  // marking it as a demo row would let automatic expiry cleanup delete it on
  // upgrade. Session loading separately fails closed for that reserved address.

  const otpCols: string[] = db
    .prepare('PRAGMA table_info(auth_otps)')
    .all()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((r: any) => r.name as string);
  if (!otpCols.includes('attempts')) {
    db.exec('ALTER TABLE auth_otps ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0');
  }

  const cols: string[] = db
    .prepare('PRAGMA table_info(cases)')
    .all()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((r: any) => r.name as string);

  if (!cols.includes('case_package')) {
    db.exec('ALTER TABLE cases ADD COLUMN case_package TEXT');
  }
  if (!cols.includes('token_stats')) {
    db.exec('ALTER TABLE cases ADD COLUMN token_stats TEXT');
  }
  if (!cols.includes('structured_report')) {
    db.exec('ALTER TABLE cases ADD COLUMN structured_report TEXT');
  }
  if (!cols.includes('section_reviews')) {
    db.exec('ALTER TABLE cases ADD COLUMN section_reviews TEXT');
  }
  if (!cols.includes('reference_flags')) {
    db.exec('ALTER TABLE cases ADD COLUMN reference_flags TEXT');
  }
  if (!cols.includes('validation_warnings')) {
    db.exec('ALTER TABLE cases ADD COLUMN validation_warnings TEXT');
  }
  if (!cols.includes('name')) {
    db.exec('ALTER TABLE cases ADD COLUMN name TEXT');
  }
  if (!cols.includes('action_plan')) {
    db.exec('ALTER TABLE cases ADD COLUMN action_plan TEXT');
  }
  if (!cols.includes('created_by')) {
    db.exec('ALTER TABLE cases ADD COLUMN created_by TEXT');
  }
  if (!cols.includes('organization_id')) {
    db.exec('ALTER TABLE cases ADD COLUMN organization_id TEXT');
  }
  if (!cols.includes('source_kind')) {
    db.exec("ALTER TABLE cases ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'upload'");
  }
  if (!cols.includes('analysis_mode')) {
    db.exec('ALTER TABLE cases ADD COLUMN analysis_mode TEXT');
  }

  // SQLite cannot drop a UNIQUE constraint in place. If the legacy schema still
  // marks study_hash UNIQUE, rebuild the table without it (re-uploads of the
  // same artifact must succeed; uniqueness now lives on `name`).
  const tableSql: string =
    (
      db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='cases'").get() as
        { sql: string } | undefined
    )?.sql ?? '';
  if (/study_hash[^,]*UNIQUE/i.test(tableSql)) {
    // Disable FKs around the table rebuild so audit_log rows don't trip the
    // constraint. Inserts into cases_new preserve the same ids so the FK
    // remains valid once we re-enable.
    db.pragma('foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      db.exec(`
        CREATE TABLE cases_new (
          id TEXT PRIMARY KEY,
          study_hash TEXT NOT NULL,
          name TEXT,
          status TEXT NOT NULL DEFAULT 'draft',
          findings TEXT NOT NULL DEFAULT '[]',
          narrative TEXT,
          case_package TEXT,
          token_stats TEXT,
          structured_report TEXT,
          section_reviews TEXT,
          reference_flags TEXT,
          validation_warnings TEXT,
          action_plan TEXT,
          created_by TEXT,
          organization_id TEXT,
          source_kind TEXT NOT NULL DEFAULT 'upload',
          analysis_mode TEXT,
          preprocessor_version TEXT NOT NULL,
          prompt_version TEXT NOT NULL,
          model_version TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      db.exec(`
        INSERT INTO cases_new (
          id, study_hash, name, status, findings, narrative, case_package,
          token_stats, structured_report, section_reviews, reference_flags,
          validation_warnings, action_plan, created_by, organization_id, source_kind, analysis_mode,
          preprocessor_version, prompt_version, model_version,
          created_at, updated_at
        )
        SELECT
          id, study_hash, name, status, findings, narrative, case_package,
          token_stats, structured_report, section_reviews, reference_flags,
          validation_warnings, action_plan, created_by, organization_id, source_kind, analysis_mode,
          preprocessor_version, prompt_version, model_version,
          created_at, updated_at
        FROM cases;
      `);
      db.exec('DROP TABLE cases');
      db.exec('ALTER TABLE cases_new RENAME TO cases');
      db.exec('CREATE INDEX IF NOT EXISTS idx_cases_study_hash ON cases(study_hash)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status)');
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }

  // Backfill name for legacy rows that predate this column.
  db.exec(`
    UPDATE cases
       SET name = 'legacy-' || substr(replace(replace(created_at, ':', ''), '-', ''), 1, 15)
                  || '-' || substr(id, 1, 8)
     WHERE name IS NULL OR name = ''
  `);

  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_cases_name ON cases(name)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_cases_created_by ON cases(created_by)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_cases_org ON cases(organization_id)');
}
