// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
export type TrustProxySetting = false | 'loopback' | number;

export function parseTrustProxy(value: string | undefined): TrustProxySetting {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === 'false') return false;
  if (normalized === 'loopback') return 'loopback';
  if (/^[1-9]\d*$/.test(normalized)) return Number(normalized);
  throw new Error('TRUST_PROXY must be false, loopback, or a positive hop count');
}
