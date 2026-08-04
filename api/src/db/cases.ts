// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { getDb } from './connection.js';
import type {
  Case,
  AuditRecord,
  ReferenceFlag,
  ValidationWarning,
  TokenStats,
  StructuredReport,
  SectionReviews,
  ActionPlan,
  PdfMetrics,
  EdfMetrics,
} from '../shared/types.js';

interface DbCaseRow {
  id: string;
  study_hash: string;
  name: string;
  status: string;
  findings: string;
  narrative: string | null;
  case_package: string | null;
  token_stats: string | null;
  structured_report: string | null;
  section_reviews: string | null;
  reference_flags: string | null;
  validation_warnings: string | null;
  action_plan: string | null;
  created_by: string | null;
  organization_id: string | null;
  preprocessor_version: string;
  prompt_version: string;
  model_version: string;
  created_at: string;
  updated_at: string;
}

function extractPdfMetrics(casePackageJson: string | null): PdfMetrics | null {
  if (!casePackageJson) return null;
  try {
    const pkg = JSON.parse(casePackageJson) as Record<string, unknown>;
    const m = pkg['pdf_metrics'] as Record<string, unknown> | null | undefined;
    if (!m || m['parsed'] !== true) return null;
    return m as unknown as PdfMetrics;
  } catch {
    return null;
  }
}

