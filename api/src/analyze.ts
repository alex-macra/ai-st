import type OpenAI from 'openai';
import { getOpenAIClient, writeSSE, extractUsage } from './llm.js';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { z } from 'zod';
import {
  GPT_MODEL,
  NANO_MODEL,
  PROMPT_VERSION,
  ACTION_PLAN_PROMPT_VERSION,
  ACTION_PLAN_MAX_OUTPUT_TOKENS,
  FINDING_CONFIDENCES,
  EVIDENCE_TYPES,
  CHARTS_DIR,
  SCREENSHOTS_DIR,
  ALLOWED_MODELS,
} from './constants.js';
import type { AllowedModel } from './constants.js';
import { pass1SystemPrompt, pass1SystemPromptDocumentsOnly, pass2SystemPrompt, pass3SystemPrompt, pass3bReferenceCheckPrompt, pass4ActionPlanPrompt } from './prompts.js';
import { getCaseById, updateCaseFindings, updateCaseTokenStats, updateCaseActionPlan, insertAuditRecord, insertAnalysisAuditRecord, getReferenceDocsForCohortAndType, nextCaseUpdatedAt } from './db.js';
import { logger, errorLogFields } from './logger.js';
import type { Finding, TokenStats, StructuredReport, ReferenceFlag, ReferenceDoc, ValidationWarning, ActionPlan, ReportSectionKey } from './shared/types.js';
import { REPORT_SECTION_KEYS, REFERENCE_FLAG_SEVERITIES } from './shared/types.js';
import { selectCandidates } from './tokenBudget.js';
import type { CandidateWindow } from './tokenBudget.js';
import { checkMetricBounds } from './metricBounds.js';
import { parsePass2Output } from './structuredReportParser.js';
import { getReferenceStatus, isReferenceRuleActive } from './refs/seedReferenceDocs.js';
import { reviewedFindingsForActionPlan, reviewedReportForActionPlan, unreviewedSectionKeys } from './review.js';

const client = getOpenAIClient();

function sse(res: Response, event: Record<string, unknown>): void {
  const requestId = res.locals['requestId'] as string | undefined;
  writeSSE(res, event, requestId);
}

interface PassCallResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  cacheReadTokens: number;
  truncated: boolean;
}

function untrustedJson(label: string, value: unknown): string {
  const json = JSON.stringify(value)
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
  return `<untrusted-data name="${label}">\n${json}\n</untrusted-data>`;
}

async function callPass(
  params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
  signal: AbortSignal,
): Promise<PassCallResult | null> {
  const completion = await client.chat.completions.create(params, { signal });
  if (signal.aborted) return null;
  const usage = extractUsage(completion.usage);
  return {
    text: completion.choices[0]?.message?.content ?? '{}',
    tokensIn: usage.inputTokens,
    tokensOut: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    truncated: completion.choices[0]?.finish_reason === 'length',
  };
}

const evidenceRefSchema = z.object({
  type: z.enum(EVIDENCE_TYPES),
  source: z.string().min(1),
  value: z.union([z.string(), z.number()]),
  timestamp: z.string().optional(),
  eventId: z.string().optional()
});

const findingSchema = z.object({
  id: z.string().min(1),
  claim: z.string().min(1),
  confidence: z.enum(FINDING_CONFIDENCES),
  uncertainty: z.string().optional(),
  evidence: z.array(evidenceRefSchema).min(1)
});

const pass1ResponseSchema = z.object({
  findings: z.array(findingSchema)
});

const sectionKeyEnum = z.enum(REPORT_SECTION_KEYS);

const pass3ResponseSchema = z.object({
  valid: z.boolean(),
  rejections: z.array(z.object({
    section: z.string().optional(),
    quote: z.string(),
    reason: z.string()
  })).default([])
});

const pass3bResponseSchema = z.object({
  flags: z.array(z.object({
    ruleId: z.string().min(1),
    section: sectionKeyEnum.optional(),
    quote: z.string(),
    issue: z.string().min(1),
    severity: z.enum(REFERENCE_FLAG_SEVERITIES)
  }))
});

interface CohortType {
  cohort: 'adult' | 'pediatric' | 'generic';
  type: 'hsat' | 'psg' | 'generic';
}

