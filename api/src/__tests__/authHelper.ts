import supertest from 'supertest';
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { createUser, addUserToOrg, createOrg } from '../db.js';
import { signJwt } from '../middleware/auth.js';

export interface TestAuth {
  userId: string;
  email: string;
  organizationId: string | null;
  cookie: string;
}

export function mintAuthCookie(opts: { email?: string; orgName?: string } = {}): TestAuth {
  const email = opts.email ?? `u-${randomUUID().slice(0, 8)}@test.local`;
  const user = createUser(email);
  let organizationId: string | null = null;
  if (opts.orgName) {
    const org = createOrg(opts.orgName, user.id);
    addUserToOrg(user.id, org.id);
    organizationId = org.id;
  }
  const token = signJwt(user.id);
  return {
    userId: user.id,
    email: user.email,
    organizationId,
    cookie: `somno_session=${token}`,
  };
}

const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head']);

// Wraps supertest so every request method (get/post/...) auto-sets the
// somno_session cookie. Lets test files replace `supertest(app)` with
// `authedSupertest(app, auth)` and leave the call sites untouched.
export function authedSupertest(app: Express, auth: TestAuth): ReturnType<typeof supertest> {
  const real = supertest(app);
  return new Proxy(real as object, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function' && typeof prop === 'string' && VERBS.has(prop)) {
        return (...args: unknown[]) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (value as any).apply(target, args).set('Cookie', auth.cookie);
      }
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
    },
  }) as ReturnType<typeof supertest>;
}
