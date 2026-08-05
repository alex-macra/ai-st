// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import type {
  Case,
  AuditRecord,
  AnalysisEvent,
  ActionPlanEvent,
  ReviewerDecision,
  TokenStats,
  ReportSectionKey,
  EventSlice,
} from '@contracts/types';
import { streamSSE, parseHttpError, errorMessage } from './apiClient';

const BASE = '/api';

async function parseError(res: Response): Promise<string> {
  return errorMessage(await parseHttpError(res));
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  );
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Serialised as JSON with the matching content type. */
  body?: unknown;
  /** FormData is sent as-is so the browser sets the multipart boundary. */
  form?: FormData;
}

/**
 * Every endpoint below shares one shape: send, throw the server's message on a
 * non-2xx, then unwrap a single named key from the JSON envelope. `unwrap` names
 * that key; omit it to get the whole body.
 */
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, form } = options;
  const init: RequestInit = { method };
  if (form) {
    init.body = form;
  } else if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as T;
}

async function send(path: string, options: RequestOptions = {}): Promise<void> {
  await request<unknown>(path, options);
}

const caseUrl = (caseId: string, suffix = ''): string =>
  `/cases/${encodeURIComponent(caseId)}${suffix}`;

// --- Deployment capabilities ---

export interface DeploymentConfig {
  llmMode: 'demo' | 'openai';
}

export function getConfig(): Promise<DeploymentConfig> {
  return request<DeploymentConfig>('/config');
}

export function getModels(): Promise<{ models: string[]; default: string }> {
  return request<{ models: string[]; default: string }>('/models');
}

// --- The generated demo study ---

export interface DemoStudySummary {
  durationSec: number;
  channels: string[];
  respiratoryEvents: number;
  apneas: number;
  hypopneas: number;
  supineEvents: number;
  nonSupineEvents: number;
  expectedEventIndexPerHour: number;
}

export function getDemoStudySummary(): Promise<DemoStudySummary> {
  return request<DemoStudySummary>('/demo/summary');
}

/** The demo recording as a `File`, ready for the ordinary upload form. */
export async function getDemoStudyFile(): Promise<File> {
  const res = await fetch(`${BASE}/demo/study.edf`);
  if (!res.ok) throw new Error(await parseError(res));
  const blob = await res.blob();
  return new File([blob], 'somnoscribe-demo-study.edf', { type: 'application/octet-stream' });
}

// --- Cases ---

export function uploadCase(
  edf: File | null,
  pdf?: File,
  screenshots?: File[],
  cohort?: 'adult' | 'pediatric',
): Promise<{ caseId: string; studyHash: string; name: string }> {
  const form = new FormData();
  if (edf) form.append('edf', edf);
  if (pdf) form.append('pdf', pdf);
  if (screenshots) screenshots.forEach((f) => form.append('screenshots', f));
  if (cohort) form.append('cohort', cohort);
  return request<{ caseId: string; studyHash: string; name: string }>('/upload', {
    method: 'POST',
    form,
  });
}

export async function getCases(status?: string): Promise<Case[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return (await request<{ cases: Case[] }>(`/cases${query}`)).cases;
}

export async function getCase(id: string): Promise<Case> {
  return (await request<{ case: Case }>(caseUrl(id))).case;
}

export function getAuditLog(
  caseId: string,
): Promise<{ auditLog: AuditRecord[]; tokenStats: TokenStats | null }> {
  return request<{ auditLog: AuditRecord[]; tokenStats: TokenStats | null }>(
    caseUrl(caseId, '/audit'),
  );
}

export function patchCaseStatus(caseId: string, status: string): Promise<void> {
  return send(caseUrl(caseId, '/status'), { method: 'PATCH', body: { status } });
}

export function patchFindingDecision(
  caseId: string,
  findingId: string,
  decision: ReviewerDecision,
  editedClaim?: string,
): Promise<void> {
  return send(caseUrl(caseId, `/findings/${encodeURIComponent(findingId)}`), {
    method: 'PATCH',
    body: { decision, ...(editedClaim ? { editedClaim } : {}) },
  });
}

export function patchSectionReview(
  caseId: string,
  sectionKey: ReportSectionKey,
  decision: ReviewerDecision,
  editedValue?: string,
): Promise<void> {
  return send(caseUrl(caseId, `/sections/${encodeURIComponent(sectionKey)}`), {
    method: 'PATCH',
    body: { decision, ...(editedValue ? { editedValue } : {}) },
  });
}

export function deleteCase(caseId: string): Promise<void> {
  return send(caseUrl(caseId), { method: 'DELETE' });
}

export function clearCaseAnalysis(caseId: string): Promise<void> {
  return send(caseUrl(caseId, '/clear-analysis'), { method: 'POST' });
}

export function deleteScreenshot(caseId: string, screenshotId: string): Promise<void> {
  return send(caseUrl(caseId, `/screenshots/${encodeURIComponent(screenshotId)}`), {
    method: 'DELETE',
  });
}

/** `reviewerName` is the reviewer's own attestation and the server requires it. */
export function signOffCase(caseId: string, reviewerName: string): Promise<void> {
  return send(caseUrl(caseId, '/sign-off'), { method: 'POST', body: { reviewerName } });
}

/** Absent or unreadable slices are not an error — the waveform panel just stays empty. */
export async function fetchSignalSlices(caseId: string): Promise<EventSlice[]> {
  try {
    return (
      (await request<{ slices: EventSlice[] }>(caseUrl(caseId, '/signal-slices'))).slices ?? []
    );
  } catch {
    return [];
  }
}

// --- Streaming passes ---

async function streamCaseEndpoint<TEvent>(
  path: string,
  onEvent: (event: TEvent) => void,
  signal: AbortSignal | undefined,
  modelId: string | undefined,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      ...(signal ? { signal } : {}),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(modelId ? { modelId } : {}),
    });
  } catch (err) {
    if (isAbortError(err)) return;
    throw err;
  }

  if (!res.ok) {
    onEvent({ type: 'error', message: await parseError(res) } as TEvent);
    return;
  }

  try {
    await streamSSE<TEvent>(res, onEvent);
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) return;
    onEvent({ type: 'error', message: 'Connection interrupted - please try again.' } as TEvent);
  }
}

export function streamAnalysis(
  caseId: string,
  onEvent: (event: AnalysisEvent) => void,
  signal?: AbortSignal,
  modelId?: string,
): Promise<void> {
  return streamCaseEndpoint<AnalysisEvent>(caseUrl(caseId, '/analyze'), onEvent, signal, modelId);
}

export function streamActionPlan(
  caseId: string,
  onEvent: (event: ActionPlanEvent) => void,
  signal?: AbortSignal,
  modelId?: string,
): Promise<void> {
  return streamCaseEndpoint<ActionPlanEvent>(
    caseUrl(caseId, '/action-plan'),
    onEvent,
    signal,
    modelId,
  );
}