function extractEdfMetrics(casePackageJson: string | null): EdfMetrics | null {
  if (!casePackageJson) return null;
  try {
    const pkg = JSON.parse(casePackageJson) as Record<string, unknown>;
    const sm = pkg['study_metrics'] as Record<string, unknown> | null | undefined;
    if (!sm) return null;

    type R = Record<string, unknown>;
    const n = (o: R, k: string) => o[k] as number | undefined;

    const rcd = sm['rei_calculation_detail'] as R | undefined;
    const fs = sm['flow_stats'] as R | undefined;
    const sp = sm['spo2'] as R | undefined;
    const hr = sm['hr'] as R | undefined;
    const sn = sm['snore'] as R | undefined;
    const pos = sm['positional'] as R | undefined;

    return {
      totalRecordingHours: n(sm, 'total_recording_hours'),
      provisionalReiPerHour: n(sm, 'provisional_rei_per_hour'),
      provisionalReiAdjustedPerHour: n(sm, 'provisional_rei_artifact_adjusted_per_hour'),
      provisionalOdiPerHour: n(sm, 'provisional_odi_per_hour'),
      ...(rcd
        ? {
            reiCalculationDetail: {
              flowEventCount: n(rcd, 'flow_event_count') ?? 0,
              artifactAdjustedCount: n(rcd, 'artifact_adjusted_count') ?? 0,
              artifactExcludedCount: n(rcd, 'artifact_excluded_count') ?? 0,
              recordingHours: n(rcd, 'recording_hours') ?? 0,
              ...(rcd['flow_channel_flat_pct'] != null
                ? { flowChannelFlatPct: n(rcd, 'flow_channel_flat_pct') }
                : {}),
            },
          }
        : {}),
      ...(fs
        ? {
            flowStats: {
              count: n(fs, 'count') ?? 0,
              artifactAdjustedCount: n(fs, 'artifact_adjusted_count') ?? 0,
              artifactExcludedCount: n(fs, 'artifact_excluded_count') ?? 0,
              apneaCount: n(fs, 'apnea_count') ?? 0,
              hypopneaCount: n(fs, 'hypopnea_count') ?? 0,
              ...(fs['avg_duration_sec'] != null
                ? { avgDurationSec: n(fs, 'avg_duration_sec') }
                : {}),
              ...(fs['max_duration_sec'] != null
                ? { maxDurationSec: n(fs, 'max_duration_sec') }
                : {}),
              ...(fs['severity_breakdown'] != null
                ? { severityBreakdown: fs['severity_breakdown'] as Record<string, number> }
                : {}),
            },
          }
        : {}),
      ...(sp
        ? {
            spo2: {
              channel: sp['channel'] as string,
              ...(sp['baseline_pct'] != null ? { baselinePct: n(sp, 'baseline_pct') } : {}),
              ...(sp['mean_pct'] != null ? { meanPct: n(sp, 'mean_pct') } : {}),
              ...(sp['nadir_pct'] != null ? { nadirPct: n(sp, 'nadir_pct') } : {}),
              ...(sp['t90_pct'] != null ? { t90Pct: n(sp, 't90_pct') } : {}),
              ...(sp['t90_minutes'] != null ? { t90Minutes: n(sp, 't90_minutes') } : {}),
              ...(sp['t80_pct'] != null ? { t80Pct: n(sp, 't80_pct') } : {}),
              ...(sp['t80_minutes'] != null ? { t80Minutes: n(sp, 't80_minutes') } : {}),
              ...(sp['desat_count'] != null ? { desatCount: n(sp, 'desat_count') } : {}),
              ...(sp['avg_desat_depth_pct'] != null
                ? { avgDesatDepthPct: n(sp, 'avg_desat_depth_pct') }
                : {}),
              ...(sp['deepest_desat_pct'] != null
                ? { deepestDesatPct: n(sp, 'deepest_desat_pct') }
                : {}),
              ...(sp['avg_desat_duration_sec'] != null
                ? { avgDesatDurationSec: n(sp, 'avg_desat_duration_sec') }
                : {}),
              ...(sp['longest_desat_sec'] != null
                ? { longestDesatSec: n(sp, 'longest_desat_sec') }
                : {}),
              ...(sp['sum_desat_sec'] != null ? { sumDesatSec: n(sp, 'sum_desat_sec') } : {}),
              ...(sp['severity_breakdown'] != null
                ? { severityBreakdown: sp['severity_breakdown'] as Record<string, number> }
                : {}),
            },
          }
        : {}),
      ...(hr
        ? {
            hr: {
              channel: hr['channel'] as string,
              ...(hr['mean_bpm'] != null ? { meanBpm: n(hr, 'mean_bpm') } : {}),
              ...(hr['min_bpm'] != null ? { minBpm: n(hr, 'min_bpm') } : {}),
              ...(hr['max_bpm'] != null ? { maxBpm: n(hr, 'max_bpm') } : {}),
            },
          }
        : {}),
      ...(sn
        ? {
            snore: {
              channel: sn['channel'] as string,
              ...(sn['snore_minutes'] != null ? { snoreMinutes: n(sn, 'snore_minutes') } : {}),
              ...(sn['snore_time_pct'] != null ? { snoreTimePct: n(sn, 'snore_time_pct') } : {}),
              ...(sn['snore_index_per_hour'] != null
                ? { snoreIndexPerHour: n(sn, 'snore_index_per_hour') }
                : {}),
            },
          }
        : {}),
      ...(pos
        ? {
            positional: {
              ...(pos['supine_time_pct'] != null
                ? { supineTimePct: n(pos, 'supine_time_pct') }
                : {}),
              ...(pos['left_time_pct'] != null ? { leftTimePct: n(pos, 'left_time_pct') } : {}),
              ...(pos['right_time_pct'] != null ? { rightTimePct: n(pos, 'right_time_pct') } : {}),
              ...(pos['prone_time_pct'] != null ? { proneTimePct: n(pos, 'prone_time_pct') } : {}),
              ...(pos['upright_time_pct'] != null
                ? { uprightTimePct: n(pos, 'upright_time_pct') }
                : {}),
              ...(pos['supine_flow_event_count'] != null
                ? { supineFlowEventCount: n(pos, 'supine_flow_event_count') }
                : {}),
              ...(pos['nonsupine_flow_event_count'] != null
                ? { nonsupineFlowEventCount: n(pos, 'nonsupine_flow_event_count') }
                : {}),
              ...(pos['supine_rei_per_hour'] != null
                ? { supineReiPerHour: n(pos, 'supine_rei_per_hour') }
                : {}),
              ...(pos['nonsupine_rei_per_hour'] != null
                ? { nonsupineReiPerHour: n(pos, 'nonsupine_rei_per_hour') }
                : {}),
            },
          }
        : {}),
    } as EdfMetrics;
  } catch {
    return null;
  }
}

