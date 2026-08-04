// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { createRequire } from 'node:module';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  createOrg,
  getOrgById,
  getOrgByJoinCode,
  addUserToOrg,
  getOrgMembers,
  getUserById,
} from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../logger.js';

const require = createRequire(import.meta.url);
const express = require('express') as typeof import('express');

const createSchema = z.object({
  name: z.string().min(1).max(120).trim(),
});

const joinSchema = z.object({
  joinCode: z.string().min(4).max(32).toUpperCase().trim(),
});

export function createOrgRouter() {
  const router = express.Router();

  router.post('/create', requireAuth, (req: Request, res: Response): void => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', issues: parsed.error.issues });
      return;
    }

    const userId = req.user!.id;
    const current = getUserById(userId);
    if (current?.organizationId) {
      res.status(400).json({ error: 'You already belong to an organization.' });
      return;
    }

    const org = createOrg(parsed.data.name, userId);
    addUserToOrg(userId, org.id);

    logger.info({ userId, orgId: org.id }, 'org_created');
    res.json({ organization: org });
  });

  router.post('/join', requireAuth, (req: Request, res: Response): void => {
    const parsed = joinSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', issues: parsed.error.issues });
      return;
    }

    const userId = req.user!.id;
    const current = getUserById(userId);
    if (current?.organizationId) {
      res.status(400).json({ error: 'You already belong to an organization.' });
      return;
    }

    const org = getOrgByJoinCode(parsed.data.joinCode);
    if (!org) {
      res.status(400).json({ error: 'Invalid join code.' });
      return;
    }

    addUserToOrg(userId, org.id);

    logger.info({ userId, orgId: org.id }, 'org_joined');
    res.json({ organization: org });
  });

  router.get('/me', requireAuth, (req: Request, res: Response): void => {
    const orgId = req.user!.organizationId;
    if (!orgId) {
      res.json({ organization: null, members: [] });
      return;
    }

    const org = getOrgById(orgId);
    if (!org) {
      res.json({ organization: null, members: [] });
      return;
    }

    const members = getOrgMembers(orgId);
    res.json({ organization: org, members });
  });

  return router;
}
