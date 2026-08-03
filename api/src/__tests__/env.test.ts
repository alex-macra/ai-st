import { describe, it, expect } from 'vitest';
import { jwtSecretError, parseTrustProxy } from '../env.js';

describe('jwtSecretError', () => {
  it('passes outside production regardless of secret', () => {
    expect(jwtSecretError({ NODE_ENV: 'development' })).toBeNull();
    expect(jwtSecretError({ NODE_ENV: 'test', JWT_SECRET: 'x' })).toBeNull();
  });

  it('flags a missing secret in production', () => {
    expect(jwtSecretError({ NODE_ENV: 'production' })).toMatch(/missing or shorter than 32 bytes/);
  });

  it('flags a secret shorter than 32 bytes in production', () => {
    expect(jwtSecretError({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(31) })).toMatch(
      /32 bytes/,
    );
  });

  it('passes a secret of 32+ bytes in production', () => {
    expect(jwtSecretError({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(32) })).toBeNull();
  });

  it('rejects the development OTP bypass in production', () => {
    expect(
      jwtSecretError({
        NODE_ENV: 'production',
        JWT_SECRET: 'x'.repeat(32),
        DEV_OTP_BYPASS: 'true',
      }),
    ).toMatch(/cannot be enabled/i);
  });

  it('measures bytes, not characters (16 two-byte chars = 32 bytes)', () => {
    expect(jwtSecretError({ NODE_ENV: 'production', JWT_SECRET: 'é'.repeat(16) })).toBeNull();
  });
});

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