function extractCohort(casePackageJson: string | null): 'adult' | 'pediatric' | 'generic' {
  if (!casePackageJson) return 'adult';
  try {
    const pkg = JSON.parse(casePackageJson) as Record<string, unknown>;
    const c = pkg['cohort'];
    if (c === 'pediatric' || c === 'generic') return c;
    return 'adult';
  } catch {
    return 'adult';
  }
}

function extractDemographics(
  casePackageJson: string | null,
): { ageYears?: number; sex?: 'M' | 'F' | 'X' } | undefined {
  if (!casePackageJson) return undefined;
  try {
    const pkg = JSON.parse(casePackageJson) as Record<string, unknown>;
    const d = pkg['demographics'];
    if (!d || typeof d !== 'object') return undefined;
    const rec = d as Record<string, unknown>;
    const out: { ageYears?: number; sex?: 'M' | 'F' | 'X' } = {};
    if (typeof rec['age_years'] === 'number') out.ageYears = rec['age_years'];
    if (rec['sex'] === 'M' || rec['sex'] === 'F' || rec['sex'] === 'X') out.sex = rec['sex'];
    return Object.keys(out).length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

function rowToCase(row: DbCaseRow): Case {
  const pdfMetrics = extractPdfMetrics(row.case_package);
  const edfMetrics = extractEdfMetrics(row.case_package);
  const cohort = extractCohort(row.case_package);
  const demographics = extractDemographics(row.case_package);
  return {
    id: row.id,
    studyHash: row.study_hash,
    name: row.name,
    status: row.status as Case['status'],
    cohort,
    ...(demographics ? { demographics } : {}),
    findings: JSON.parse(row.findings) as Case['findings'],
    ...(row.narrative !== null ? { narrative: row.narrative } : {}),
    ...(row.case_package !== null ? { casePackage: row.case_package } : {}),
    pdfMetrics,
    edfMetrics,
    ...(row.token_stats !== null ? { tokenStats: JSON.parse(row.token_stats) as TokenStats } : {}),
    ...(row.structured_report !== null
      ? { structuredReport: JSON.parse(row.structured_report) as StructuredReport }
      : {}),
    ...(row.section_reviews !== null
      ? { sectionReviews: JSON.parse(row.section_reviews) as SectionReviews }
      : {}),
    ...(row.reference_flags !== null
      ? { referenceFlags: JSON.parse(row.reference_flags) as ReferenceFlag[] }
      : {}),
    ...(row.validation_warnings !== null
      ? { validationWarnings: JSON.parse(row.validation_warnings) as ValidationWarning[] }
      : {}),
    ...(row.action_plan !== null ? { actionPlan: JSON.parse(row.action_plan) as ActionPlan } : {}),
    ...(row.created_by !== null ? { createdBy: row.created_by } : {}),
    ...(row.organization_id !== null ? { organizationId: row.organization_id } : {}),
    preprocessorVersion: row.preprocessor_version,
    promptVersion: row.prompt_version,
    modelVersion: row.model_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CaseScope {
  userId: string;
  organizationId: string | null;
}

export function nextCaseUpdatedAt(current: string, nowMs = Date.now()): string {
  const currentMs = Date.parse(current);
  const nextMs = Number.isFinite(currentMs) ? Math.max(nowMs, currentMs + 1) : nowMs;
  return new Date(nextMs).toISOString();
}

export function createCaseWithAudit(
  partialCase: Omit<Case, 'name'>,
  audit: AuditRecord,
  basename: string,
): string {
  const db = getDb();
  let name = '';
  db.transaction(() => {
    const row = db
      .prepare('SELECT COUNT(*) as n FROM cases WHERE name LIKE ?')
      .get(`%-${basename}-%`) as { n: number } | undefined;
    const seq = (row?.n ?? 0) + 1;
    const stamp = partialCase.createdAt.slice(0, 19).replace('T', '-').replace(/:/g, '');
    name = `${stamp}-${basename}-${String(seq).padStart(2, '0')}`;
    db.prepare(
      `INSERT INTO cases
         (id, study_hash, name, status, findings, narrative, case_package, token_stats,
          structured_report, section_reviews, created_by, organization_id,
          preprocessor_version, prompt_version, model_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      partialCase.id,
      partialCase.studyHash,
      name,
      partialCase.status,
      JSON.stringify(partialCase.findings),
      partialCase.narrative ?? null,
      partialCase.casePackage ?? null,
      partialCase.tokenStats ? JSON.stringify(partialCase.tokenStats) : null,
      partialCase.structuredReport ? JSON.stringify(partialCase.structuredReport) : null,
      partialCase.sectionReviews ? JSON.stringify(partialCase.sectionReviews) : null,
      partialCase.createdBy ?? null,
      partialCase.organizationId ?? null,
      partialCase.preprocessorVersion,
      partialCase.promptVersion,
      partialCase.modelVersion,
      partialCase.createdAt,
      partialCase.updatedAt,
    );
    db.prepare(
      `INSERT INTO audit_log (id, case_id, action, actor_id, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      audit.id,
      audit.caseId,
      audit.action,
      audit.actorId ?? null,
      audit.metadata ? JSON.stringify(audit.metadata) : null,
      audit.createdAt,
    );
  })();
  return name;
}

export function insertCase(c: Case): void {
  getDb()
    .prepare(
      `INSERT INTO cases
         (id, study_hash, name, status, findings, narrative, case_package, token_stats,
          structured_report, section_reviews, created_by, organization_id,
          preprocessor_version, prompt_version, model_version,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      c.id,
      c.studyHash,
      c.name,
      c.status,
      JSON.stringify(c.findings),
      c.narrative ?? null,
      c.casePackage ?? null,
      c.tokenStats ? JSON.stringify(c.tokenStats) : null,
      c.structuredReport ? JSON.stringify(c.structuredReport) : null,
      c.sectionReviews ? JSON.stringify(c.sectionReviews) : null,
      c.createdBy ?? null,
      c.organizationId ?? null,
      c.preprocessorVersion,
      c.promptVersion,
      c.modelVersion,
      c.createdAt,
      c.updatedAt,
    );
}

export function countCasesWithBasename(basename: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) as n FROM cases WHERE name LIKE ?')
    .get(`%-${basename}-%`) as { n: number } | undefined;
  return row?.n ?? 0;
}

export function getCaseById(id: string): Case | undefined {
  const row = getDb().prepare('SELECT * FROM cases WHERE id = ?').get(id) as DbCaseRow | undefined;
  return row ? rowToCase(row) : undefined;
}

export function getCases(status?: string): Case[] {
  const rows = (
    status
      ? getDb().prepare('SELECT * FROM cases WHERE status = ? ORDER BY created_at DESC').all(status)
      : getDb().prepare('SELECT * FROM cases ORDER BY created_at DESC').all()
  ) as DbCaseRow[];
  return rows.map(rowToCase);
}

export function getCasesScoped(scope: CaseScope, status?: string): Case[] {
  const orgId = scope.organizationId;
  const params: unknown[] = orgId ? [scope.userId, orgId] : [scope.userId];
  const where = orgId ? '(created_by = ? OR organization_id = ?)' : 'created_by = ?';
  const sql = status
    ? `SELECT * FROM cases WHERE ${where} AND status = ? ORDER BY created_at DESC`
    : `SELECT * FROM cases WHERE ${where} ORDER BY created_at DESC`;
  if (status) params.push(status);
  const rows = getDb()
    .prepare(sql)
    .all(...params) as DbCaseRow[];
  return rows.map(rowToCase);
}

export function getCaseByIdScoped(id: string, scope: CaseScope): Case | undefined {
  const c = getCaseById(id);
  if (!c) return undefined;
  if (c.createdBy === scope.userId) return c;
  if (scope.organizationId && c.organizationId === scope.organizationId) return c;
  return undefined;
}

export function updateCaseStatusWithAudit(
  id: string,
  status: string,
  updatedAt: string,
  audit: AuditRecord,
): boolean {
  const db = getDb();
  const transaction = db.transaction((): boolean => {
    const result = db
      .prepare(
        "UPDATE cases SET status = ?, updated_at = ? WHERE id = ? AND status != 'signed_off'",
      )
      .run(status, updatedAt, id) as { changes: number };
    if (result.changes !== 1) return false;
    db.prepare(
      `INSERT INTO audit_log (id, case_id, action, actor_id, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      audit.id,
      audit.caseId,
      audit.action,
      audit.actorId ?? null,
      audit.metadata ? JSON.stringify(audit.metadata) : null,
      audit.createdAt,
    );
    return true;
  });
  return transaction() as boolean;
}

export function signOffCaseWithAudit(id: string, updatedAt: string, audit: AuditRecord): boolean {
  const db = getDb();
  const transaction = db.transaction((): boolean => {
    const result = db
      .prepare(
        "UPDATE cases SET status = 'signed_off', updated_at = ? WHERE id = ? AND status != 'signed_off'",
      )
      .run(updatedAt, id) as { changes: number };
    if (result.changes !== 1) return false;
    db.prepare(
      `INSERT INTO audit_log (id, case_id, action, actor_id, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      audit.id,
      audit.caseId,
      audit.action,
      audit.actorId ?? null,
      audit.metadata ? JSON.stringify(audit.metadata) : null,
      audit.createdAt,
    );
    return true;
  });
  return transaction() as boolean;
}

export function deleteCase(id: string): boolean {
  const db = getDb();
  const tx = db.transaction((caseId: string): boolean => {
    db.prepare('DELETE FROM audit_log WHERE case_id = ?').run(caseId);
    const result = db.prepare('DELETE FROM cases WHERE id = ?').run(caseId) as { changes: number };
    return result.changes > 0;
  });
  return tx(id) as boolean;
}

export function clearCaseAnalysis(id: string, updatedAt = new Date().toISOString()): boolean {
  const result = getDb()
    .prepare(
      `UPDATE cases
         SET findings = '[]', narrative = NULL, structured_report = NULL,
             section_reviews = NULL, reference_flags = NULL, validation_warnings = NULL,
             action_plan = NULL, status = 'draft', updated_at = ?
       WHERE id = ? AND status != 'signed_off'`,
    )
    .run(updatedAt, id) as { changes: number };
  return result.changes > 0;
}

export function clearCaseAnalysisWithAudit(id: string, audit: AuditRecord): boolean {
  const db = getDb();
  const transaction = db.transaction((): boolean => {
    const cleared = clearCaseAnalysis(id, audit.createdAt);
    if (!cleared) return false;
    db.prepare(
      `INSERT INTO audit_log (id, case_id, action, actor_id, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      audit.id,
      audit.caseId,
      audit.action,
      audit.actorId ?? null,
      audit.metadata ? JSON.stringify(audit.metadata) : null,
      audit.createdAt,
    );
    return true;
  });
  return transaction() as boolean;
}

export function deleteAllCases(): number {
  const db = getDb();
  const tx = db.transaction((): number => {
    db.prepare(
      "DELETE FROM audit_log WHERE case_id IN (SELECT id FROM cases WHERE status != 'signed_off')",
    ).run();
    const result = db.prepare("DELETE FROM cases WHERE status != 'signed_off'").run() as {
      changes: number;
    };
    return result.changes;
  });
  return tx() as number;
}

export function clearAllAnalyses(): number {
  const now = new Date().toISOString();
  const result = getDb()
    .prepare(
      `UPDATE cases
         SET findings = '[]', narrative = NULL, structured_report = NULL,
             section_reviews = NULL, reference_flags = NULL, validation_warnings = NULL,
             action_plan = NULL, status = 'draft', updated_at = ?
       WHERE status != 'signed_off'`,
    )
    .run(now) as { changes: number };
  return result.changes;
}
