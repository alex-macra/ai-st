import { describe, it, expect } from 'vitest';
import { buildPdfFilename, stripInlineCitations } from '../utils';

describe('buildPdfFilename', () => {
  it('prefixes a non-timestamped slug with the createdAt date and time', () => {
    const fn = buildPdfFilename({ name: 'Patient Demo', createdAt: '2026-05-03T17:36:04Z' });
    expect(fn).toBe('2026-05-03-173604-Patient-Demo');
  });

  it('does not double-prepend when the slug already starts with a timestamp', () => {
    const fn = buildPdfFilename({
      name: '2026-05-03-173604-SyntheticStudy-07',
      createdAt: '2026-05-03T17:36:04Z',
    });
    expect(fn).toBe('2026-05-03-173604-SyntheticStudy-07');
  });

  it('strips file extensions from the slug', () => {
    const fn = buildPdfFilename({ name: 'study.edf', createdAt: '2026-01-02T03:04:05Z' });
    expect(fn).toBe('2026-01-02-030405-study');
  });
});

describe('stripInlineCitations', () => {
  it('removes parenthetical finding-id citations', () => {
    const out = stripInlineCitations(
      'The provisional REI is moderate (F-2b2b1d2f-3d2a-4f7d-8db8-3a8d4d84eb1d).'
    );
    expect(out).toBe('The provisional REI is moderate.');
  });
});