function detectCohortAndType(casePackageJson: string): CohortType {
  try {
    const pkg = JSON.parse(casePackageJson) as Record<string, unknown>;
    const rawCohort = pkg['cohort'];
    const cohort: CohortType['cohort'] =
      rawCohort === 'pediatric' ? 'pediatric' : rawCohort === 'adult' ? 'adult' : 'generic';
    return { cohort, type: 'hsat' };
  } catch {
    return { cohort: 'generic', type: 'hsat' };
  }
}

interface CompactRule {
  ruleId: string;
  rule: string;
  appliesTo: string;
}

function compactRulesForPrompt(docs: ReferenceDoc[]): CompactRule[] {
  const out: CompactRule[] = [];
  for (const d of docs) {
    try {
      const parsed = JSON.parse(d.content) as { rule?: string; appliesTo?: string };
      if (parsed.rule && parsed.appliesTo) {
        out.push({ ruleId: d.id, rule: parsed.rule, appliesTo: parsed.appliesTo });
      }
    } catch { /* skip non-JSON ref content */ }
  }
  return out;
}

function sectionHasContent(report: StructuredReport, key: typeof REPORT_SECTION_KEYS[number]): boolean {
  const v = report[key];
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (typeof v === 'object') {
    return Object.values(v as Record<string, unknown>).some((vv) => {
      if (vv === undefined || vv === null) return false;
      if (Array.isArray(vv)) return vv.length > 0;
      if (typeof vv === 'string') return vv.trim().length > 0;
      return true;
    });
  }
  return false;
}

// Pass 3 sometimes emits "rejections" whose own reason text admits the fragment is fine
// ("supported by the cited findings", "no action", "acceptable as written"). Filter these
// out so the reviewer is not shown warnings the LLM itself thinks are non-issues.
const _NON_ACTIONABLE_REASON_PATTERNS = [
  /\bno action\b/i,
  /\bnot rejected\b/i,
  /\bacceptable as written\b/i,
  /\bsupported by (the )?(cited )?findings?\b/i,
];

function isNonActionableRejection(reason: string): boolean {
  return _NON_ACTIONABLE_REASON_PATTERNS.some((p) => p.test(reason));
}

function validateCitations(
  report: StructuredReport,
  findings: Finding[]
): { valid: boolean; rejections: Array<{ section: typeof REPORT_SECTION_KEYS[number]; quote: string; reason: string }> } {
  const findingIds = new Set(findings.map((f) => f.id));
  const rejections: Array<{ section: typeof REPORT_SECTION_KEYS[number]; quote: string; reason: string }> = [];

  for (const key of REPORT_SECTION_KEYS) {
    if (!sectionHasContent(report, key)) continue;
    const cited = report.citations[key] ?? [];
    if (cited.length === 0) {
      rejections.push({ section: key, quote: JSON.stringify(report[key]), reason: 'Section has values but no citations' });
      continue;
    }
    for (const id of cited) {
      if (!findingIds.has(id)) {
        rejections.push({ section: key, quote: id, reason: `Cited finding ${id} does not exist` });
      }
    }
  }

  return { valid: rejections.length === 0, rejections };
}

const MAX_ANALYSIS_IMAGE_BYTES = 10 * 1024 * 1024;

function isWithinDirectory(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

async function loadChartAsBase64(chartPath: string): Promise<{ b64: string; mime: string } | null> {
  const clean = chartPath.startsWith('chart:') ? chartPath.slice(6) : chartPath;
  try {
    const root = await realpath(path.resolve(CHARTS_DIR));
    const requested = path.resolve(root, clean);
    if (!isWithinDirectory(root, requested)) return null;
    const stat = await lstat(requested);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ANALYSIS_IMAGE_BYTES) return null;
    const resolved = await realpath(requested);
    if (!isWithinDirectory(root, resolved)) return null;
    const ext = path.extname(resolved).toLowerCase();
    const mime = ext === '.png'
      ? 'image/png'
      : ext === '.webp'
        ? 'image/webp'
        : ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : null;
    if (!mime) return null;
    const buf = await readFile(resolved);
    return { b64: buf.toString('base64'), mime };
  } catch {
    return null;
  }
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail: 'low' } };

type ScreenshotMeta = { id: string; originalName: string };

