// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { createRequire } from 'node:module';
import type { Request, Response } from 'express';
import { PREPROCESSOR_URL } from '../constants.js';
import { requireDemoUser, requirePublicDemoMode } from '../middleware/auth.js';
import { logger, errorLogFields } from '../logger.js';
import { sendError } from '../errors.js';
import { DEMO_STUDY_FILENAME, DemoStudyUnavailableError, fetchDemoStudy } from '../demoStudy.js';

const require = createRequire(import.meta.url);
const express = require('express') as typeof import('express');

const PREPROCESSOR_TIMEOUT_MS = 20_000;

/**
 * The demo study lives in the preprocessor, which owns the EDF writer, so these
 * routes pass it through rather than reimplementing the generator. The file is
 * then uploaded through the ordinary `/api/upload` path: the demo takes no
 * shortcut around validation, de-identification, or preprocessing.
 */
export function createDemoRouter() {
  const router = express.Router();

  router.use(requirePublicDemoMode);
  router.use(requireDemoUser);

  router.get('/study.edf', async (_req: Request, res: Response): Promise<void> => {
    try {
      const body = await fetchDemoStudy();
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${DEMO_STUDY_FILENAME}"`);
      res.send(body);
    } catch (err) {
      if (err instanceof DemoStudyUnavailableError) {
        logger.error('demo_study_upstream_failed');
        sendError(res, 502, 'DEMO_STUDY_UNAVAILABLE', 'The demo study could not be generated.');
        return;
      }
      logger.error(errorLogFields(err), 'demo_study_request_failed');
      sendError(
        res,
        502,
        'PREPROCESSOR_UNREACHABLE',
        'Preprocessing service is unreachable. Please try again.',
      );
    }
  });

  router.get('/summary', async (_req: Request, res: Response): Promise<void> => {
    try {
      const upstream = await fetch(`${PREPROCESSOR_URL}/demo/summary`, {
        signal: AbortSignal.timeout(PREPROCESSOR_TIMEOUT_MS),
      });
      if (!upstream.ok) {
        await upstream.body?.cancel();
        sendError(res, 502, 'DEMO_STUDY_UNAVAILABLE', 'The demo study could not be described.');
        return;
      }
      res.json(await upstream.json());
    } catch (err) {
      logger.error(errorLogFields(err), 'demo_summary_request_failed');
      sendError(
        res,
        502,
        'PREPROCESSOR_UNREACHABLE',
        'Preprocessing service is unreachable. Please try again.',
      );
    }
  });

  return router;
}
