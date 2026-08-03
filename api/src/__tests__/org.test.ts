import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../app.js';
import { mintAuthCookie, authedSupertest, type TestAuth } from './authHelper.js';

describe('/api/org', () => {
  let app: ReturnType<typeof createApp>;
  let owner: TestAuth;

  beforeEach(() => {
    app = createApp({ rateLimitMax: 1000, uploadRateLimitMax: 1000 });
    owner = mintAuthCookie();
  });

  it('creates an organization and exposes a join code', async () => {
    const r = authedSupertest(app, owner);
    const res = await r.post('/api/org/create').send({ name: 'Acme Sleep Lab' });
    expect(res.status).toBe(200);
    expect(res.body.organization.name).toBe('Acme Sleep Lab');
    expect(res.body.organization.joinCode).toMatch(/^[A-Z2-9]{8}$/);
  });

  it('rejects creating a second org for the same user', async () => {
    const r = authedSupertest(app, owner);
    await r.post('/api/org/create').send({ name: 'First' });
    const res = await r.post('/api/org/create').send({ name: 'Second' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already belong/i);
  });

  it('lets a second user join via join code; both then see the org from /me', async () => {
    const r1 = authedSupertest(app, owner);
    const created = await r1.post('/api/org/create').send({ name: 'Acme Sleep Lab' });
    const joinCode = created.body.organization.joinCode as string;

    // owner needs a fresh cookie because organizationId changed after create
    const refreshedOwner: TestAuth = { ...owner, cookie: owner.cookie };
    const meOwner = await authedSupertest(app, refreshedOwner).get('/api/org/me');
    expect(meOwner.status).toBe(200);
    expect(meOwner.body.organization.name).toBe('Acme Sleep Lab');

    const member = mintAuthCookie();
    const r2 = authedSupertest(app, member);
    const join = await r2.post('/api/org/join').send({ joinCode });
    expect(join.status).toBe(200);
    expect(join.body.organization.id).toBe(created.body.organization.id);

    const meMember = await authedSupertest(app, { ...member, cookie: member.cookie }).get(
      '/api/org/me',
    );
    expect(meMember.status).toBe(200);
    expect(meMember.body.organization.id).toBe(created.body.organization.id);
    expect(meMember.body.members.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects an unknown join code', async () => {
    const r = authedSupertest(app, owner);
    const res = await r.post('/api/org/join').send({ joinCode: 'ZZZZZZZZ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid join code/i);
  });
});