async function loadScreenshotAsBase64(
  caseId: string,
  screenshotId: string
): Promise<{ b64: string; mime: string } | null> {
  try {
    const dir = path.join(SCREENSHOTS_DIR, caseId);
    const files = await readdir(dir).catch(() => [] as string[]);
    const filename = files.find((f) => f.startsWith(`${screenshotId}-`));
    if (!filename) return null;
    const screenshotPath = path.join(dir, filename);
    const stat = await lstat(screenshotPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ANALYSIS_IMAGE_BYTES) return null;
    const buf = await readFile(screenshotPath);
    const ext = path.extname(filename).toLowerCase();
    const mime =
      ext === '.png'  ? 'image/png'  :
      ext === '.gif'  ? 'image/gif'  :
      ext === '.webp' ? 'image/webp' :
      'image/jpeg';
    return { b64: buf.toString('base64'), mime };
  } catch {
    return null;
  }
}

async function buildPass1UserContent(
  casePackageJson: string,
  caseId: string
): Promise<ContentBlock[]> {
  let candidates: CandidateWindow[] = [];
  let pkg: Record<string, unknown> = {};
  let packageParsed = false;
  try {
    pkg = JSON.parse(casePackageJson) as Record<string, unknown>;
    packageParsed = true;
    const raw = pkg['candidate_windows'];
    if (Array.isArray(raw)) candidates = raw as CandidateWindow[];
  } catch { /* malformed package - proceed without budgeting */ }

  const blocks: ContentBlock[] = [];

  if (candidates.length === 0) {
    blocks.push({
      type: 'text',
      text: untrustedJson('case-package', packageParsed ? pkg : { malformedPackage: casePackageJson }),
    });
  } else {
    const budget = selectCandidates(candidates, caseId);

    let trimmedPackage: Record<string, unknown>;
    try {
      trimmedPackage = { ...pkg };
      trimmedPackage['candidate_windows'] = budget.textCandidates.map(({ chart_path: _cp, ...rest }) => rest);
      trimmedPackage['token_budget'] = {
        selected: budget.textCandidates.length,
        images_attached: budget.imageCandidates.length,
        estimated_tokens: budget.estimatedTokens,
        dropped: budget.droppedCount,
      };
    } catch {
      trimmedPackage = pkg;
    }

    blocks.push({ type: 'text', text: untrustedJson('case-package', trimmedPackage) });

    for (const c of budget.imageCandidates) {
      if (!c.chart_path) continue;
      const image = await loadChartAsBase64(c.chart_path);
      if (!image) continue;
      blocks.push({
        type: 'image_url',
        image_url: { url: `data:${image.mime};base64,${image.b64}`, detail: 'low' },
      });
      blocks.push({
        type: 'text',
        text: untrustedJson('chart-context', {
          label: c.label,
          startSec: c.start_sec,
          endSec: c.end_sec,
          magnitude: c.magnitude,
          priorityScore: c.priority_score,
        }),
      });
    }
  }

  // Append user-uploaded screenshots (clinical context images, e.g. device display captures)
  const screenshotMeta = Array.isArray(pkg['screenshot_metadata'])
    ? (pkg['screenshot_metadata'] as ScreenshotMeta[])
    : [];
  for (const ss of screenshotMeta.slice(0, 8)) {
    const img = await loadScreenshotAsBase64(caseId, ss.id);
    if (!img) continue;
    blocks.push({
      type: 'image_url',
      image_url: { url: `data:${img.mime};base64,${img.b64}`, detail: 'low' },
    });
    blocks.push({
      type: 'text',
      text: untrustedJson('screenshot-context', { name: ss.originalName }),
    });
  }

  return blocks;
}

