// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { randomInt } from 'node:crypto';
import { createRequire } from 'node:module';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { zEmail, zLicenseKey } from '../validation.js';
import { getLicense, burnLicense } from '../license.js';
import {
  getDb,
  createUser,
  getUserByEmail,
  upsertOtp,
  verifyAndConsumeOtp,
  touchLastSeen,
  getUserHierarchicalUsage,
  updateUserName,
} from '../db.js';
import { sendOtp } from '../email.js';
import { signJwt, setAuthCookie, clearAuthCookie, requireAuth } from '../middleware/auth.js';
import { logger } from '../logger.js';
import type { User } from '../shared/types.js';

const require = createRequire(import.meta.url);
const express = require('express') as typeof import('express');

const activateSchema = z.object({
  email: zEmail,
  licenseKey: zLicenseKey,
});

const loginSchema = z.object({
  email: zEmail,
});

const verifySchema = z.object({
  email: zEmail,
  code: z
    .string()
    .length(6)
    .regex(/^\d{6}$/),
});

type ActivationResult =
  { ok: true; user: User } | { ok: false; reason: 'invalid' | 'used' | 'existing' };

function activateInvitation(email: string, licenseKey: string): ActivationResult {
  const db = getDb();
  return db.transaction((): ActivationResult => {
    const license = getLicense(db, licenseKey);
    if (!license) return { ok: false, reason: 'invalid' };
    if (license.used) return { ok: false, reason: 'used' };
    if (getUserByEmail(email)) return { ok: false, reason: 'existing' };
    if (!burnLicense(db, licenseKey, email)) return { ok: false, reason: 'used' };
    return { ok: true, user: createUser(email) };
  })();
}

function generateOtp(): string {
  const n = randomInt(0, 1_000_000);
  return n.toString().padStart(6, '0');
}

export function createAuthRouter() {
  const router = express.Router();

  router.post('/activate', async (req: Request, res: Response): Promise<void> => {
    const parsed = activateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'A valid email address and license key are required.' });
      return;
    }

    const { email, licenseKey } = parsed.data;

    const activation = activateInvitation(email, licenseKey);
    if (!activation.ok && activation.reason === 'invalid') {
      res.status(400).json({ error: 'Invalid license key.' });
      return;
    }
    if (!activation.ok && activation.reason === 'used') {
      res.status(400).json({ error: 'License key has already been used.' });
      return;
    }
    if (!activation.ok) {
      res
        .status(400)
        .json({ error: 'An account with this email already exists. Please sign in instead.' });
      return;
    }
    const { user } = activation;

    const token = signJwt(user.id);
    setAuthCookie(res, token);

    logger.info({ userId: user.id }, 'account_activated');
    res.json({
      user: {
        id: user.id,
        email: user.email,
        organizationId: user.organizationId,
        tier: user.tier,
        isAdmin: user.isAdmin,
        tokenBudget: user.tokenBudget,
      },
    });
  });

  router.post('/login', async (req: Request, res: Response): Promise<void> => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'A valid email address is required.' });
      return;
    }

    const { email } = parsed.data;

    const user = getUserByEmail(email);
    if (!user) {
      res.json({ ok: true });
      return;
    }

    const code = generateOtp();
    upsertOtp(email, code);

    try {
      await sendOtp(email, code);
    } catch {
      logger.error('otp_send_failed');
      res.status(500).json({ error: 'Failed to send sign-in code. Please try again.' });
      return;
    }

    logger.info('otp_sent');
    res.json({ ok: true });
  });

  router.post('/verify', async (req: Request, res: Response): Promise<void> => {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'A valid email address and 6-digit code are required.' });
      return;
    }

    const { email, code } = parsed.data;

    const devBypass =
      process.env['NODE_ENV'] !== 'production' &&
      process.env['DEV_OTP_BYPASS'] === 'true' &&
      code === '000000';
    const valid = devBypass || verifyAndConsumeOtp(email, code);
    if (!valid) {
      res.status(400).json({ error: 'Invalid or expired code. Please request a new one.' });
      return;
    }

    const user = getUserByEmail(email);
    if (!user) {
      res.status(400).json({ error: 'Account not found.' });
      return;
    }

    touchLastSeen(user.id);
    const token = signJwt(user.id);
    setAuthCookie(res, token);

    logger.info({ userId: user.id }, 'user_logged_in');
    res.json({
      user: {
        id: user.id,
        email: user.email,
        organizationId: user.organizationId,
        tier: user.tier,
        isAdmin: user.isAdmin,
        tokenBudget: user.tokenBudget,
      },
    });
  });

  router.get('/me', requireAuth, (req: Request, res: Response): void => {
    const u = req.user!;
    const usage = getUserHierarchicalUsage(u.id, u.tokenBudget);
    res.json({
      user: {
        id: u.id,
        email: u.email,
        name: u.name ?? null,
        organizationId: u.organizationId,
        tier: u.tier,
        isAdmin: u.isAdmin,
        tokenBudget: u.tokenBudget,
        tokens4h: usage.tokens4h,
        tokensWeek: usage.tokensWeek,
        budget4h: usage.budget4h,
        budgetWeek: usage.budgetWeek,
        window4hEndsAt: usage.window4hEndsAt,
        weekEndsAt: usage.weekEndsAt,
      },
    });
  });

  router.patch('/me/name', requireAuth, (req: Request, res: Response): void => {
    const parsed = z.object({ name: z.string().trim().min(1).max(100) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'name must be 1–100 characters' });
      return;
    }
    updateUserName(req.user!.id, parsed.data.name);
    res.json({ ok: true, name: parsed.data.name });
  });

  router.post('/logout', (_req: Request, res: Response): void => {
    clearAuthCookie(res);
    res.json({ ok: true });
  });

  return router;
}
