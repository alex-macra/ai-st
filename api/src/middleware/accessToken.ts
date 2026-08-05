// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { sendError } from '../errors.js';

type Environment = Record<string, string | undefined>;

/**
 * Somnoscribe has no accounts. It is a single-operator workspace that binds the
 * loopback interface, and by default every request is served.
 *
 * `SOMNOSCRIBE_ACCESS_TOKEN` is the one guard for an operator who chooses to
 * expose it anyway: set it, and every `/api` request must present the same value
 * as a bearer token. It is a shared secret, not an identity — it says nothing
 * about who is reviewing, which is why sign-off records a reviewer name
 * separately.
 */
export function configuredAccessToken(environment: Environment = process.env): string | undefined {
  const token = environment['SOMNOSCRIBE_ACCESS_TOKEN']?.trim();
  return token === undefined || token === '' ? undefined : token;
}

function presentedToken(req: Request): string | undefined {
  const header = req.get('authorization');
  if (header === undefined) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}

/** Constant-time so a wrong token cannot be recovered a character at a time. */
function tokenMatches(expected: string, presented: string | undefined): boolean {
  if (presented === undefined) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function requireAccessToken(req: Request, res: Response, next: NextFunction): void {
  const expected = configuredAccessToken();
  if (expected === undefined) {
    next();
    return;
  }
  if (!tokenMatches(expected, presentedToken(req))) {
    sendError(res, 401, 'ACCESS_TOKEN_REQUIRED', 'A valid access token is required.');
    return;
  }
  next();
}
