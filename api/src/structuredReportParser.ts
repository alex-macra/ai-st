import { z } from 'zod';
import { REPORT_SECTION_KEYS } from './shared/types.js';
import type { StructuredReport } from './shared/types.js';

const numericLoose = z.preprocess((v) => {
  if (v === null || v === undefined || v === '') return undefined;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}, z.number().optional());

const stringLoose = z.preprocess((v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  return String(v);
}, z.string());

const stringArrayLoose = z.preprocess((v) => {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.filter((x) => x != null).map(String);
  if (typeof v === 'string') return [v];
  return [];
}, z.array(z.string()));

const citationsShape = Object.fromEntries(
  REPORT_SECTION_KEYS.map((key) => [key, stringArrayLoose])
) as Record<(typeof REPORT_SECTION_KEYS)[number], typeof stringArrayLoose>;

const stringOptionalLoose = z.preprocess((v) => {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string') return v;
  return String(v);
}, z.string().optional());

export const structuredReportTolerantSchema = z.object({
  summary: stringLoose.default(''),
  studyQuality: z.object({
    totalRecordingTime: stringOptionalLoose,
    analysableTime: stringOptionalLoose,
    channelIssues: stringArrayLoose.default([])
  }).default({ channelIssues: [] }),
  respiratoryIndices: z.object({
    ahi: numericLoose,
    rei: numericLoose,
    reiArtifactAdjusted: numericLoose,
    odi3: numericLoose,
    odi4: numericLoose,
    centralIndex: numericLoose,
    apneaCount: numericLoose,
    hypopneaCount: numericLoose,
    avgEventDurationSec: numericLoose,
    maxEventDurationSec: numericLoose
  }).passthrough().default({}),
  oxygenation: z.object({
    meanSpO2: numericLoose,
    baselineSpO2: numericLoose,
    nadirSpO2: numericLoose,
    t90Pct: numericLoose,
    t80Pct: numericLoose,
    desatCount: numericLoose,
    avgDesatDepth: numericLoose,
    deepestDesat: numericLoose,
    avgDesatDuration: numericLoose,
    longestDesatSec: numericLoose,
    sumDesatSec: numericLoose
  }).passthrough().default({}),
  positional: z.object({
    supineAhi: numericLoose,
    nonSupineAhi: numericLoose,
    supineTimePct: numericLoose,
    leftTimePct: numericLoose,
    rightTimePct: numericLoose,
    proneTimePct: numericLoose,
    uprightTimePct: numericLoose
  }).passthrough().default({}),
  snoring: z.object({
    snoreTimePct: numericLoose,
    snoreIndex: numericLoose,
    snoreMinutes: numericLoose
  }).passthrough().optional(),
  cardiac: z.object({
    meanHr: numericLoose,
    minHr: numericLoose,
    maxHr: numericLoose,
    wakeMeanHr: numericLoose,
    wakeMinHr: numericLoose,
    wakeMaxHr: numericLoose
  }).passthrough().optional(),
  impression: stringLoose.default(''),
  citations: z.object(citationsShape).partial().default({})
}).passthrough();

export interface ParseResult {
  ok: true;
  report: StructuredReport;
  coerced: boolean;
  warnings: string[];
}

export interface ParseFailure {
  ok: false;
  error: string;
  rawText: string;
}

function stripFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

function unwrapTopLevelArray(value: unknown): unknown {
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === 'object' && value[0] !== null) {
    return value[0];
  }
  return value;
}

export function parsePass2Output(raw: string): ParseResult | ParseFailure {
  const text = stripFences(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `JSON.parse failed: ${(err as Error).message}`, rawText: text };
  }

  parsed = unwrapTopLevelArray(parsed);

  const warnings: string[] = [];
  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate?.summary !== 'string') warnings.push(`summary was ${typeof candidate?.summary}, coerced to string`);
  if (typeof candidate?.impression !== 'string') warnings.push(`impression was ${typeof candidate?.impression}, coerced to string`);

  const result = structuredReportTolerantSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      error: `schema validation failed: ${result.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      rawText: text
    };
  }

  return {
    ok: true,
    report: result.data as StructuredReport,
    coerced: warnings.length > 0,
    warnings
  };
}
