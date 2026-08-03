import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import supertest from 'supertest';
import { isReferenceRuleActive, seedReferenceDocs } from '../refs/seedReferenceDocs.js';
import {
  deleteReferenceDocsByPrefix,
  getReferenceDocsForCohortAndType,
  insertReferenceDoc,
  setUserAdmin,
} from '../db.js';
import { createApp } from '../app.js';
import { authedSupertest, mintAuthCookie } from './authHelper.js';

const ADULT_MD = `---
ref_id: synthetic-adult-hsat
source: Synthetic Adult Example
cohort: adult
type: hsat
license: open
---

- **id**: \`rule-a\`
  **rule**: Synthetic adult rule A.
  **page**: example-1
  **applies_to**: synthetic adult claims.

- **id**: \`rule-b\`
  **rule**: Synthetic adult rule B.
  **page**: example-2
  **applies_to**: synthetic adult claims.
`;

const PEDS_MD = `---
ref_id: synthetic-pediatric-hsat
source: Synthetic Pediatric Example
cohort: pediatric
type: hsat
license: open
---

- **id**: \`rule-p\`
  **rule**: Synthetic pediatric rule P.
  **page**: example-10
  **applies_to**: synthetic pediatric claims.
`;

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'somnoscribe-refs-test-'));
  writeFileSync(join(dir, 'adult.md'), ADULT_MD);
  writeFileSync(join(dir, 'pediatric.md'), PEDS_MD);
  return dir;
}

describe('reference pack loading', () => {
  let tmpDir: string | undefined;
  const manualIds: string[] = [];

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
    seedReferenceDocs('');
    deleteReferenceDocsByPrefix('synthetic-adult-hsat:');
    deleteReferenceDocsByPrefix('synthetic-pediatric-hsat:');
    for (const id of manualIds.splice(0)) deleteReferenceDocsByPrefix(id);
  });

  it('validates and loads a direct synthetic Markdown pack', () => {
    tmpDir = makeTmpDir();
    const status = seedReferenceDocs(tmpDir);

    expect(status).toEqual({ enabled: true, filesLoaded: 2, rulesLoaded: 3 });
    const adultRules = getReferenceDocsForCohortAndType('adult', 'hsat');
    expect(adultRules.map((rule) => rule.id)).toEqual(
      expect.arrayContaining(['synthetic-adult-hsat:rule-a', 'synthetic-adult-hsat:rule-b']),
    );
  });

  it('is idempotent', () => {
    tmpDir = makeTmpDir();
    seedReferenceDocs(tmpDir);
    seedReferenceDocs(tmpDir);

    const docs = getReferenceDocsForCohortAndType('adult', 'hsat').filter((doc) =>
      doc.id.startsWith('synthetic-adult-hsat:'),
    );
    expect(docs).toHaveLength(2);
  });

  it('disables the pack explicitly when REFERENCE_DIR is absent', () => {
    tmpDir = makeTmpDir();
    seedReferenceDocs(tmpDir);
    expect(isReferenceRuleActive('synthetic-adult-hsat:rule-a')).toBe(true);

    expect(seedReferenceDocs('')).toEqual({ enabled: false, filesLoaded: 0, rulesLoaded: 0 });
    expect(isReferenceRuleActive('synthetic-adult-hsat:rule-a')).toBe(false);
    expect(
      getReferenceDocsForCohortAndType('adult', 'hsat').some(
        (doc) => doc.id === 'synthetic-adult-hsat:rule-a',
      ),
    ).toBe(false);
  });

  it('removes stale pack rules while preserving administrator-created references', () => {
    const manualId = randomUUID();
    manualIds.push(manualId);
    insertReferenceDoc({
      id: manualId,
      title: 'Synthetic manual reference',
      content: '{"rule":"Synthetic"}',
      cohort: 'adult',
      type: 'hsat',
      license: 'open',
      createdAt: new Date().toISOString(),
    });
    tmpDir = makeTmpDir();
    seedReferenceDocs(tmpDir);

    seedReferenceDocs('');

    const docs = getReferenceDocsForCohortAndType('adult', 'hsat');
    expect(docs.some((doc) => doc.id === manualId)).toBe(true);
    expect(docs.some((doc) => doc.id.startsWith('synthetic-adult-hsat:'))).toBe(false);
  });

  it('rejects an unsupported license value', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'somnoscribe-refs-test-'));
    writeFileSync(
      join(tmpDir, 'invalid.md'),
      ADULT_MD.replace('license: open', 'license: unknown'),
    );
    expect(() => seedReferenceDocs(tmpDir)).toThrow(/invalid reference metadata/i);
  });

  it('rejects duplicate rule IDs before loading', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'somnoscribe-refs-test-'));
    const duplicate = ADULT_MD.replace('`rule-b`', '`rule-a`');
    writeFileSync(join(tmpDir, 'duplicate.md'), duplicate);
    expect(() => seedReferenceDocs(tmpDir)).toThrow(/duplicate rule id/i);
  });

  it('rejects symlinked Markdown files', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'somnoscribe-refs-test-'));
    const target = join(tmpDir, 'target.txt');
    writeFileSync(target, ADULT_MD);
    symlinkSync(target, join(tmpDir, 'linked.md'));
    expect(() => seedReferenceDocs(tmpDir)).toThrow(/regular files/i);
  });
});

describe('reference API authorization', () => {
  it('requires authentication for status and reads', async () => {
    const app = createApp({ rateLimitMax: 1000, uploadRateLimitMax: 1000 });
    expect((await supertest(app).get('/api/references/status')).status).toBe(401);
    expect((await supertest(app).get('/api/references')).status).toBe(401);
  });

  it('allows authenticated status reads and restricts mutations to admins', async () => {
    const app = createApp({ rateLimitMax: 1000, uploadRateLimitMax: 1000 });
    const user = mintAuthCookie();
    const admin = mintAuthCookie();
    setUserAdmin(admin.userId, true);

    const status = await authedSupertest(app, user).get('/api/references/status');
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ enabled: false, filesLoaded: 0, rulesLoaded: 0 });

    const payload = {
      title: 'Synthetic rule',
      content: '{"rule":"Synthetic"}',
      cohort: 'generic',
      type: 'generic',
      license: 'open',
    };
    expect((await authedSupertest(app, user).post('/api/references').send(payload)).status).toBe(
      403,
    );
    expect((await authedSupertest(app, admin).post('/api/references').send(payload)).status).toBe(
      201,
    );
  });
});
