// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';
import type { Request, Response, Router } from 'express';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { lstat, realpath, rm, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  getCaseByIdScoped,
  getCases,
  getCasesScoped,
  updateCaseStatusWithAudit,
  getAuditLog,
  updateFindingDecisionWithAudit,
  updateSectionReviewWithAudit,
  deleteCase,
  clearCaseAnalysisWithAudit,
  deleteAllCases,
  clearAllAnalyses,
  updateCasePackage,
  signOffCaseWithAudit,
  nextCaseUpdatedAt,
} from '../db.js';
import type { CaseScope } from '../db.js';
import {
  CASE_STATUSES,
  ALLOWED_MODELS,
  ENABLE_BULK_CASE_DELETE,
  CHARTS_DIR,
  SLICES_DIR,
  SCREENSHOTS_DIR,
  MAX_SIGNAL_SLICES_BYTES,
} from '../constants.js';
import { REPORT_SECTION_KEYS } from '../shared/types.js';
import type { ReportSectionKey } from '../shared/types.js';
import { logger, hashIp, errorLogFields } from '../logger.js';
import { runAnalysis, runActionPlan } from '../analyze.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { reviewedFindingsForActionPlan, unreviewedSectionKeys } from '../shared/review.js';
import { DEMO_MAX_CONCURRENT_ANALYSES } from '../demo.js';

const require = createRequire(import.meta.url);
const express = require('express') as typeof import('express');

const statusPatchSchema = z.object({
  status: z.enum(CASE_STATUSES),
});

const REVIEWER_DECISIONS = ['confirm', 'reject', 'uncertain', 'edit', 'artefact'] as const;

const findingDecisionSchema = z.object({
  decision: z.enum(REVIEWER_DECISIONS),
  editedClaim: z.string().min(1).optional(),
});

const sectionReviewSchema = z.object({
  decision: z.enum(REVIEWER_DECISIONS),
  editedValue: z.string().min(1).optional(),
});

