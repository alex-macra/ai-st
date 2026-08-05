// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';

export const DEMO_USER_EMAIL = 'demo@example.test';
export const DEMO_SESSION_TTL_MS = 4 * 60 * 60 * 1_000;
export const DEMO_SESSION_JWT_TTL = '4h';
export const DEMO_LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1_000;
export const DEMO_LOGIN_RATE_LIMIT_MAX = 3;
export const DEFAULT_DEMO_MAX_ACTIVE_PRINCIPALS = 24;
// A fresh keyless principal is created per sign-in, so per-user locking alone
// would not bound simultaneous offline work across those principals.
export const DEMO_MAX_CONCURRENT_ANALYSES = 2;

/**
 * Bound active anonymous rows even when callers rotate source IPs. Invalid
 * values fall back to the deliberately small default rather than disabling
 * the guard.
 */
export function demoMaxActivePrincipals(environment: Environment = process.env): number {
  const raw = environment['SOMNOSCRIBE_DEMO_MAX_ACTIVE_PRINCIPALS'];
  if (raw === undefined || raw.trim() === '') return DEFAULT_DEMO_MAX_ACTIVE_PRINCIPALS;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 1000
    ? parsed
    : DEFAULT_DEMO_MAX_ACTIVE_PRINCIPALS;
}

export function newDemoUserEmail(): string {
  return `demo-${randomUUID()}@example.test`;
}

export function demoExpiresAt(nowMs = Date.now()): string {
  return new Date(nowMs + DEMO_SESSION_TTL_MS).toISOString();
}

export function isReservedDemoEmail(email: string): boolean {
  return email.toLowerCase() === DEMO_USER_EMAIL;
}

export function isDemoSessionExpired(expiresAt: string | null, nowMs = Date.now()): boolean {
  if (expiresAt === null) return true;
  const expiresAtMs = Date.parse(expiresAt);
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs;
}

type Environment = Record<string, string | undefined>;
