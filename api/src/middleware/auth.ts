// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import jwt from 'jsonwebtoken';
import type { CookieOptions, NextFunction, Request, Response } from 'express';
import { getUserById } from '../db.js';
import { isDemoSessionExpired, isReservedDemoEmail } from '../demo.js';
import { publicDemoModeEnabled } from '../llm.js';

type SessionUser = {
  id: string;
  email: string;
  name?: string;
  organizationId: string | null;
  tier: string;
  isAdmin: boolean;
  isDemo: boolean;
  demoExpiresAt: string | null;
  tokenBudget: number;
};

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

const COOKIE_NAME = 'somno_session';
const JWT_SECRET = process.env['JWT_SECRET'] ?? 'dev-secret-change-in-production';
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const JWT_ISSUER = 'somnoscribe';
const JWT_AUDIENCE = 'somnoscribe-web';

export function signJwt(userId: string, expiresIn: '30d' | '4h' = '30d'): string {
  return jwt.sign({}, JWT_SECRET, {
    subject: userId,
    algorithm: 'HS256',
    expiresIn,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

export function verifyJwt(token: string): { userId: string } | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    if (typeof payload === 'string' || typeof payload.sub !== 'string') return null;
    return { userId: payload.sub };
  } catch {
    return null;
  }
}

export function authCookieOptions(
  environment: NodeJS.ProcessEnv = process.env,
  maxAge = COOKIE_MAX_AGE_MS,
): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: environment['NODE_ENV'] === 'production',
    maxAge,
    path: '/',
  };
}

export function setAuthCookie(res: Response, token: string, maxAge = COOKIE_MAX_AGE_MS): void {
  res.cookie(COOKIE_NAME, token, authCookieOptions(process.env, maxAge));
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, authCookieOptions());
}

function loadSessionUser(subject: string): SessionUser | null {
  const user = getUserById(subject);
  if (!user) return null;
  // Pre-isolation deployments used this literal shared row without an
  // `is_demo` marker. Treat it as a demo principal now so any old cookie fails
  // closed instead of gaining the new normal-user permissions.
  const isDemo = user.isDemo || isReservedDemoEmail(user.email);
  return {
    id: user.id,
    email: user.email,
    ...(user.name ? { name: user.name } : {}),
    organizationId: user.organizationId,
    tier: user.tier,
    isAdmin: user.isAdmin,
    isDemo,
    demoExpiresAt: user.demoExpiresAt,
    tokenBudget: user.tokenBudget,
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = (req.cookies as Record<string, unknown> | undefined)?.[COOKIE_NAME];
  if (typeof token !== 'string') {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const payload = verifyJwt(token);
  const user = payload ? loadSessionUser(payload.userId) : null;
  if (
    !user ||
    (user.isDemo && (!publicDemoModeEnabled() || isDemoSessionExpired(user.demoExpiresAt)))
  ) {
    clearAuthCookie(res);
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  req.user = user;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (!req.user?.isAdmin || req.user.isDemo) {
      res.status(403).json({ error: 'Administrator access required.' });
      return;
    }
    next();
  });
}

export function requireNonDemoUser(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (req.user?.isDemo) {
      res.status(403).json({ error: 'This action is not available in the demo session.' });
      return;
    }
    next();
  });
}

export function requireDemoUser(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (!req.user?.isDemo) {
      res.status(403).json({ error: 'This resource is available only in the demo session.' });
      return;
    }
    next();
  });
}

export function requirePublicDemoMode(_req: Request, res: Response, next: NextFunction): void {
  if (!publicDemoModeEnabled()) {
    res.status(404).json({ error: 'Demo mode is not enabled on this deployment.' });
    return;
  }
  next();
}
