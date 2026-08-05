// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Deterministic sanity + clinical-range checks for numeric metric findings.
 *
 * Two tiers:
 *   1. Physiological impossibility (absMin/absMax) - drop the finding entirely.
 *   2. Cohort clinical reference range - append a note to finding.uncertainty.
 *
 * These bounds are deliberately wide to avoid false positives on legitimate
 * extreme-but-real values. They are NOT AASM severity thresholds.
 */

type Cohort = 'adult' | 'pediatric' | 'generic';

interface ClinicalRange {
  low?: number;
  high?: number;
}

interface MetricBounds {
  absMin: number;
  absMax: number;
  unit: string;
  adult?: ClinicalRange;
  pediatric?: ClinicalRange;
}

// Events-per-hour indices: negative is impossible; >150 is never recorded
// clinically and almost certainly a sensor/parser error.
const _INDEX_BOUNDS: MetricBounds = {
  absMin: 0,
  absMax: 150,
  unit: 'events/hr',
  adult: { high: 120 },
  pediatric: { high: 60 },
};

const BOUNDS: Record<string, MetricBounds> = {
  ahi: _INDEX_BOUNDS,
  rei: _INDEX_BOUNDS,
  odi3: _INDEX_BOUNDS,
  odi4: _INDEX_BOUNDS,
  centralIndex: _INDEX_BOUNDS,
  meanSpO2: {
    absMin: 50,
    absMax: 100,
    unit: '%',
    adult: { low: 82 },
    pediatric: { low: 85 },
  },
  nadirSpO2: { absMin: 50, absMax: 100, unit: '%' },
  t90Pct: {
    absMin: 0,
    absMax: 100,
    unit: '%',
    adult: { high: 85 },
    pediatric: { high: 65 },
  },
  supineTimePct: { absMin: 0, absMax: 100, unit: '%' },
  meanHr: {
    absMin: 20,
    absMax: 250,
    unit: 'bpm',
    adult: { low: 35, high: 160 },
    pediatric: { low: 35, high: 190 },
  },
  minHr: {
    absMin: 20,
    absMax: 250,
    unit: 'bpm',
    adult: { low: 25 },
    pediatric: { low: 25 },
  },
  maxHr: {
    absMin: 20,
    absMax: 250,
    unit: 'bpm',
    adult: { high: 210 },
    pediatric: { high: 230 },
  },
};

// Maps evidence source strings → metric key in BOUNDS.
// Source strings are defined by Pass 1 prompt conventions.
const SOURCE_TO_METRIC: Record<string, string> = {
  'study_metrics.provisional_ahi_per_hour': 'ahi',
  'study_metrics.provisional_odi_per_hour': 'odi3',
  'study_metrics.spo2.mean_pct': 'meanSpO2',
  'study_metrics.spo2.nadir_pct': 'nadirSpO2',
  'study_metrics.spo2.t90_pct': 't90Pct',
  'pdf_metrics.ahi': 'ahi',
  'pdf_metrics.rdi': 'rei',
  'pdf_metrics.average_spo2_pct': 'meanSpO2',
  'pdf_metrics.minimum_spo2_pct': 'nadirSpO2',
  'pdf_metrics.time_below_90_pct': 't90Pct',
  'pdf_metrics.desaturation_index': 'odi3',
  'pdf_metrics.supine_fraction_pct': 'supineTimePct',
  'pdf_metrics.hr_average': 'meanHr',
  'pdf_metrics.hr_minimum': 'minHr',
  'pdf_metrics.hr_maximum': 'maxHr',
};

export type BoundsOutcome =
  { kind: 'ok' } | { kind: 'impossible'; reason: string } | { kind: 'out_of_range'; note: string };

export function checkMetricBounds(source: string, value: number, cohort: Cohort): BoundsOutcome {
  const key = SOURCE_TO_METRIC[source];
  if (!key) return { kind: 'ok' };

  const b = BOUNDS[key];
  if (!b) return { kind: 'ok' };

  if (value < b.absMin || value > b.absMax) {
    return {
      kind: 'impossible',
      reason: `${key} value ${value} ${b.unit} is outside physiological range [${b.absMin}–${b.absMax}]`,
    };
  }

  if (cohort !== 'generic') {
    const range = b[cohort];
    if (range) {
      const notes: string[] = [];
      if (range.low !== undefined && value < range.low) {
        notes.push(`${value} ${b.unit} is below expected ${cohort} reference (≥${range.low})`);
      }
      if (range.high !== undefined && value > range.high) {
        notes.push(
          `${value} ${b.unit} exceeds expected ${cohort} reference (≤${range.high}); verify source`,
        );
      }
      if (notes.length > 0) {
        return { kind: 'out_of_range', note: notes.join('; ') };
      }
    }
  }

  return { kind: 'ok' };
}
