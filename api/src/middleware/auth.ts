// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import jwt from 'jsonwebtoken';
import type { CookieOptions, NextFunction, Request, Response } from 'express';
import { getUserById } from '../db.js';

type SessionUser = {
  id: string;
  email: string;
  name?: string;
  organizationId: string | null;
  tier: string;
  isAdmin: boolean;
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

export function signJwt(userId: string): string {
  return jwt.sign({}, JWT_SECRET, {
    subject: userId,
    algorithm: 'HS256',
    expiresIn: '30d',
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

export function authCookieOptions(environment: NodeJS.ProcessEnv = process.env): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: environment['NODE_ENV'] === 'production',
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/',
  };
}

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, authCookieOptions());
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, authCookieOptions());
}

function loadSessionUser(subject: string): SessionUser | null {
  const user = getUserById(subject);
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    ...(user.name ? { name: user.name } : {}),
    organizationId: user.organizationId,
    tier: user.tier,
    isAdmin: user.isAdmin,
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
  if (!user) {
    clearAuthCookie(res);
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  req.user = user;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (!req.user?.isAdmin) {
      res.status(403).json({ error: 'Administrator access required.' });
      return;
    }
    next();
  });
}
