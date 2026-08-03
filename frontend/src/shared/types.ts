// Hand-maintained copy of the wire-crossing types from api/src/shared/types.ts
// (the source of truth) — update both. Check drift with:
//   diff api/src/shared/types.ts frontend/src/shared/types.ts
export interface User {
  id: string;
  email: string;
  name?: string | null;
  organizationId: string | null;
  tier: string;
  isAdmin: boolean;
  tokenBudget: number;
  tokens4h?: number;
  tokensWeek?: number;
  budget4h?: number;
  budgetWeek?: number;
  window4hEndsAt?: number;
  weekEndsAt?: number;
}

export type EvidenceType = 'edf_metric' | 'event_table' | 'report_page' | 'screenshot_window' | 'pdf_metric';
export type FindingConfidence = 'high' | 'medium' | 'low';
export type CaseStatus = 'draft' | 'pending_review' | 'signed_off';
export type ReviewerDecision = 'confirm' | 'reject' | 'uncertain' | 'edit' | 'artefact';

export interface EvidenceRef {
  type: EvidenceType;
  source: string;
  value: string | number;
  timestamp?: string;
  eventId?: string;
}

export interface ConfidenceFactor {
  label: string;
  value?: string | number;
  impact: 'positive' | 'negative' | 'neutral';
}

export interface Finding {
  id: string;
  claim: string;
  evidence: EvidenceRef[];
  confidence: FindingConfidence;
  confidenceRationale?: string;
  confidenceFactors?: ConfidenceFactor[];
  uncertainty?: string;
  reviewerDecision?: ReviewerDecision;
  editedClaim?: string;
  reviewedAt?: string;
}

export interface TokenStats {
  pass1In: number;
  pass1Out: number;
  pass2In: number;
  pass2Out: number;
  pass3In: number;
  pass3Out: number;
  pass4In?: number;
  pass4Out?: number;
}

export interface ActionPlanItem {
  action: string;
  rationale: string;
  findingIds: string[];
}

export interface ArtifactCaveat {
  findingId: string;
  concern: string;
}

export interface EvidenceReference {
  name: string;
  year: string;
  source: string;
  relevance: string;
}

export interface ActionPlan {
  priorityActions: ActionPlanItem[];
  verifyNext: ActionPlanItem[];
  artifactCaveats: ArtifactCaveat[];
  clinicalContext: {
    commonPresentation: string;
    rareButRelevant: string[];
    treatmentEvidence?: string;
  };
  evidenceReferences?: EvidenceReference[];
  generatedAt: string;
  modelVersion: string;
  promptVersion: string;
  tokensIn: number;
  tokensOut: number;
}

export const REPORT_SECTION_KEYS = [
  'summary',
  'studyQuality',
  'respiratoryIndices',
  'oxygenation',
  'positional',
  'snoring',
  'cardiac',
  'impression'
] as const;
export type ReportSectionKey = (typeof REPORT_SECTION_KEYS)[number];

export interface StructuredReport {
  summary: string;
  studyQuality: {
    totalRecordingTime?: string;
    analysableTime?: string;
    channelIssues: string[];
  };
  respiratoryIndices: {
    ahi?: number;
    rei?: number;
    reiArtifactAdjusted?: number;
    odi3?: number;
    odi4?: number;
    centralIndex?: number;
    apneaCount?: number;
    hypopneaCount?: number;
    avgEventDurationSec?: number;
    maxEventDurationSec?: number;
  };
  oxygenation: {
    meanSpO2?: number;
    baselineSpO2?: number;
    nadirSpO2?: number;
    t90Pct?: number;
    t80Pct?: number;
    desatCount?: number;
    avgDesatDepth?: number;
    deepestDesat?: number;
    avgDesatDuration?: number;
    longestDesatSec?: number;
    sumDesatSec?: number;
  };
  positional: {
    supineAhi?: number;
    nonSupineAhi?: number;
    supineTimePct?: number;
    leftTimePct?: number;
    rightTimePct?: number;
    proneTimePct?: number;
    uprightTimePct?: number;
  };
  snoring?: {
    snoreTimePct?: number;
    snoreIndex?: number;
    snoreMinutes?: number;
  };
  cardiac?: {
    meanHr?: number;
    minHr?: number;
    maxHr?: number;
    wakeMeanHr?: number;
    wakeMinHr?: number;
    wakeMaxHr?: number;
  };
  impression: string;
  citations: Partial<Record<ReportSectionKey, string[]>>;
}