const signOffSchema = z
  .object({
    actorId: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

const analyzeBodySchema = z.object({
  modelId: z.enum(ALLOWED_MODELS).optional(),
});

export const activeAnalyses = new Set<string>();
let activeDemoAnalyses = 0;

function scopeOf(req: Request): CaseScope {
  const user = req.user!;
  return {
    userId: user.id,
    organizationId: user.isDemo ? null : user.organizationId,
    ...(user.isDemo ? { demoOnly: true } : {}),
  };
}

function pathWithin(rootPath: string, childName: string): string | null {
  const root = path.resolve(rootPath);
  const child = path.resolve(root, childName);
  const relative = path.relative(root, child);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    return null;
  return child;
}

async function cleanupCaseArtifacts(caseId: string, studyHash: string): Promise<void> {
  const removals: Array<Promise<void>> = [];
  const screenshotDirectory = pathWithin(SCREENSHOTS_DIR, caseId);
  if (screenshotDirectory) removals.push(rm(screenshotDirectory, { recursive: true, force: true }));

  if (/^[a-f0-9]{64}$/.test(studyHash)) {
    const slicePath = pathWithin(SLICES_DIR, `${studyHash}.json`);
    if (slicePath) removals.push(rm(slicePath, { force: true }));
    const chartFiles = await readdir(CHARTS_DIR).catch(() => [] as string[]);
    for (const filename of chartFiles.filter((entry) => entry.startsWith(`${studyHash}_`))) {
      const chartPath = pathWithin(CHARTS_DIR, filename);
      if (chartPath) removals.push(rm(chartPath, { force: true }));
    }
  }

  const results = await Promise.allSettled(removals);
  if (results.some((result) => result.status === 'rejected')) {
    throw new Error('One or more case artifacts could not be deleted');
  }
}

export function casesRouter(): Router {
  const router = express.Router();

  router.use(requireAuth);

  router.get('/', (req: Request, res: Response): void => {
    const status = typeof req.query['status'] === 'string' ? req.query['status'] : undefined;
    if (status && !CASE_STATUSES.includes(status as (typeof CASE_STATUSES)[number])) {
      res.status(400).json({ error: 'Invalid status filter' });
      return;
    }
    const cases = getCasesScoped(scopeOf(req), status);
    res.json({ cases });
  });

  router.get('/:id', (req: Request, res: Response): void => {
    const rawId = req.params['id'];
    const c = getCaseByIdScoped(typeof rawId === 'string' ? rawId : '', scopeOf(req));
    if (!c) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }
    res.json({ case: c });
  });

  router.get('/:id/audit', (req: Request, res: Response): void => {
    const rawId = req.params['id'];
    const c = getCaseByIdScoped(typeof rawId === 'string' ? rawId : '', scopeOf(req));
    if (!c) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }
    const log = getAuditLog(c.id);
    res.json({ auditLog: log, tokenStats: c.tokenStats ?? null });
  });

  router.get('/:id/signal-slices', async (req: Request, res: Response): Promise<void> => {
    const rawId = req.params['id'];
    const c = getCaseByIdScoped(typeof rawId === 'string' ? rawId : '', scopeOf(req));
    if (!c) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }
    try {
      if (!/^[a-f0-9]{64}$/.test(c.studyHash)) throw new Error('Invalid study hash');
      const slicePath = pathWithin(SLICES_DIR, `${c.studyHash}.json`);
      if (!slicePath) throw new Error('Invalid slice path');
      const [rootPath, resolvedPath, file] = await Promise.all([
        realpath(path.resolve(SLICES_DIR)),
        realpath(slicePath),
        lstat(slicePath),
      ]);
      const relative = path.relative(rootPath, resolvedPath);
      if (
        file.isSymbolicLink() ||
        !file.isFile() ||
        file.size > MAX_SIGNAL_SLICES_BYTES ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      ) {
        throw new Error('Unsafe slice file');
      }
      const raw = await readFile(resolvedPath, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) throw new Error('Invalid slice data');
      const data = parsed;
      // snake_case → camelCase for frontend types
      const slices = data.map((ev: unknown) => {
        const e = ev as Record<string, unknown>;
        return {
          eventId: e['event_id'],
          type: e['type'],
          startSec: e['start_sec'],
          endSec: e['end_sec'],
          magnitude: e['magnitude'],
          tags: e['tags'] ?? [],
          signalSlices: ((e['signal_slices'] as unknown[]) ?? []).map((s: unknown) => {
            const sl = s as Record<string, unknown>;
            return {
              channel: sl['channel'],
              windowStartSec: sl['window_start_sec'],
              windowEndSec: sl['window_end_sec'],
              samples: sl['samples'],
            };
          }),
        };
      });
      res.json({ slices });
    } catch {
      res.json({ slices: [] });
    }
  });

  router.post('/:id/analyze', (req: Request, res: Response): void => {
    const rawId = req.params['id'];
    const id = typeof rawId === 'string' ? rawId : '';
    const c = getCaseByIdScoped(id, scopeOf(req));
    if (!c) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }
    if (c.status === 'signed_off') {
      res.status(409).json({ error: 'Case is signed off' });
      return;
    }

    const jobKey = req.user!.id;
    const isDemoJob = req.user!.isDemo;
    const ipHash = hashIp(req.ip);
    if (activeAnalyses.has(jobKey)) {
      res.status(429).json({ code: 'analysis_in_flight', retryAfterSeconds: 60 });
      return;
    }
    if (isDemoJob && activeDemoAnalyses >= DEMO_MAX_CONCURRENT_ANALYSES) {
      res.status(429).json({ code: 'demo_analysis_capacity', retryAfterSeconds: 60 });
      return;
    }

    const bodyParsed = analyzeBodySchema.safeParse(req.body);
    if (!bodyParsed.success) {
      res.status(400).json({ error: 'Invalid request body', issues: bodyParsed.error.issues });
      return;
    }

    activeAnalyses.add(jobKey);
    if (isDemoJob) activeDemoAnalyses += 1;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const ac = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) ac.abort();
    });

    const modelId = bodyParsed.data.modelId;
    logger.info({ caseId: id, modelId, ipHash }, 'analysis_started');
    runAnalysis(id, res, ac.signal, modelId, isDemoJob ? 'demo' : undefined)
      .catch((err: unknown) => {
        logger.error({ ...errorLogFields(err), caseId: id }, 'analyze_route_error');
      })
      .finally(() => {
        activeAnalyses.delete(jobKey);
        if (isDemoJob) activeDemoAnalyses = Math.max(0, activeDemoAnalyses - 1);
      });
  });

  router.post('/:id/action-plan', (req: Request, res: Response): void => {
    const rawId = req.params['id'];
    const id = typeof rawId === 'string' ? rawId : '';
    const c = getCaseByIdScoped(id, scopeOf(req));
    if (!c) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }
    if (c.status === 'signed_off') {
      res.status(409).json({ error: 'Case is signed off' });
      return;
    }

    if (!c.findings?.length || !c.structuredReport) {
      res
        .status(422)
        .json({ code: 'no_analysis', error: 'Run analysis before generating an action plan.' });
      return;
    }
    const unreviewedFindings = c.findings.filter((finding) => !finding.reviewerDecision);
    const unreviewedSections = unreviewedSectionKeys(c);
    if (unreviewedFindings.length > 0 || unreviewedSections.length > 0) {
      res.status(422).json({
        code: 'review_required',
        error:
          'Review all findings and populated report sections before generating an action plan.',
        unreviewedFindingCount: unreviewedFindings.length,
        unreviewedSections,
      });
      return;
    }
    if (reviewedFindingsForActionPlan(c).length === 0) {
      res.status(422).json({
        code: 'no_reviewed_findings',
        error: 'No accepted or uncertain findings remain for an action plan.',
      });
      return;
    }

    const jobKey = req.user!.id;
    const isDemoJob = req.user!.isDemo;
    if (activeAnalyses.has(jobKey)) {
      res.status(429).json({ code: 'analysis_in_flight', retryAfterSeconds: 60 });
      return;
    }
    if (isDemoJob && activeDemoAnalyses >= DEMO_MAX_CONCURRENT_ANALYSES) {
      res.status(429).json({ code: 'demo_analysis_capacity', retryAfterSeconds: 60 });
      return;
    }
    const bodyParsed = analyzeBodySchema.safeParse(req.body);
    if (!bodyParsed.success) {
      res.status(400).json({ error: 'Invalid request body', issues: bodyParsed.error.issues });
      return;
    }
    activeAnalyses.add(jobKey);
    if (isDemoJob) activeDemoAnalyses += 1;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const ac = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) ac.abort();
    });

    const modelId = bodyParsed.data.modelId;
    const ipHash = hashIp(req.ip);
    logger.info({ caseId: id, modelId, ipHash }, 'action_plan_started');
    runActionPlan(id, res, ac.signal, modelId, isDemoJob ? 'demo' : undefined)
      .catch((err: unknown) => {
        logger.error({ ...errorLogFields(err), caseId: id }, 'action_plan_route_error');
      })
      .finally(() => {
        activeAnalyses.delete(jobKey);
        if (isDemoJob) activeDemoAnalyses = Math.max(0, activeDemoAnalyses - 1);
      });
  });

  router.patch('/:id/status', (req: Request, res: Response): void => {
    const rawId = req.params['id'];
    const id = typeof rawId === 'string' ? rawId : '';
    const c = getCaseByIdScoped(id, scopeOf(req));
    if (!c) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }
    if (c.status === 'signed_off') {
      res.status(409).json({ error: 'Case is signed off' });
      return;
    }

    const parsed = statusPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', issues: parsed.error.issues });
      return;
    }

    const { status } = parsed.data;
    if (status === 'signed_off') {
      res.status(409).json({
        code: 'SIGN_OFF_REQUIRES_REVIEW',
        error: 'Use the sign-off endpoint after reviewing every finding and populated section.',
      });
      return;
    }
    const now = nextCaseUpdatedAt(c.updatedAt);

    const updated = updateCaseStatusWithAudit(id, status, now, {
      id: randomUUID(),
      caseId: id,
      action: `status_changed_to_${status}`,
      actorId: req.user!.id,
      metadata: { previousStatus: c.status },
      createdAt: now,
    });
    if (!updated) {
      res.status(409).json({ error: 'Case is signed off' });
      return;
    }

    logger.info(
      { caseId: id, status, actorId: req.user!.id, ipHash: hashIp(req.ip) },
      'case_status_updated',
    );
    res.json({ ok: true, status });
  });

  router.patch('/:id/findings/:findingId', (req: Request, res: Response): void => {
    const caseId = typeof req.params['id'] === 'string' ? req.params['id'] : '';
    const findingId = typeof req.params['findingId'] === 'string' ? req.params['findingId'] : '';
    const c = getCaseByIdScoped(caseId, scopeOf(req));
    if (!c) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }
    if (c.status === 'signed_off') {
      res.status(409).json({ error: 'Case is signed off' });
      return;
    }

    const parsed = findingDecisionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', issues: parsed.error.issues });
      return;
    }

    const { decision, editedClaim } = parsed.data;
    if (decision === 'edit' && !editedClaim) {
      res.status(400).json({ error: 'editedClaim required when decision is edit' });
      return;
    }

    const now = nextCaseUpdatedAt(c.updatedAt);
    const updated = updateFindingDecisionWithAudit(caseId, findingId, decision, editedClaim, now, {
      id: randomUUID(),
      caseId,
      action: `finding_${decision}`,
      actorId: req.user!.id,
      metadata: { findingId, ...(editedClaim ? { editedClaim } : {}) },
      createdAt: now,
    });
    if (!updated) {
      res.status(404).json({ error: 'Finding not found' });
      return;
    }

    logger.info(
      { caseId, decision, actorId: req.user!.id, ipHash: hashIp(req.ip) },
      'finding_decision',
    );
    res.json({ ok: true, decision });
  });

  router.patch('/:id/sections/:sectionKey', (req: Request, res: Response): void => {
    const caseId = typeof req.params['id'] === 'string' ? req.params['id'] : '';
    const sectionKey = typeof req.params['sectionKey'] === 'string' ? req.params['sectionKey'] : '';
    if (!REPORT_SECTION_KEYS.includes(sectionKey as ReportSectionKey)) {
      res.status(400).json({ error: 'Unknown section key' });
      return;
    }
    const c = getCaseByIdScoped(caseId, scopeOf(req));
    if (!c) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }
    if (c.status === 'signed_off') {
      res.status(409).json({ error: 'Case is signed off' });
      return;
    }
    if (!c.structuredReport) {
      res.status(409).json({ error: 'Case has no structured report - run analysis first' });
      return;
    }

    const parsed = sectionReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', issues: parsed.error.issues });
      return;
    }

    const { decision, editedValue } = parsed.data;
    if (decision === 'edit' && !editedValue) {
      res.status(400).json({ error: 'editedValue required when decision is edit' });
      return;
    }

    const now = nextCaseUpdatedAt(c.updatedAt);
    const ok = updateSectionReviewWithAudit(
      caseId,
      sectionKey as ReportSectionKey,
      { decision, ...(editedValue ? { editedValue } : {}), reviewedAt: now },
      now,
      {
        id: randomUUID(),
        caseId,
        action: `section_${decision}`,
        actorId: req.user!.id,
        metadata: { sectionKey, ...(editedValue ? { editedValue } : {}) },
        createdAt: now,
      },
    );
    if (!ok) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }

    logger.info(
      { caseId, sectionKey, decision, actorId: req.user!.id, ipHash: hashIp(req.ip) },
      'section_decision',
    );
    res.json({ ok: true, decision });
  });

  router.delete('/', requireAdmin, async (req: Request, res: Response): Promise<void> => {
    if (!ENABLE_BULK_CASE_DELETE) {
      res.status(403).json({ error: 'Bulk delete is disabled' });
      return;
    }
    const deletableCases = getCases().filter((candidate) => candidate.status !== 'signed_off');
    const deleted = deleteAllCases();
    const cleanupResults = await Promise.allSettled(
      deletableCases.map((candidate) => cleanupCaseArtifacts(candidate.id, candidate.studyHash)),
    );
    const cleanupFailures = cleanupResults.filter((result) => result.status === 'rejected').length;
    if (cleanupFailures > 0) {
      logger.warn({ cleanupFailures }, 'bulk_case_artifact_cleanup_failed');
    }
    logger.info({ deleted, ipHash: hashIp(req.ip) }, 'bulk_cases_deleted');
    res.json({ ok: true, deleted });
  });

  router.post('/clear-all', requireAdmin, (req: Request, res: Response): void => {
    if (!ENABLE_BULK_CASE_DELETE) {
      res.status(403).json({ error: 'Bulk clear is disabled' });
      return;
    }
    const cleared = clearAllAnalyses();
    logger.info({ cleared, ipHash: hashIp(req.ip) }, 'bulk_analyses_cleared');
    res.json({ ok: true, cleared });
  });

  router.delete(
    '/:id/screenshots/:screenshotId',
    async (req: Request, res: Response): Promise<void> => {
      const id = typeof req.params['id'] === 'string' ? req.params['id'] : '';
      const screenshotId =
        typeof req.params['screenshotId'] === 'string' ? req.params['screenshotId'] : '';
      const c = getCaseByIdScoped(id, scopeOf(req));
      if (!c) {
        res.status(404).json({ error: 'Case not found' });
        return;
      }
      if (c.status === 'signed_off') {
        res.status(409).json({ error: 'Case is signed off' });
        return;
      }
      if (!c.casePackage) {
        res.status(404).json({ error: 'Screenshot not found' });
        return;
      }
      if (c.findings.length > 0 || c.structuredReport) {
        res.status(409).json({ error: 'Clear the analysis before removing source screenshots' });
        return;
      }

      let pkg: Record<string, unknown>;
      try {
        pkg = JSON.parse(c.casePackage) as Record<string, unknown>;
      } catch {
        res.status(500).json({ error: 'Invalid case package' });
        return;
      }

      const metadata = Array.isArray(pkg['screenshot_metadata'])
        ? (pkg['screenshot_metadata'] as Array<{ id: string; originalName: string }>)
        : [];
      const entry = metadata.find((m) => m.id === screenshotId);
      if (!entry) {
        res.status(404).json({ error: 'Screenshot not found' });
        return;
      }

      const screenshotDir = path.join(SCREENSHOTS_DIR, id);
      const files = await readdir(screenshotDir).catch(() => [] as string[]);
      const target = files.find((f) => f.startsWith(`${screenshotId}-`));
      const now = nextCaseUpdatedAt(c.updatedAt);
      const updated = updateCasePackage(
        id,
        JSON.stringify({
          ...pkg,
          screenshot_metadata: metadata.filter((m) => m.id !== screenshotId),
        }),
        now,
        c.updatedAt,
      );
      if (!updated) {
        res.status(409).json({ error: 'Case changed while the screenshot was being removed' });
        return;
      }
      if (target) {
        await rm(path.join(screenshotDir, target), { force: true }).catch((err: unknown) => {
          logger.warn(
            { ...errorLogFields(err), caseId: id, screenshotId },
            'screenshot_file_delete_failed',
          );
        });
      }

      logger.info({ caseId: id, screenshotId, ipHash: hashIp(req.ip) }, 'screenshot_deleted');
      res.json({ ok: true });
    },
  );

  router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
    const rawId = req.params['id'];
    const id = typeof rawId === 'string' ? rawId : '';
    const c = getCaseByIdScoped(id, scopeOf(req));
    if (!c) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }
    if (c.status === 'signed_off') {
      res
        .status(409)
        .json({ error: 'Signed-off cases cannot be deleted via the API. Use the admin CLI.' });
      return;
    }

    const ok = deleteCase(id);
    if (!ok) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }

    try {
      await cleanupCaseArtifacts(c.id, c.studyHash);
    } catch (err) {
      logger.warn({ ...errorLogFields(err), caseId: id }, 'case_artifact_cleanup_failed');
    }

    logger.info({ caseId: id, status: c.status, ipHash: hashIp(req.ip) }, 'case_deleted');
    res.json({ ok: true });
  });

  router.post('/:id/clear-analysis', (req: Request, res: Response): void => {
    const rawId = req.params['id'];
    const id = typeof rawId === 'string' ? rawId : '';
    const c = getCaseByIdScoped(id, scopeOf(req));
    if (!c) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }
    if (c.status === 'signed_off') {
      res.status(409).json({ error: 'Case is signed off' });
      return;
    }

    const now = nextCaseUpdatedAt(c.updatedAt);
    const ok = clearCaseAnalysisWithAudit(id, {
      id: randomUUID(),
      caseId: id,
      action: 'analysis_cleared',
      actorId: req.user!.id,
      metadata: { previousFindingCount: c.findings.length },
      createdAt: now,
    });
    if (!ok) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }

    logger.info({ caseId: id, actorId: req.user!.id, ipHash: hashIp(req.ip) }, 'analysis_cleared');
    res.json({ ok: true });
  });

  router.post('/:id/sign-off', (req: Request, res: Response): void => {
    const rawId = req.params['id'];
    const id = typeof rawId === 'string' ? rawId : '';
    const c = getCaseByIdScoped(id, scopeOf(req));
    if (!c) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }
    if (c.status === 'signed_off') {
      res.status(409).json({ error: 'Already signed off' });
      return;
    }

    const signOffBody = signOffSchema.safeParse(req.body ?? {});
    if (!signOffBody.success) {
      res.status(400).json({ error: 'Invalid request body', issues: signOffBody.error.issues });
      return;
    }

    if (c.findings.length === 0) {
      res.status(422).json({ error: 'No findings to sign off - run analysis first' });
      return;
    }

    const unreviewed = c.findings.filter((f) => !f.reviewerDecision);
    if (unreviewed.length > 0) {
      res.status(422).json({
        error: 'All findings must be reviewed before sign-off',
        unreviewedCount: unreviewed.length,
      });
      return;
    }

    if (c.structuredReport) {
      const unreviewedSections = unreviewedSectionKeys(c);
      if (unreviewedSections.length > 0) {
        res.status(422).json({
          error: 'All populated report sections must be reviewed before sign-off',
          unreviewedSections,
        });
        return;
      }
    }

    const actorId = req.user!.id;
    const now = nextCaseUpdatedAt(c.updatedAt);
    const signedOff = signOffCaseWithAudit(id, now, {
      id: randomUUID(),
      caseId: id,
      action: 'signed_off',
      actorId,
      metadata: {
        reviewerName: signOffBody.data.actorId ?? req.user!.name ?? `User ${actorId.slice(0, 8)}`,
        findingCount: c.findings.length,
        modelVersion: c.modelVersion,
        promptVersion: c.promptVersion,
        studyHash: c.studyHash,
      },
      createdAt: now,
    });
    if (!signedOff) {
      res.status(409).json({ error: 'Already signed off' });
      return;
    }

    logger.info({ caseId: id, actorId, ipHash: hashIp(req.ip) }, 'case_signed_off');
    res.json({ ok: true });
  });

  return router;
}
