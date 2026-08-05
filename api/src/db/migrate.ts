// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import type BetterSqlite3 from 'better-sqlite3';

/**
 * The whole schema, declared once.
 *
 * This deliberately has no upgrade path. Somnoscribe is pre-1.0 with no
 * production deployments, and carrying an append-only chain of ALTER statements
 * for databases nobody has cost more to read than it ever saved. A database
 * written by an older alpha is not migrated — delete `data/cases.sqlite` and let
 * this recreate it. When the format stabilises at 1.0, versioned migrations come
 * back and this comment goes away.
 */
export function migrate(db: BetterSqlite3.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cases (
      id                   TEXT PRIMARY KEY,
      study_hash           TEXT NOT NULL,
      name                 TEXT,
      status               TEXT NOT NULL DEFAULT 'draft',
      findings             TEXT NOT NULL DEFAULT '[]',
      narrative            TEXT,
      case_package         TEXT,
      token_stats          TEXT,
      structured_report    TEXT,
      section_reviews      TEXT,
      reference_flags      TEXT,
      validation_warnings  TEXT,
      action_plan          TEXT,
      source_kind          TEXT NOT NULL DEFAULT 'upload',
      analysis_mode        TEXT,
      preprocessor_version TEXT NOT NULL,
      prompt_version       TEXT NOT NULL,
      model_version        TEXT NOT NULL,
      created_at           TEXT NOT NULL,
      updated_at           TEXT NOT NULL
    );

    -- study_hash is deliberately not UNIQUE: re-uploading the same artifact must
    -- succeed. Uniqueness lives on the generated case name.
    CREATE TABLE IF NOT EXISTS audit_log (
      id         TEXT PRIMARY KEY,
      case_id    TEXT NOT NULL REFERENCES cases(id),
      action     TEXT NOT NULL,
      actor_id   TEXT,
      metadata   TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reference_docs (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      content    TEXT NOT NULL,
      cohort     TEXT NOT NULL,
      type       TEXT NOT NULL,
      license    TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cases_study_hash ON cases(study_hash);
    CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
    CREATE INDEX IF NOT EXISTS idx_audit_case_id ON audit_log(case_id);
    CREATE INDEX IF NOT EXISTS idx_refs_cohort ON reference_docs(cohort);
  `);
}