export interface SectionReview {
  decision: ReviewerDecision;
  editedValue?: string;
  reviewedAt: string;
}

export type SectionReviews = Partial<Record<ReportSectionKey, SectionReview>>;

export const REFERENCE_FLAG_SEVERITIES = ['info', 'warning'] as const;
export type ReferenceFlagSeverity = (typeof REFERENCE_FLAG_SEVERITIES)[number];

export interface ReferenceFlag {
  ruleId: string;
  section?: ReportSectionKey;
  quote: string;
  issue: string;
  severity: ReferenceFlagSeverity;
}

export const VALIDATION_WARNING_STAGES = ['citation_check', 'pass3'] as const;
export type ValidationWarningStage = (typeof VALIDATION_WARNING_STAGES)[number];

export interface ValidationWarning {
  stage: ValidationWarningStage;
  section?: ReportSectionKey;
  quote: string;
  reason: string;
}

export type ReferenceCohort = 'adult' | 'pediatric' | 'generic';
export type ReferenceType = 'hsat' | 'psg' | 'generic';
export type ReferenceLicense = 'open' | 'institutional' | 'restricted';

export interface ReferenceDoc {
  id: string;
  title: string;
  content: string;
  cohort: ReferenceCohort;
  type: ReferenceType;
  license: ReferenceLicense;
  createdAt: string;
}

export interface ReferenceRule {
  id: string;
  rule: string;
  page: string;
  appliesTo: string;
  sourceRefId: string;
}

export interface UploadResponse {
  caseId: string;
  studyHash: string;
  name: string;
  status: CaseStatus;
}

export interface SignalSlice {
  channel: string;
  windowStartSec: number;
  windowEndSec: number;
  /** Evenly-spaced decimated samples. time_i = windowStartSec + i * (windowEndSec - windowStartSec) / (samples.length - 1) */
  samples: number[];
}

export interface EventSlice {
  eventId: string;
  type: string;
  startSec: number;
  endSec: number;
  magnitude: number;
  tags: string[];
  signalSlices: SignalSlice[];
}

export interface PdfMetrics {
  parsed: true;
  ahi?: number;
  rdi?: number;
  minimum_spo2_pct?: number;
  average_spo2_pct?: number;
  baseline_spo2_pct?: number;
  time_below_90_pct?: number;
  biggest_desaturation_pct?: number;
  desaturation_index?: number;
  count_below_90?: number;
  count_below_80?: number;
  supine_fraction_pct?: number;
  not_supine_fraction_pct?: number;
  left_fraction_pct?: number;
  right_fraction_pct?: number;
  prone_fraction_pct?: number;
  upright_fraction_pct?: number;
  hr_average?: number;
  hr_minimum?: number;
  hr_maximum?: number;
  hr_wake_mean?: number;
  hr_wake_min?: number;
  hr_wake_max?: number;
  total_recording_seconds?: number;
  total_sleep_time_seconds?: number;
  sleep_efficiency_pct?: number;
  sleep_latency_min?: number;
  artefact_minutes?: number;
  artefact_pct?: number;
  obstructive_apnea_count?: number;
  obstructive_apnea_index?: number;
  central_apnea_count?: number;
  central_apnea_index?: number;
  hypopnea_index?: number;
  snore_count?: number;
  snore_index?: number;
}

