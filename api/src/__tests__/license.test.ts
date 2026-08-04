// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { openDb } from '../db/connection.js';
import { createLicenseTable, getLicense, mintLicenseKeys } from '../license.js';

describe('local invitations', () => {
  it('generates unique cryptographically random invitation-shaped values', () => {
    const db = openDb(':memory:');
    createLicenseTable(db, { trackUsedBy: true });

    const keys = mintLicenseKeys(db, 64, 'starter');

    expect(new Set(keys).size).toBe(64);
    for (const key of keys) {
      expect(key).toMatch(/^AIST-(?:[A-F0-9]{4}-){4}[A-F0-9]{4}$/);
      expect(getLicense(db, key)).toMatchObject({ key, used: 0, tier: 'starter' });
    }
    db.close();
  });

  it('rejects invalid generation counts', () => {
    const db = openDb(':memory:');
    createLicenseTable(db);
    for (const count of [0, -1, 1.5, 1001]) {
      expect(() => mintLicenseKeys(db, count)).toThrow(/between 1 and 1000/);
    }
    db.close();
  });
});
