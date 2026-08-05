// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';
import type { Request, Response, Router } from 'express';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { insertReferenceDoc, getReferenceDocs, deleteReferenceDoc } from '../db.js';
import { logger, hashIp } from '../logger.js';
import { getReferenceStatus } from '../refs/seedReferenceDocs.js';

const require = createRequire(import.meta.url);
const express = require('express') as typeof import('express');

const COHORTS = ['adult', 'pediatric', 'generic'] as const;
const REF_TYPES = ['hsat', 'psg', 'generic'] as const;
// 'restricted' is accepted on write but never returned on read (AASM Scoring Manual exclusion)
const LICENSES = ['open', 'institutional', 'restricted'] as const;

const createRefSchema = z.object({
  title: z.string().min(1).max(500),
  content: z.string().min(1).max(100_000),
  cohort: z.enum(COHORTS),
  type: z.enum(REF_TYPES),
  license: z.enum(LICENSES),
});

export function referencesRouter(): Router {
  const router = express.Router();

  router.get('/status', (_req: Request, res: Response): void => {
    res.json(getReferenceStatus());
  });

  router.get('/', (req: Request, res: Response): void => {
    const cohort = typeof req.query['cohort'] === 'string' ? req.query['cohort'] : undefined;
    if (cohort && !COHORTS.includes(cohort as (typeof COHORTS)[number])) {
      res.status(400).json({ error: 'Invalid cohort filter' });
      return;
    }
    const docs = getReferenceDocs(cohort);
    res.json({ docs });
  });

  router.post('/', (req: Request, res: Response): void => {
    const parsed = createRefSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', issues: parsed.error.issues });
      return;
    }
    const { title, content, cohort, type, license } = parsed.data;
    const doc = {
      id: randomUUID(),
      title,
      content,
      cohort,
      type,
      license,
      createdAt: new Date().toISOString(),
    };
    insertReferenceDoc(doc);
    logger.info({ cohort, license, ipHash: hashIp(req.ip) }, 'reference_doc_created');
    res.status(201).json({ id: doc.id });
  });

  router.delete('/:id', (req: Request, res: Response): void => {
    const id = typeof req.params['id'] === 'string' ? req.params['id'] : '';
    const deleted = deleteReferenceDoc(id);
    if (!deleted) {
      res.status(404).json({ error: 'Reference doc not found' });
      return;
    }
    logger.info({ ipHash: hashIp(req.ip) }, 'reference_doc_deleted');
    res.json({ ok: true });
  });

  return router;
}