export interface EdfMetrics {
  totalRecordingHours?: number;
  provisionalReiPerHour?: number;
  provisionalReiAdjustedPerHour?: number;
  provisionalOdiPerHour?: number;
  reiCalculationDetail?: {
    flowEventCount: number;
    artifactAdjustedCount: number;
    artifactExcludedCount: number;
    recordingHours: number;
    flowChannelFlatPct?: number;
  };
  flowStats?: {
    count: number;
    artifactAdjustedCount: number;
    artifactExcludedCount: number;
    apneaCount: number;
    hypopneaCount: number;
    avgDurationSec?: number;
    maxDurationSec?: number;
    severityBreakdown?: Record<string, number>;
  };
  spo2?: {
    channel: string;
    baselinePct?: number;
    meanPct?: number;
    nadirPct?: number;
    t90Pct?: number;
    t90Minutes?: number;
    t80Pct?: number;
    t80Minutes?: number;
    desatCount?: number;
    avgDesatDepthPct?: number;
    deepestDesatPct?: number;
    avgDesatDurationSec?: number;
    longestDesatSec?: number;
    sumDesatSec?: number;
    severityBreakdown?: Record<string, number>;
  };
  hr?: {
    channel: string;
    meanBpm?: number;
    minBpm?: number;
    maxBpm?: number;
  };
  snore?: {
    channel: string;
    snoreMinutes?: number;
    snoreTimePct?: number;
    snoreIndexPerHour?: number;
  };
  positional?: {
    supineTimePct?: number;
    leftTimePct?: number;
    rightTimePct?: number;
    proneTimePct?: number;
    uprightTimePct?: number;
    supineFlowEventCount?: number;
    nonsupineFlowEventCount?: number;
    supineReiPerHour?: number | null;
    nonsupineReiPerHour?: number | null;
  };
}

export interface Case {
  id: string;
  studyHash: string;
  name: string;
  status: CaseStatus;
  cohort?: 'adult' | 'pediatric' | 'generic';
  demographics?: {
    ageYears?: number;
    sex?: 'M' | 'F' | 'X';
  };
  findings: Finding[];
  narrative?: string;
  structuredReport?: StructuredReport;
  sectionReviews?: SectionReviews;
  referenceFlags?: ReferenceFlag[];
  validationWarnings?: ValidationWarning[];
  pdfMetrics?: PdfMetrics | null;
  edfMetrics?: EdfMetrics | null;
  casePackage?: string;
  tokenStats?: TokenStats;
  actionPlan?: ActionPlan;
  preprocessorVersion: string;
  promptVersion: string;
  modelVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditRecord {
  id: string;
  caseId: string;
  action: string;
  actorId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export type AnalysisEvent =
  | { type: 'progress'; pass: number; message: string }
  | { type: 'stage_complete'; pass: number | '3b'; tokensIn: number; tokensOut: number; findingCount?: number; warningCount?: number; flagCount?: number }
  | { type: 'documents_only_mode'; message: string }
  | { type: 'warning'; code: 'reference_pack_unavailable'; message: string }
  | { type: 'validation_warnings'; warnings: ValidationWarning[] }
  | { type: 'reference_flags'; flags: ReferenceFlag[] }
  | {
      type: 'done';
      findings: Finding[];
      narrative: string;
      structuredReport?: StructuredReport;
      referenceFlags?: ReferenceFlag[];
      validationWarnings?: ValidationWarning[];
      modelVersion: string;
      promptVersion: string;
      tokenStats?: TokenStats;
    }
  | { type: 'validation_failed'; rejections: Array<{ quote: string; reason: string; section?: ReportSectionKey }> }
  | { type: 'error'; message: string };

export type ActionPlanEvent =
  | { type: 'progress'; pass: 4; message: string }
  | { type: 'stage_complete'; pass: 4; tokensIn: number; tokensOut: number }
  | { type: 'done'; actionPlan: ActionPlan }
  | { type: 'error'; message: string };
