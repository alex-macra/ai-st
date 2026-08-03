import { getDb } from './connection.js';
import { insertAuditRecord } from './audit.js';
import type {
  AuditRecord,
  Case,
  ReviewerDecision,
  ReferenceFlag,
  ValidationWarning,
  TokenStats,
  StructuredReport,
  SectionReviews,
  SectionReview,
  ReportSectionKey,
  ActionPlan,
} from '../shared/types.js';

export function updateFindingDecision(
  caseId: string,
  findingId: string,
  decision: ReviewerDecision,
  editedClaim: string | undefined,
  updatedAt: string
): boolean {
  const row = getDb()
    .prepare("SELECT findings FROM cases WHERE id = ? AND status != 'signed_off'")
    .get(caseId) as { findings: string } | undefined;
  if (!row) return false;
  const findings = JSON.parse(row.findings) as Case['findings'];
  const idx = findings.findIndex((f) => f.id === findingId);
  if (idx === -1) return false;
  const existing = findings[idx]!;
  const updated = { ...existing, reviewerDecision: decision, reviewedAt: updatedAt } as typeof existing;
  if (decision === 'edit' && editedClaim !== undefined) {
    updated.editedClaim = editedClaim;
  } else {
    delete updated.editedClaim;
  }
  findings[idx] = updated;
  getDb()
    .prepare("UPDATE cases SET findings = ?, action_plan = NULL, updated_at = ? WHERE id = ? AND status != 'signed_off'")
    .run(JSON.stringify(findings), updatedAt, caseId);
  return true;
}

export function updateFindingDecisionWithAudit(
  caseId: string,
  findingId: string,
  decision: ReviewerDecision,
  editedClaim: string | undefined,
  updatedAt: string,
  audit: AuditRecord
): boolean {
  const transaction = getDb().transaction((): boolean => {
    const updated = updateFindingDecision(caseId, findingId, decision, editedClaim, updatedAt);
    if (!updated) return false;
    insertAuditRecord(audit);
    return true;
  });
  return transaction() as boolean;
}

export function updateSectionReview(
  caseId: string,
  section: ReportSectionKey,
  review: SectionReview,
  updatedAt: string
): boolean {
  const row = getDb()
    .prepare("SELECT section_reviews FROM cases WHERE id = ? AND status != 'signed_off'")
    .get(caseId) as { section_reviews: string | null } | undefined;
  if (!row) return false;
  const current: SectionReviews = row.section_reviews
    ? (JSON.parse(row.section_reviews) as SectionReviews)
    : {};
  current[section] = review;
  getDb()
    .prepare("UPDATE cases SET section_reviews = ?, action_plan = NULL, updated_at = ? WHERE id = ? AND status != 'signed_off'")
    .run(JSON.stringify(current), updatedAt, caseId);
  return true;
}

export function updateSectionReviewWithAudit(
  caseId: string,
  section: ReportSectionKey,
  review: SectionReview,
  updatedAt: string,
  audit: AuditRecord
): boolean {
  const transaction = getDb().transaction((): boolean => {
    const updated = updateSectionReview(caseId, section, review, updatedAt);
    if (!updated) return false;
    insertAuditRecord(audit);
    return true;
  });
  return transaction() as boolean;
}

export function updateCaseFindings(
  id: string,
  findings: Case['findings'],
  narrative: string | null,
  modelVersion: string,
  updatedAt: string,
  structuredReport: StructuredReport | null = null,
  referenceFlags: ReferenceFlag[] | null = null,
  validationWarnings: ValidationWarning[] | null = null,
  expectedUpdatedAt?: string
): boolean {
  const where = expectedUpdatedAt
    ? "id = ? AND status != 'signed_off' AND updated_at = ?"
    : "id = ? AND status != 'signed_off'";
  const result = getDb()
    .prepare(
      `UPDATE cases
         SET findings = ?, narrative = ?, structured_report = ?, section_reviews = NULL,
             reference_flags = ?, validation_warnings = ?, action_plan = NULL,
             model_version = ?, updated_at = ?
       WHERE ${where}`
    )
    .run(
      JSON.stringify(findings),
      narrative,
      structuredReport ? JSON.stringify(structuredReport) : null,
      referenceFlags ? JSON.stringify(referenceFlags) : null,
      validationWarnings ? JSON.stringify(validationWarnings) : null,
      modelVersion,
      updatedAt,
      id,
      ...(expectedUpdatedAt ? [expectedUpdatedAt] : [])
    );
  return result.changes === 1;
}

export function updateCaseTokenStats(id: string, stats: TokenStats, updatedAt: string): void {
  getDb()
    .prepare('UPDATE cases SET token_stats = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(stats), updatedAt, id);
}

export function updateCaseActionPlan(
  id: string,
  plan: ActionPlan,
  updatedAt: string,
  expectedUpdatedAt?: string
): boolean {
  const where = expectedUpdatedAt
    ? "id = ? AND status != 'signed_off' AND updated_at = ?"
    : "id = ? AND status != 'signed_off'";
  const result = getDb()
    .prepare(`UPDATE cases SET action_plan = ?, updated_at = ? WHERE ${where}`)
    .run(JSON.stringify(plan), updatedAt, id, ...(expectedUpdatedAt ? [expectedUpdatedAt] : [])) as { changes: number };
  return result.changes === 1;
}

export function updateCasePackage(
  id: string,
  casePackage: string,
  updatedAt: string,
  expectedUpdatedAt?: string
): boolean {
  const where = expectedUpdatedAt
    ? "id = ? AND status != 'signed_off' AND updated_at = ?"
    : "id = ? AND status != 'signed_off'";
  const result = getDb()
    .prepare(`UPDATE cases SET case_package = ?, updated_at = ? WHERE ${where}`)
    .run(casePackage, updatedAt, id, ...(expectedUpdatedAt ? [expectedUpdatedAt] : [])) as { changes: number };
  return result.changes > 0;
}
