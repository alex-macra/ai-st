import { describe, it, expect, beforeEach } from 'vitest';
import {
  upsertReferenceDoc,
  getReferenceDocs,
  getReferenceDocsForCohortAndType,
  deleteReferenceDocsByPrefix,
} from '../db.js';
import type { ReferenceDoc } from '../shared/types.js';

function makeRefDoc(overrides: Partial<ReferenceDoc> = {}): ReferenceDoc {
  return {
    id: 'synthetic-source:example-definition',
    title: 'Synthetic source - example definition',
    content: JSON.stringify({ rule: 'Synthetic example rule', page: 'example-1', appliesTo: 'example claims' }),
    cohort: 'adult',
    type: 'hsat',
    license: 'institutional',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('reference rule storage', () => {
  beforeEach(() => {
    deleteReferenceDocsByPrefix('synthetic-source:');
    deleteReferenceDocsByPrefix('synthetic-restricted:');
  });

  it('upsertReferenceDoc inserts then updates the same id', () => {
    const doc = makeRefDoc();
    upsertReferenceDoc(doc);
    upsertReferenceDoc({ ...doc, title: 'updated title' });
    const all = getReferenceDocs('adult');
    const found = all.filter((d) => d.id === doc.id);
    expect(found).toHaveLength(1);
    expect(found[0]?.title).toBe('updated title');
  });

  it('deleteReferenceDocsByPrefix removes only matching ids', () => {
    upsertReferenceDoc(makeRefDoc({ id: 'synthetic-source:rule-a' }));
    upsertReferenceDoc(makeRefDoc({ id: 'synthetic-source:rule-b' }));
    upsertReferenceDoc(makeRefDoc({ id: 'other-source:rule-x' }));
    const removed = deleteReferenceDocsByPrefix('synthetic-source:');
    expect(removed).toBe(2);
    const remaining = getReferenceDocs().map((d) => d.id);
    expect(remaining).toContain('other-source:rule-x');
    expect(remaining).not.toContain('synthetic-source:rule-a');
    deleteReferenceDocsByPrefix('other-source:');
  });

  it('getReferenceDocsForCohortAndType matches cohort + type and includes generic', () => {
    upsertReferenceDoc(makeRefDoc({ id: 'synthetic-source:adult-hsat', cohort: 'adult', type: 'hsat' }));
    upsertReferenceDoc(makeRefDoc({ id: 'synthetic-source:peds-hsat', cohort: 'pediatric', type: 'hsat' }));
    upsertReferenceDoc(makeRefDoc({ id: 'synthetic-source:generic-generic', cohort: 'generic', type: 'generic' }));
    upsertReferenceDoc(makeRefDoc({ id: 'synthetic-source:adult-psg', cohort: 'adult', type: 'psg' }));

    const ids = getReferenceDocsForCohortAndType('adult', 'hsat').map((d) => d.id);
    expect(ids).toContain('synthetic-source:adult-hsat');
    expect(ids).toContain('synthetic-source:generic-generic');
    expect(ids).not.toContain('synthetic-source:peds-hsat');
    expect(ids).not.toContain('synthetic-source:adult-psg');
  });

  it('never returns restricted docs even when explicitly the only match', () => {
    upsertReferenceDoc(makeRefDoc({
      id: 'synthetic-restricted:excluded-rule',
      cohort: 'adult',
      type: 'hsat',
      license: 'restricted',
    }));
    const ids = getReferenceDocsForCohortAndType('adult', 'hsat').map((d) => d.id);
    expect(ids).not.toContain('synthetic-restricted:excluded-rule');
  });

  it('pediatric rules are absent from adult cohort queries', () => {
    deleteReferenceDocsByPrefix('synthetic-pediatric:');
    upsertReferenceDoc(makeRefDoc({
      id: 'synthetic-pediatric:rule-one',
      cohort: 'pediatric',
      type: 'hsat',
    }));
    upsertReferenceDoc(makeRefDoc({
      id: 'synthetic-pediatric:rule-two',
      cohort: 'pediatric',
      type: 'hsat',
    }));

    const adultIds = getReferenceDocsForCohortAndType('adult', 'hsat').map((d) => d.id);
    expect(adultIds).not.toContain('synthetic-pediatric:rule-one');
    expect(adultIds).not.toContain('synthetic-pediatric:rule-two');

    const pedsIds = getReferenceDocsForCohortAndType('pediatric', 'hsat').map((d) => d.id);
    expect(pedsIds).toContain('synthetic-pediatric:rule-one');
    expect(pedsIds).toContain('synthetic-pediatric:rule-two');

    deleteReferenceDocsByPrefix('synthetic-pediatric:');
  });
});
