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
  createDemoUser,
  DemoPrincipalCapacityError,
  getUserByEmail,
  upsertOtp,
  verifyAndConsumeOtp,
  touchLastSeen,
  getUserHierarchicalUsage,
  updateUserName,
} from '../db.js';
import { sendOtp } from '../email.js';
import {
  signJwt,
  setAuthCookie,
  clearAuthCookie,
  requireAuth,
  requireNonDemoUser,
  requirePublicDemoMode,
} from '../middleware/auth.js';
import { logger } from '../logger.js';
import type { User } from '../shared/types.js';
import {
  DEMO_SESSION_JWT_TTL,
  DEMO_SESSION_TTL_MS,
  DEMO_USER_EMAIL,
  demoMaxActivePrincipals,
  demoExpiresAt,
  isReservedDemoEmail,
} from '../demo.js';
import { purgeExpiredDemoData } from '../demoData.js';

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

export { DEMO_USER_EMAIL } from '../demo.js';

function authenticatedUserPayload(user: User) {
  return {
    id: user.id,
    email: user.isDemo ? DEMO_USER_EMAIL : user.email,
    organizationId: user.organizationId,
    tier: user.tier,
    isAdmin: user.isAdmin,
    isDemo: user.isDemo,
    tokenBudget: user.tokenBudget,
  };
}

function rejectReservedDemoEmail(res: Response, email: string): boolean {
  if (!isReservedDemoEmail(email)) return false;
  res.status(400).json({ error: 'This email address is reserved for the temporary demo session.' });
  return true;
}

export function createDemoAuthRouter() {
  const router = express.Router();

  router.use(requirePublicDemoMode);

  router.post('/', async (_req: Request, res: Response): Promise<void> => {
    try {
      await purgeExpiredDemoData();
    } catch (err) {
      logger.warn(
        { errorType: err instanceof Error ? err.name : 'UnknownError' },
        'demo_purge_failed',
      );
    }

    let user: User;
    try {
      user = createDemoUser(demoExpiresAt(), demoMaxActivePrincipals());
    } catch (err) {
      if (err instanceof DemoPrincipalCapacityError) {
        res.setHeader('Retry-After', '60');
        res.status(429).json({
          code: 'demo_session_capacity',
          error: 'The demo is at temporary session capacity. Please try again shortly.',
          retryAfterSeconds: 60,
        });
        return;
      }
      throw err;
    }
    setAuthCookie(res, signJwt(user.id, DEMO_SESSION_JWT_TTL), DEMO_SESSION_TTL_MS);

    logger.info({ userId: user.id }, 'demo_user_signed_in');
    res.json({ user: authenticatedUserPayload(user) });
  });

  return router;
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
    if (rejectReservedDemoEmail(res, email)) return;

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
    res.json({ user: authenticatedUserPayload(user) });
  });

  router.post('/login', async (req: Request, res: Response): Promise<void> => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'A valid email address is required.' });
      return;
    }

    const { email } = parsed.data;
    if (rejectReservedDemoEmail(res, email)) return;

    const user = getUserByEmail(email);
    if (!user || user.isDemo) {
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
    if (rejectReservedDemoEmail(res, email)) return;

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
    if (!user || user.isDemo) {
      res.status(400).json({ error: 'Account not found.' });
      return;
    }

    touchLastSeen(user.id);
    const token = signJwt(user.id);
    setAuthCookie(res, token);

    logger.info({ userId: user.id }, 'user_logged_in');
    res.json({ user: authenticatedUserPayload(user) });
  });

  router.get('/me', requireAuth, (req: Request, res: Response): void => {
    const u = req.user!;
    const usage = getUserHierarchicalUsage(u.id, u.tokenBudget);
    res.json({
      user: {
        id: u.id,
        email: u.isDemo ? DEMO_USER_EMAIL : u.email,
        name: u.name ?? null,
        organizationId: u.organizationId,
        tier: u.tier,
        isAdmin: u.isAdmin,
        isDemo: u.isDemo,
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

  router.patch('/me/name', requireNonDemoUser, (req: Request, res: Response): void => {
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