export async function runAnalysis(
  caseId: string,
  res: Response,
  signal: AbortSignal,
  modelId?: string
): Promise<void> {
  const model = validateModel(modelId) ?? GPT_MODEL;

  const c = getCaseById(caseId);
  if (!c) {
    sse(res, { type: 'error', message: 'Case not found' });
    res.end();
    return;
  }

  const casePackageJson = c.casePackage ?? JSON.stringify({ note: 'No preprocessed case package' });

  let isDocumentsOnly = false;
  try {
    const pkg = JSON.parse(casePackageJson) as Record<string, unknown>;
    isDocumentsOnly = pkg['edf_available'] === false;
  } catch { /* malformed package - proceed, Pass 1 will surface the issue */ }

  if (isDocumentsOnly) {
    sse(res, { type: 'documents_only_mode', message: 'No EDF available - analysis uses PDF metrics and screenshots only.' });
  }

  const tokenStats: TokenStats = { pass1In: 0, pass1Out: 0, pass2In: 0, pass2Out: 0, pass3In: 0, pass3Out: 0 };
  const { cohort: caseCohort } = detectCohortAndType(casePackageJson);

  try {
    // ── Pass 1: structured fact extraction ────────────────────────────────
    sse(res, { type: 'progress', pass: 1, message: 'Extracting findings…' });

    const pass1UserContent = await buildPass1UserContent(casePackageJson, caseId);

    const pass1 = await callPass({
      model,
      max_completion_tokens: 16384,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: isDocumentsOnly ? pass1SystemPromptDocumentsOnly(caseCohort) : pass1SystemPrompt(caseCohort) },
        { role: 'user', content: pass1UserContent }
      ]
    }, signal);

    if (!pass1) { res.end(); return; }

    tokenStats.pass1In       = pass1.tokensIn;
    tokenStats.pass1Out      = pass1.tokensOut;
    tokenStats.pass1CacheRead = pass1.cacheReadTokens;

    if (pass1.truncated) {
      logger.error({ tokensIn: tokenStats.pass1In, tokensOut: tokenStats.pass1Out }, 'pass1_truncated');
      sse(res, { type: 'error', message: 'Pass 1 response was truncated - too many findings or images. Try with fewer screenshots.' });
      res.end();
      return;
    }

    const pass1Text = pass1.text;
    let rawFindings: Finding[];
    try {
      const parsed = pass1ResponseSchema.parse(JSON.parse(pass1Text));
      rawFindings = parsed.findings as Finding[];
    } catch {
      logger.error({ caseId }, 'pass1_parse_error');
      sse(res, { type: 'error', message: 'Pass 1 produced invalid JSON - please try again' });
      res.end();
      return;
    }

    // Hard validator: reject findings without evidence
    const evidenceFiltered = rawFindings.filter((f) => f.evidence.length > 0);
    if (evidenceFiltered.length < rawFindings.length) {
      logger.warn(
        { dropped: rawFindings.length - evidenceFiltered.length },
        'pass1_findings_dropped_no_evidence'
      );
    }

    // Deterministic metric bounds check - runs before Pass 2 so impossible
    // values never reach the structured report.
    const boundsCheckCohort = caseCohort;
    const validatedFindings: Finding[] = [];
    for (const f of evidenceFiltered) {
      let drop = false;
      const uncertaintyNotes: string[] = f.uncertainty ? [f.uncertainty] : [];
      for (const ev of f.evidence) {
        if (typeof ev.value !== 'number') continue;
        const outcome = checkMetricBounds(ev.source, ev.value, boundsCheckCohort);
        if (outcome.kind === 'impossible') {
          logger.warn('metric_impossible_value_dropped');
          drop = true;
          break;
        }
        if (outcome.kind === 'out_of_range') {
          uncertaintyNotes.push(outcome.note);
        }
      }
      if (!drop) {
        validatedFindings.push(
          uncertaintyNotes.length > 0
            ? { ...f, uncertainty: uncertaintyNotes.join('; ') }
            : f
        );
      }
    }
    if (validatedFindings.length < evidenceFiltered.length) {
      logger.warn(
        { dropped: evidenceFiltered.length - validatedFindings.length },
        'metric_impossible_values_dropped'
      );
    }

    // Remap LLM-generated IDs to stable sequential F-001, F-002, … so Pass 2/3
    // can cite them reliably and the report never shows raw UUIDs.
    const idMap = new Map(
      validatedFindings.map((f, i) => [f.id, `F-${String(i + 1).padStart(3, '0')}`])
    );
    for (const f of validatedFindings) {
      f.id = idMap.get(f.id)!;
    }

    sse(res, { type: 'progress', pass: 1, message: `Extracted ${validatedFindings.length} findings` });
    sse(res, { type: 'stage_complete', pass: 1, tokensIn: tokenStats.pass1In, tokensOut: tokenStats.pass1Out, findingCount: validatedFindings.length });

    // ── Pass 2: structured report draft ────────────────────────────────────
    sse(res, { type: 'progress', pass: 2, message: 'Drafting structured report…' });

    const pass2 = await callPass({
      model,
      max_completion_tokens: 4096,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: pass2SystemPrompt(caseCohort) },
        { role: 'user', content: untrustedJson('validated-findings', validatedFindings) }
      ]
    }, signal);

    if (!pass2) { res.end(); return; }

    tokenStats.pass2In       = pass2.tokensIn;
    tokenStats.pass2Out      = pass2.tokensOut;
    tokenStats.pass2CacheRead = pass2.cacheReadTokens;

    if (pass2.truncated) {
      logger.error({ tokensIn: tokenStats.pass2In, tokensOut: tokenStats.pass2Out, findingCount: validatedFindings.length }, 'pass2_truncated');
      sse(res, { type: 'error', message: 'Pass 2 response was truncated - too many findings to fit in the report. Try with fewer screenshots.' });
      res.end();
      return;
    }

    const pass2Raw = pass2.text;
    const parseOutcome = parsePass2Output(pass2Raw);
    const validationWarnings: ValidationWarning[] = [];
    if (!parseOutcome.ok) {
      logger.error({ caseId }, 'pass2_parse_error');
      sse(res, { type: 'error', message: 'Pass 2 produced invalid structured report JSON' });
      res.end();
      return;
    }
    const structuredReport: StructuredReport = parseOutcome.report;
    if (parseOutcome.coerced) {
      logger.warn({ warningCount: parseOutcome.warnings.length, caseId }, 'pass2_output_coerced');
      for (const w of parseOutcome.warnings) {
        validationWarnings.push({ stage: 'citation_check', section: 'summary', quote: '', reason: `Pass 2 output coerced: ${w}` });
      }
    }

    // Deterministic citation pre-check - collected as advisory warnings, not a hard block.
    const localCheck = validateCitations(structuredReport, validatedFindings);
    if (!localCheck.valid) {
      logger.warn({ warningCount: localCheck.rejections.length, caseId }, 'pass2_citation_check_warnings');
      for (const r of localCheck.rejections) {
        validationWarnings.push({ stage: 'citation_check', section: r.section, quote: r.quote, reason: r.reason });
      }
    }

    sse(res, { type: 'progress', pass: 2, message: 'Structured report drafted' });
    sse(res, { type: 'stage_complete', pass: 2, tokensIn: tokenStats.pass2In, tokensOut: tokenStats.pass2Out });

    // ── Pass 3: skeptical validator ────────────────────────────────────────
    sse(res, { type: 'progress', pass: 3, message: 'Validating report sections…' });

    const pass3 = await callPass({
      model: NANO_MODEL,
      max_completion_tokens: 4096,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: pass3SystemPrompt() },
        {
          role: 'user',
          content: [
            untrustedJson('structured-report', structuredReport),
            untrustedJson('validated-findings', validatedFindings),
          ].join('\n\n'),
        }
      ]
    }, signal);

    if (!pass3) { res.end(); return; }

    tokenStats.pass3In       = pass3.tokensIn;
    tokenStats.pass3Out      = pass3.tokensOut;
    tokenStats.pass3CacheRead = pass3.cacheReadTokens;

    const pass3Text = pass3.text;
    let validationResult: z.infer<typeof pass3ResponseSchema>;
    if (pass3.truncated) {
      logger.warn({ caseId, tokensOut: tokenStats.pass3Out }, 'pass3_truncated');
      validationResult = { valid: false, rejections: [{ quote: '', reason: 'Validator response was truncated' }] };
    } else {
      try {
        validationResult = pass3ResponseSchema.parse(JSON.parse(pass3Text));
      } catch {
        logger.warn({ caseId }, 'pass3_json_parse_error');
        validationResult = { valid: false, rejections: [{ quote: '', reason: 'Validator returned invalid JSON' }] };
      }
    }

    if (!validationResult.valid) {
      logger.warn({ warningCount: validationResult.rejections.length, caseId }, 'pass3_validation_warnings');
      for (const r of validationResult.rejections) {
        if (isNonActionableRejection(r.reason)) continue;
        const w: ValidationWarning = { stage: 'pass3', quote: r.quote, reason: r.reason };
        if (r.section && (REPORT_SECTION_KEYS as readonly string[]).includes(r.section)) w.section = r.section as ReportSectionKey;
        validationWarnings.push(w);
      }
    }

    sse(res, {
      type: 'progress',
      pass: 3,
      message: validationWarnings.length > 0
        ? `Validation produced ${validationWarnings.length} warning(s)`
        : 'Validation passed'
    });
    if (validationWarnings.length > 0) {
      sse(res, { type: 'validation_warnings', warnings: validationWarnings });
    }
    sse(res, { type: 'stage_complete', pass: 3, tokensIn: tokenStats.pass3In, tokensOut: tokenStats.pass3Out, warningCount: validationWarnings.length });

    // ── Pass 3b: reference cross-check (advisory) ──────────────────────────
    const referenceDocs = getReferenceStatus().enabled
      ? getReferenceDocsForCohortAndType(caseCohort, 'hsat').filter((doc) => isReferenceRuleActive(doc.id))
      : [];
    const compactRules = compactRulesForPrompt(referenceDocs);
    let referenceFlags: ReferenceFlag[] = [];

    if (compactRules.length > 0) {
      sse(res, { type: 'progress', pass: 3, message: `Reference cross-check (${compactRules.length} rules)…` });
      const pass3bTokenBaseIn  = tokenStats.pass3In;
      const pass3bTokenBaseOut = tokenStats.pass3Out;
      try {
        const pass3b = await callPass({
          model: NANO_MODEL,
          max_completion_tokens: 1024,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: pass3bReferenceCheckPrompt() },
            {
              role: 'user',
              content: [
                untrustedJson('cohort', caseCohort),
                untrustedJson('reference-rules', compactRules),
                untrustedJson('structured-report', structuredReport),
                untrustedJson('validated-findings', validatedFindings),
              ].join('\n\n'),
            }
          ]
        }, signal);

        if (!pass3b) { res.end(); return; }

        tokenStats.pass3In        += pass3b.tokensIn;
        tokenStats.pass3Out       += pass3b.tokensOut;
        tokenStats.pass3CacheRead  = (tokenStats.pass3CacheRead ?? 0) + pass3b.cacheReadTokens;

        const pass3bText = pass3b.text;
        const parsedFlags = pass3bResponseSchema.safeParse(JSON.parse(pass3bText));
        if (parsedFlags.success) {
          const knownRuleIds = new Set(compactRules.map((r) => r.ruleId));
          const accepted = parsedFlags.data.flags.filter((f) => knownRuleIds.has(f.ruleId));
          referenceFlags = accepted.map((f) => ({
            ruleId: f.ruleId,
            quote: f.quote,
            issue: f.issue,
            severity: f.severity,
            ...(f.section ? { section: f.section } : {}),
          }));
          if (accepted.length < parsedFlags.data.flags.length) {
            logger.warn(
              { dropped: parsedFlags.data.flags.length - accepted.length, caseId },
              'pass3b_flags_dropped_unknown_rule_id'
            );
          }
        } else {
          logger.warn({ issueCount: parsedFlags.error.issues.length, caseId }, 'pass3b_parse_error');
        }
      } catch (err) {
        logger.warn({ ...errorLogFields(err), caseId }, 'pass3b_failed_continuing');
      }
      sse(res, { type: 'reference_flags', flags: referenceFlags });
      sse(res, {
        type: 'stage_complete',
        pass: '3b',
        tokensIn: tokenStats.pass3In - pass3bTokenBaseIn,
        tokensOut: tokenStats.pass3Out - pass3bTokenBaseOut,
        flagCount: referenceFlags.length,
      });
    } else {
      sse(res, {
        type: 'warning',
        code: 'reference_pack_unavailable',
        message: 'Deterministic reference checks are disabled for this analysis.',
      });
    }

    // ── Persist ────────────────────────────────────────────────────────────
    const now = nextCaseUpdatedAt(c.updatedAt);
    const narrative = structuredReport.impression;
    const findingsPendingReview = validatedFindings.map(({ reviewerDecision: _decision, reviewedAt: _reviewedAt, editedClaim: _editedClaim, ...finding }) => finding);
    const persisted = updateCaseFindings(
      caseId,
      findingsPendingReview,
      narrative,
      model,
      now,
      structuredReport,
      referenceFlags,
      validationWarnings,
      c.updatedAt
    );
    if (!persisted) {
      sse(res, { type: 'error', message: 'Case changed while analysis was running; the stale draft was not saved.' });
      return;
    }
    updateCaseTokenStats(caseId, tokenStats, now);
    if (c.createdBy) {
      const totalIn  = tokenStats.pass1In  + tokenStats.pass2In  + tokenStats.pass3In;
      const totalOut = tokenStats.pass1Out + tokenStats.pass2Out + tokenStats.pass3Out;
      insertAnalysisAuditRecord(caseId, c.createdBy, totalIn, totalOut);
    }
    insertAuditRecord({
      id: randomUUID(),
      caseId,
      action: 'analysis_completed',
      metadata: {
        promptVersion: PROMPT_VERSION,
        modelVersion: model,
        findingCount: findingsPendingReview.length,
        referenceFlagCount: referenceFlags.length,
        validationWarningCount: validationWarnings.length,
        tokenStats,
      },
      createdAt: now
    });

    sse(res, {
      type: 'done',
      findings: findingsPendingReview,
      narrative,
      structuredReport,
      referenceFlags,
      validationWarnings,
      modelVersion: model,
      promptVersion: PROMPT_VERSION,
      tokenStats,
    });
  } catch (err) {
    const isAbort =
      signal.aborted ||
      (err instanceof Error && (err.name === 'AbortError' || err.name === 'APIUserAbortError'));
    if (isAbort) {
      logger.info({ caseId }, 'analysis_aborted');
    } else {
      logger.error({ ...errorLogFields(err), caseId }, 'analysis_error');
      sse(res, { type: 'error', message: safeAnalysisErrorMessage(err) });
    }
  } finally {
    res.end();
  }
}

