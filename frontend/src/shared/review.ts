import { REPORT_SECTION_KEYS } from './types';
import type { Case, ReportSectionKey, StructuredReport } from './types';

function hasContent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(hasContent);
  }
  return true;
}

export function populatedReportSections(report: StructuredReport): ReportSectionKey[] {
  return REPORT_SECTION_KEYS.filter((key) => hasContent(report[key]));
}

export function reviewIsComplete(c: Case): boolean {
  if (c.findings.length === 0 || c.findings.some((finding) => !finding.reviewerDecision))
    return false;
  if (!c.structuredReport) return true;
  return populatedReportSections(c.structuredReport).every(
    (key) => c.sectionReviews?.[key] !== undefined,
  );
}
