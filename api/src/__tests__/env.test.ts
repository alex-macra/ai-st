// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest';
import { parseTrustProxy } from '../env.js';

describe('parseTrustProxy', () => {
  it('defaults to no trusted proxy', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
  });

  it('accepts loopback and positive hop counts', () => {
    expect(parseTrustProxy('loopback')).toBe('loopback');
    expect(parseTrustProxy('2')).toBe(2);
  });

  it('rejects ambiguous or unsafe values', () => {
    for (const value of ['true', '0', '-1', 'all', '1.5']) {
      expect(() => parseTrustProxy(value)).toThrow(/TRUST_PROXY/);
    }
  });
});
