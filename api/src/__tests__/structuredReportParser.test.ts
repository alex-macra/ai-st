import { describe, it, expect } from 'vitest';
import { parsePass2Output } from '../structuredReportParser.js';

const HAPPY_PATH = JSON.stringify({
  summary: 'Provisional pAHI 15.3/h, in the pediatric severe range.',
  studyQuality: { totalRecordingTime: '07:59', channelIssues: ['flow channel artifact'] },
  respiratoryIndices: { ahi: 15.3, odi3: 23.5 },
  oxygenation: { meanSpO2: 97.8, baselineSpO2: 99, nadirSpO2: 88, t90Pct: 0.15 },
  positional: { supineAhi: 7.96, nonSupineAhi: 36.71, supineTimePct: 6.3 },
  impression: 'Pediatric severe range obstructive SDB by pAHI; HSAT cannot rule out OSA.',
  citations: { summary: ['F-001'], impression: ['F-001', 'F-008'] }
});

describe('parsePass2Output', () => {
  it('parses a clean structured report', () => {
    const r = parsePass2Output(HAPPY_PATH);
    if (!r.ok) throw new Error(r.error);
    expect(r.report.summary).toMatch(/severe/);
    expect(r.report.respiratoryIndices.ahi).toBe(15.3);
    expect(r.coerced).toBe(false);
  });

  it('strips ```json fences', () => {
    const r = parsePass2Output('```json\n' + HAPPY_PATH + '\n```');
    expect(r.ok).toBe(true);
  });

  it('coerces null summary into empty string and flags it', () => {
    const r = parsePass2Output(JSON.stringify({
      summary: null,
      impression: 'foo',
      respiratoryIndices: {},
      oxygenation: {},
      positional: {},
      studyQuality: {},
    }));
    if (!r.ok) throw new Error(r.error);
    expect(r.report.summary).toBe('');
    expect(r.coerced).toBe(true);
    expect(r.warnings.some((w) => w.includes('summary'))).toBe(true);
  });

  it('coerces missing impression into empty string', () => {
    const r = parsePass2Output(JSON.stringify({
      summary: 'foo',
      respiratoryIndices: {},
      oxygenation: {},
      positional: {},
      studyQuality: {},
    }));
    if (!r.ok) throw new Error(r.error);
    expect(r.report.impression).toBe('');
    expect(r.coerced).toBe(true);
  });

  it('coerces stringified numerics back to numbers', () => {
    const r = parsePass2Output(JSON.stringify({
      summary: 'x',
      impression: 'y',
      respiratoryIndices: { ahi: '15.3', odi3: '23.5' },
      oxygenation: { meanSpO2: '97.8' },
      positional: {},
      studyQuality: {},
    }));
    if (!r.ok) throw new Error(r.error);
    expect(r.report.respiratoryIndices.ahi).toBe(15.3);
    expect(r.report.oxygenation.meanSpO2).toBe(97.8);
  });

  it('drops null-valued numerics rather than choking', () => {
    const r = parsePass2Output(JSON.stringify({
      summary: 'x',
      impression: 'y',
      respiratoryIndices: { ahi: 15.3, odi3: null, hypopneaCount: '' },
      oxygenation: {},
      positional: {},
      studyQuality: {},
    }));
    if (!r.ok) throw new Error(r.error);
    expect(r.report.respiratoryIndices.ahi).toBe(15.3);
    expect(r.report.respiratoryIndices.odi3).toBeUndefined();
    expect(r.report.respiratoryIndices.hypopneaCount).toBeUndefined();
  });

  it('coerces channelIssues that came back as a single string', () => {
    const r = parsePass2Output(JSON.stringify({
      summary: 'x',
      impression: 'y',
      respiratoryIndices: {},
      oxygenation: {},
      positional: {},
      studyQuality: { channelIssues: 'flow channel artifact-flagged' },
    }));
    if (!r.ok) throw new Error(r.error);
    expect(r.report.studyQuality.channelIssues).toEqual(['flow channel artifact-flagged']);
  });

  it('unwraps a single-element top-level array', () => {
    const r = parsePass2Output('[' + HAPPY_PATH + ']');
    expect(r.ok).toBe(true);
  });

  it('passes through unknown extra fields without rejecting', () => {
    const r = parsePass2Output(JSON.stringify({
      summary: 'x',
      impression: 'y',
      respiratoryIndices: { ahi: 15.3, somethingNew: 42 },
      oxygenation: {},
      positional: {},
      studyQuality: {},
      brandNewSection: { foo: 'bar' },
    }));
    expect(r.ok).toBe(true);
  });

  it('returns a structured failure (not throw) on garbage', () => {
    const r = parsePass2Output('this is not json at all');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected failure');
    expect(r.error).toMatch(/JSON\.parse failed/);
    expect(r.rawText).toBe('this is not json at all');
  });

  it('returns a structured failure if parse succeeds but shape is unusable', () => {
    const r = parsePass2Output(JSON.stringify({ findings: ['F-001'], notes: 'missing everything' }));
    if (!r.ok) {
      expect(r.error).toMatch(/schema validation failed/);
    } else {
      expect(r.report.summary).toBe('');
      expect(r.report.impression).toBe('');
      expect(r.coerced).toBe(true);
    }
  });

  it('preserves citations map', () => {
    const r = parsePass2Output(HAPPY_PATH);
    if (!r.ok) throw new Error(r.error);
    expect(r.report.citations.summary).toEqual(['F-001']);
    expect(r.report.citations.impression).toEqual(['F-001', 'F-008']);
  });

  it('coerces totalRecordingTime from number to string', () => {
    const r = parsePass2Output(JSON.stringify({
      summary: 'x',
      impression: 'y',
      studyQuality: { totalRecordingTime: 28770, channelIssues: [] },
      respiratoryIndices: {},
      oxygenation: {},
      positional: {},
    }));
    if (!r.ok) throw new Error(r.error);
    expect(typeof r.report.studyQuality.totalRecordingTime).toBe('string');
  });

  it('coerces analysableTime from number to string', () => {
    const r = parsePass2Output(JSON.stringify({
      summary: 'x',
      impression: 'y',
      studyQuality: { analysableTime: 25200, channelIssues: [] },
      respiratoryIndices: {},
      oxygenation: {},
      positional: {},
    }));
    if (!r.ok) throw new Error(r.error);
    expect(typeof r.report.studyQuality.analysableTime).toBe('string');
  });

  it('coerces citation value from single string to array', () => {
    const r = parsePass2Output(JSON.stringify({
      summary: 'x',
      impression: 'y',
      studyQuality: {},
      respiratoryIndices: {},
      oxygenation: {},
      positional: {},
      citations: { summary: 'F-001', impression: 'F-001' },
    }));
    if (!r.ok) throw new Error(r.error);
    expect(Array.isArray(r.report.citations.summary)).toBe(true);
    expect(Array.isArray(r.report.citations.impression)).toBe(true);
  });

  it('coerces null citation value to empty array', () => {
    const r = parsePass2Output(JSON.stringify({
      summary: 'x',
      impression: 'y',
      studyQuality: {},
      respiratoryIndices: {},
      oxygenation: {},
      positional: {},
      citations: { summary: null },
    }));
    if (!r.ok) throw new Error(r.error);
    expect(r.report.citations.summary).toEqual([]);
  });
});