const actionPlanItemSchema = z.object({
  action: z.string().min(1),
  rationale: z.string().min(1),
  findingIds: z.array(z.string())
});

const actionPlanResponseSchema = z.object({
  priorityActions: z.array(actionPlanItemSchema).default([]),
  verifyNext: z.array(actionPlanItemSchema).default([]),
  artifactCaveats: z.array(z.object({
    findingId: z.string().min(1),
    concern: z.string().min(1)
  })).default([]),
  clinicalContext: z.object({
    commonPresentation: z.string().min(1),
    rareButRelevant: z.array(z.string()).default([]),
    treatmentEvidence: z.string().optional()
  }),
  evidenceReferences: z.array(z.object({
    name: z.string().min(1),
    year: z.string().min(1),
    source: z.string().min(1),
    relevance: z.string().min(1)
  })).default([])
});

export async function runActionPlan(
  caseId: string,
  res: Response,
  signal: AbortSignal,
  modelId?: string
): Promise<void> {
  const model = validateModel(modelId) ?? GPT_MODEL;

  const c = getCaseById(caseId);
  if (!c) {
    sse(res, { type: 'error', message: 'Case not found' });
    res.end();
    return;
  }

  if (!c.findings?.length || !c.structuredReport) {
    sse(res, { type: 'error', message: 'Case has no analysis to base the action plan on. Run analysis first.' });
    res.end();
    return;
  }

  const cohort = c.cohort ?? 'adult';

  // High-confidence findings anchor recommendations; medium provide supporting context.
  // Low-confidence findings are included so the LLM can surface them in verifyNext.
  if (c.findings.some((finding) => !finding.reviewerDecision) || unreviewedSectionKeys(c).length > 0) {
    sse(res, { type: 'error', message: 'Review all findings and populated report sections before generating an action plan.' });
    res.end();
    return;
  }

  const findingsForPlan = reviewedFindingsForActionPlan(c);
  if (findingsForPlan.length === 0) {
    sse(res, { type: 'error', message: 'No accepted or uncertain findings remain for an action plan.' });
    res.end();
    return;
  }
  const reportForPlan = reviewedReportForActionPlan(c);

  try {
    sse(res, { type: 'progress', pass: 4, message: 'Generating action plan…' });

    const userContent = [
      untrustedJson('cohort', cohort),
      untrustedJson('reviewed-findings', findingsForPlan),
      untrustedJson('structured-report', reportForPlan),
    ].join('\n\n');

    const pass4 = await callPass({
      model,
      max_completion_tokens: ACTION_PLAN_MAX_OUTPUT_TOKENS,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: pass4ActionPlanPrompt(cohort) },
        { role: 'user', content: userContent }
      ]
    }, signal);

    if (!pass4) { res.end(); return; }

    const tokensIn         = pass4.tokensIn;
    const tokensOut        = pass4.tokensOut;
    const pass4CacheRead   = pass4.cacheReadTokens;

    const rawText = pass4.text;
    let parsed: z.infer<typeof actionPlanResponseSchema>;
    try {
      parsed = actionPlanResponseSchema.parse(JSON.parse(rawText));
    } catch {
      logger.error({ caseId }, 'pass4_parse_error');
      sse(res, { type: 'error', message: 'Action plan produced invalid JSON' });
      res.end();
      return;
    }

    // Guard: only reference finding IDs that actually exist in this case
    const knownIds = new Set(findingsForPlan.map((finding) => finding.id));
    const priorityIds = new Set(findingsForPlan
      .filter((finding) => finding.confidence === 'high'
        && (finding.reviewerDecision === 'confirm' || finding.reviewerDecision === 'edit'))
      .map((finding) => finding.id));
    const sanitiseItems = (
      items: z.infer<typeof actionPlanItemSchema>[],
      allowedIds: Set<string>
    ) => items
      .map((item) => ({ ...item, findingIds: [...new Set(item.findingIds.filter((id) => allowedIds.has(id)))] }))
      .filter((item) => item.findingIds.length > 0);
    const sanitised: ActionPlan = {
      priorityActions: sanitiseItems(parsed.priorityActions, priorityIds),
      verifyNext: sanitiseItems(parsed.verifyNext, knownIds),
      artifactCaveats: parsed.artifactCaveats.filter((a) => knownIds.has(a.findingId)),
      clinicalContext: {
        commonPresentation: parsed.clinicalContext.commonPresentation,
        rareButRelevant: [],
      },
      generatedAt: new Date().toISOString(),
      modelVersion: model,
      promptVersion: ACTION_PLAN_PROMPT_VERSION,
      tokensIn,
      tokensOut,
    };

    const now = nextCaseUpdatedAt(c.updatedAt);
    const persisted = updateCaseActionPlan(caseId, sanitised, now, c.updatedAt);
    if (!persisted) {
      sse(res, { type: 'error', message: 'Case changed while the action plan was running; the stale draft was not saved.' });
      return;
    }

    // Merge pass4 token counts into existing tokenStats
    const existing = c.tokenStats ?? { pass1In: 0, pass1Out: 0, pass2In: 0, pass2Out: 0, pass3In: 0, pass3Out: 0 };
    updateCaseTokenStats(caseId, { ...existing, pass4In: tokensIn, pass4Out: tokensOut, pass4CacheRead }, now);
    if (c.createdBy) {
      insertAnalysisAuditRecord(caseId, c.createdBy, tokensIn, tokensOut);
    }

    insertAuditRecord({
      id: randomUUID(),
      caseId,
      action: 'action_plan_generated',
      metadata: {
        promptVersion: ACTION_PLAN_PROMPT_VERSION,
        modelVersion: model,
        priorityActionCount: sanitised.priorityActions.length,
        verifyNextCount: sanitised.verifyNext.length,
        artifactCaveatCount: sanitised.artifactCaveats.length,
        tokensIn,
        tokensOut,
      },
      createdAt: now
    });

    sse(res, { type: 'stage_complete', pass: 4, tokensIn, tokensOut });
    sse(res, { type: 'done', actionPlan: sanitised });
  } catch (err) {
    const isAbort =
      signal.aborted ||
      (err instanceof Error && (err.name === 'AbortError' || err.name === 'APIUserAbortError'));
    if (isAbort) {
      logger.info({ caseId }, 'action_plan_aborted');
    } else {
      logger.error({ ...errorLogFields(err), caseId }, 'action_plan_error');
      sse(res, { type: 'error', message: safeAnalysisErrorMessage(err) });
    }
  } finally {
    res.end();
  }
}

function safeAnalysisErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'Analysis failed unexpectedly. Please try again.';
  const status = (err as { status?: number }).status;
  const msg = err.message.toLowerCase();
  if (status === 429 || msg.includes('rate limit')) {
    return 'Analysis service is busy - please wait a moment and try again.';
  }
  if (status === 401 || msg.includes('api key') || msg.includes('authentication')) {
    return 'Analysis service configuration error. Please contact support.';
  }
  if (msg.includes('quota') || msg.includes('billing') || msg.includes('insufficient_quota')) {
    return 'Analysis service is currently unavailable. Please contact support.';
  }
  if (msg.includes('context_length_exceeded') || msg.includes('maximum context length')) {
    return 'Study data is too large to analyse in one request. Please contact support.';
  }
  if (msg.includes('econnrefused') || msg.includes('fetch failed') || msg.includes('enotfound') || msg.includes('etimedout')) {
    return 'Could not reach the analysis service. Please try again.';
  }
  return 'Analysis failed unexpectedly. Please try again.';
}

function validateModel(modelId: string | undefined): AllowedModel | null {
  if (!modelId) return null;
  if ((ALLOWED_MODELS as readonly string[]).includes(modelId)) {
    return modelId as AllowedModel;
  }
  return null;
}
