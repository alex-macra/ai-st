import { REPORT_SECTION_KEYS } from './shared/types.js';
import type { Case, Finding, ReportSectionKey, StructuredReport } from './shared/types.js';

function hasContent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(hasContent);
  }
  return true;
}

export function populatedSectionKeys(report: StructuredReport): ReportSectionKey[] {
  return REPORT_SECTION_KEYS.filter((key) => hasContent(report[key]));
}

export function unreviewedSectionKeys(c: Case): ReportSectionKey[] {
  if (!c.structuredReport) return [];
  return populatedSectionKeys(c.structuredReport).filter((key) => !c.sectionReviews?.[key]);
}

export function reviewedFindingsForActionPlan(c: Case): Finding[] {
  return c.findings
    .filter(
      (finding) =>
        finding.reviewerDecision !== undefined &&
        finding.reviewerDecision !== 'reject' &&
        finding.reviewerDecision !== 'artefact',
    )
    .map((finding) =>
      finding.reviewerDecision === 'edit' && finding.editedClaim
        ? { ...finding, claim: finding.editedClaim }
        : finding,
    );
}

export function reviewedReportForActionPlan(c: Case): Record<string, unknown> {
  if (!c.structuredReport) return {};
  const report: Record<string, unknown> = {};
  for (const key of populatedSectionKeys(c.structuredReport)) {
    const review = c.sectionReviews?.[key];
    if (!review || review.decision === 'reject' || review.decision === 'artefact') continue;
    report[key] =
      review.decision === 'edit' && review.editedValue
        ? review.editedValue
        : c.structuredReport[key];
  }
  report['citations'] = c.structuredReport.citations;
  return report;
}
