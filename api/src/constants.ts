// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
export const GPT_MODEL = process.env['GPT_MODEL'] ?? 'gpt-5.4-mini';
export const NANO_MODEL = process.env['NANO_MODEL'] ?? 'gpt-5.4-nano';
export const PROMPT_VERSION = '2.0.0';

export const RATE_LIMIT_WINDOW_MS = 600_000;
export const RATE_LIMIT_MAX = 60;
export const UPLOAD_RATE_LIMIT_MAX = Number(process.env['UPLOAD_RATE_LIMIT_MAX'] ?? 5);
export const AUTH_RATE_LIMIT_MAX = Number(process.env['AUTH_RATE_LIMIT_MAX'] ?? 10);

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
export const MAX_TOTAL_UPLOAD_BYTES = 400 * 1024 * 1024;
export const MAX_PDF_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_SCREENSHOT_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_CASE_PACKAGE_BYTES = 8 * 1024;
export const MAX_SIGNAL_SLICES_BYTES = 25 * 1024 * 1024;

export const PREPROCESSOR_URL = process.env['PREPROCESSOR_URL'] ?? 'http://localhost:8001';

export const CHARTS_DIR = process.env['CHARTS_DIR'] ?? '../preprocessor/data/charts';
export const SLICES_DIR = process.env['SLICES_DIR'] ?? '../preprocessor/data/slices';
export const SCREENSHOTS_DIR = process.env['SCREENSHOTS_DIR'] ?? '../data/screenshots';

export const CASE_STATUSES = ['draft', 'pending_review', 'signed_off'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const FINDING_CONFIDENCES = ['high', 'medium', 'low'] as const;
export type FindingConfidence = (typeof FINDING_CONFIDENCES)[number];

export const EVIDENCE_TYPES = [
  'edf_metric',
  'event_table',
  'report_page',
  'screenshot_window',
  'pdf_metric',
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

// Conservative prompt-size budget for text candidates and attached images.
export const MAX_INPUT_TOKENS = 35_000;
export const TOKEN_BASE_PACKAGE = 1_500; // estimated tokens for the base case package JSON
export const TOKEN_PER_CANDIDATE = 80; // estimated tokens per text candidate summary
export const TOKEN_PER_IMAGE = 1_500; // estimated tokens per 480×180 JPEG (vision)
export const MAX_IMAGE_CANDIDATES = 8; // never attach more than 8 images per Pass 1 call

// Cost per 1M tokens in USD (approximate, for display only)
export const COST_PER_1M_INPUT = 0.15;
export const COST_PER_1M_OUTPUT = 0.6;

export const ALLOWED_MODELS = ['gpt-5.4-nano', 'gpt-5.4-mini', 'gpt-5.4', 'gpt-5.5'] as const;
export type AllowedModel = (typeof ALLOWED_MODELS)[number];

export const ENABLE_BULK_CASE_DELETE = process.env['ENABLE_BULK_CASE_DELETE'] === 'true';

export const ACTION_PLAN_PROMPT_VERSION = '3.0.0';
export const ACTION_PLAN_MAX_OUTPUT_TOKENS = 3_500;
