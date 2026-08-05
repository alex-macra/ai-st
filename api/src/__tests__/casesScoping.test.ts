// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../app.js';
import { insertCase, addUserToOrg, createOrg } from '../db.js';
import type { Case } from '../shared/types.js';
import { mintAuthCookie, authedSupertest, type TestAuth } from './authHelper.js';

function hex64(): string {
  return Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

function makeCase(createdBy: string, overrides: Partial<Case> = {}): Case {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    studyHash: hex64(),
    name: `scope-${randomUUID().slice(0, 8)}`,
    status: 'draft',
    cohort: 'adult',
    findings: [],
    createdBy,
    preprocessorVersion: '0.1.0',
    promptVersion: 'none',
    modelVersion: 'none',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('cases scoping', () => {
  let app: ReturnType<typeof createApp>;
  let alice: TestAuth;
  let bob: TestAuth;

  beforeEach(() => {
    app = createApp({ rateLimitMax: 1000, uploadRateLimitMax: 1000 });
    alice = mintAuthCookie();
    bob = mintAuthCookie();
  });

  it('GET /api/cases without auth returns 401', async () => {
    const r = authedSupertest(app, { ...alice, cookie: '' });
    const res = await r.get('/api/cases');
    expect(res.status).toBe(401);
  });

  it("user A cannot see user B's solo case via list or by id", async () => {
    insertCase(makeCase(alice.userId));
    const bobCase = makeCase(bob.userId);
    insertCase(bobCase);

    const aliceList = await authedSupertest(app, alice).get('/api/cases');
    expect(aliceList.status).toBe(200);
    const aliceIds = aliceList.body.cases.map((c: Case) => c.id);
    expect(aliceIds).not.toContain(bobCase.id);

    const directGet = await authedSupertest(app, alice).get(`/api/cases/${bobCase.id}`);
    expect(directGet.status).toBe(404);
  });

  it('users in the same organization see each others cases', async () => {
    const org = createOrg('Sleep Lab', alice.userId);
    addUserToOrg(alice.userId, org.id);
    addUserToOrg(bob.userId, org.id);

    // Re-mint cookies so JWT-resolved user objects reflect the org id at request time.
    // Since requireAuth re-reads the user row from db, the existing cookie is enough.
    insertCase(makeCase(alice.userId, { organizationId: org.id }));

    const bobList = await authedSupertest(app, bob).get('/api/cases');
    expect(bobList.status).toBe(200);
    expect(bobList.body.cases.length).toBe(1);
    expect(bobList.body.cases[0].createdBy).toBe(alice.userId);
  });

  it('a solo user cannot mutate another solo users case', async () => {
    const bobCase = makeCase(bob.userId);
    insertCase(bobCase);

    const patch = await authedSupertest(app, alice)
      .patch(`/api/cases/${bobCase.id}/status`)
      .send({ status: 'pending_review' });
    expect(patch.status).toBe(404);

    const del = await authedSupertest(app, alice).delete(`/api/cases/${bobCase.id}`);
    expect(del.status).toBe(404);
  });
});
