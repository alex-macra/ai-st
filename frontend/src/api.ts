import type {
  Case,
  AuditRecord,
  AnalysisEvent,
  ActionPlanEvent,
  ReviewerDecision,
  TokenStats,
  ReportSectionKey,
  User,
  EventSlice,
} from './shared/types';
import { streamSSE, parseHttpError, errorMessage } from './apiClient';

const BASE = '/api';

let _unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(fn: () => void): void {
  _unauthorizedHandler = fn;
}

async function parseError(res: Response): Promise<string> {
  return errorMessage(await parseHttpError(res));
}

async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (res.status === 401) {
    _unauthorizedHandler?.();
    throw new Error('Unauthorized');
  }
  return res;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  );
}

// --- Auth ---

export async function getMe(): Promise<User | null> {
  const res = await fetch(`${BASE}/auth/me`);
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { user: User };
  return data.user;
}

export async function activate(email: string, licenseKey: string): Promise<User> {
  const res = await fetch(`${BASE}/auth/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, licenseKey }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { user: User };
  return data.user;
}

export async function requestOtp(email: string): Promise<void> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function verifyOtp(email: string, code: string): Promise<User> {
  const res = await fetch(`${BASE}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { user: User };
  return data.user;
}

export async function logout(): Promise<void> {
  await fetch(`${BASE}/auth/logout`, { method: 'POST' });
}

export async function updateDisplayName(name: string): Promise<void> {
  const res = await apiFetch(`${BASE}/auth/me/name`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

// --- Cases ---

export async function uploadCase(
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

  const res = await apiFetch(`${BASE}/upload`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<{ caseId: string; studyHash: string; name: string }>;
}

export async function getCases(status?: string): Promise<Case[]> {
  const url = status ? `${BASE}/cases?status=${encodeURIComponent(status)}` : `${BASE}/cases`;
  const res = await apiFetch(url);
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { cases: Case[] };
  return data.cases;
}

export async function getCase(id: string): Promise<Case> {
  const res = await apiFetch(`${BASE}/cases/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { case: Case };
  return data.case;
}

export async function getAuditLog(
  caseId: string,
): Promise<{ auditLog: AuditRecord[]; tokenStats: TokenStats | null }> {
  const res = await apiFetch(`${BASE}/cases/${encodeURIComponent(caseId)}/audit`);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<{ auditLog: AuditRecord[]; tokenStats: TokenStats | null }>;
}

export async function getModels(): Promise<{ models: string[]; default: string }> {
  const res = await fetch(`${BASE}/models`);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<{ models: string[]; default: string }>;
}

export async function patchCaseStatus(
  caseId: string,
  status: string,
  actorId?: string,
): Promise<void> {
  const res = await apiFetch(`${BASE}/cases/${encodeURIComponent(caseId)}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, ...(actorId ? { actorId } : {}) }),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function patchFindingDecision(
  caseId: string,
  findingId: string,
  decision: ReviewerDecision,
  editedClaim?: string,
  actorId?: string,
): Promise<void> {
  const res = await apiFetch(
    `${BASE}/cases/${encodeURIComponent(caseId)}/findings/${encodeURIComponent(findingId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decision,
        ...(editedClaim ? { editedClaim } : {}),
        ...(actorId ? { actorId } : {}),
      }),
    },
  );
  if (!res.ok) throw new Error(await parseError(res));
}

export async function patchSectionReview(
  caseId: string,
  sectionKey: ReportSectionKey,
  decision: ReviewerDecision,
  editedValue?: string,
  actorId?: string,
): Promise<void> {
  const res = await apiFetch(
    `${BASE}/cases/${encodeURIComponent(caseId)}/sections/${encodeURIComponent(sectionKey)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decision,
        ...(editedValue ? { editedValue } : {}),
        ...(actorId ? { actorId } : {}),
      }),
    },
  );
  if (!res.ok) throw new Error(await parseError(res));
}

export async function deleteCase(caseId: string): Promise<void> {
  const res = await apiFetch(`${BASE}/cases/${encodeURIComponent(caseId)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function clearCaseAnalysis(caseId: string): Promise<void> {
  const res = await apiFetch(`${BASE}/cases/${encodeURIComponent(caseId)}/clear-analysis`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function fetchSignalSlices(caseId: string): Promise<EventSlice[]> {
  const res = await apiFetch(`${BASE}/cases/${encodeURIComponent(caseId)}/signal-slices`);
  if (!res.ok) return [];
  const data = (await res.json()) as { slices: EventSlice[] };
  return data.slices ?? [];
}

export async function deleteScreenshot(caseId: string, screenshotId: string): Promise<void> {
  const res = await apiFetch(
    `${BASE}/cases/${encodeURIComponent(caseId)}/screenshots/${encodeURIComponent(screenshotId)}`,
    { method: 'DELETE' },
  );
  if (!res.ok) throw new Error(await parseError(res));
}

export async function signOffCase(caseId: string, actorId: string): Promise<void> {
  const res = await apiFetch(`${BASE}/cases/${encodeURIComponent(caseId)}/sign-off`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actorId }),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

async function streamCaseEndpoint<TEvent>(
  path: string,
  onEvent: (event: TEvent) => void,
  signal: AbortSignal | undefined,
  modelId: string | undefined,
  sessionExpiredEvent: TEvent,
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

  if (res.status === 401) {
    _unauthorizedHandler?.();
    onEvent(sessionExpiredEvent);
    return;
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

export function streamActionPlan(
  caseId: string,
  onEvent: (event: ActionPlanEvent) => void,
  signal?: AbortSignal,
  modelId?: string,
): Promise<void> {
  return streamCaseEndpoint<ActionPlanEvent>(
    `/cases/${encodeURIComponent(caseId)}/action-plan`,
    onEvent,
    signal,
    modelId,
    { type: 'error', message: 'Session expired. Please sign in again.' },
  );
}

export function streamAnalysis(
  caseId: string,
  onEvent: (event: AnalysisEvent) => void,
  signal?: AbortSignal,
  modelId?: string,
): Promise<void> {
  return streamCaseEndpoint<AnalysisEvent>(
    `/cases/${encodeURIComponent(caseId)}/analyze`,
    onEvent,
    signal,
    modelId,
    { type: 'error', message: 'Session expired. Please sign in again.' },
  );
}

// --- Admin ---

export interface AdminDashboardCounts {
  users: number;
  cases: number;
  signedOff: number;
  pending: number;
  tokensTotal: number;
  casesToday: number;
}

export interface AdminUserRow {
  id: string;
  email: string;
  displayName: string | null;
  isAdmin: boolean;
  createdAt: string;
  lastSeen: string | null;
  tier: string;
  tokensTotal: number;
}

export interface AdminUsersPage {
  users: AdminUserRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function adminDashboard(): Promise<AdminDashboardCounts> {
  const res = await apiFetch(`${BASE}/admin/dashboard`);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<AdminDashboardCounts>;
}

export async function adminUsers(page: number, pageSize = 50): Promise<AdminUsersPage> {
  const res = await apiFetch(`${BASE}/admin/users?page=${page}&pageSize=${pageSize}`);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<AdminUsersPage>;
}

export async function setUserAdmin(userId: string, isAdmin: boolean): Promise<void> {
  const res = await apiFetch(`${BASE}/admin/users/${encodeURIComponent(userId)}/admin`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isAdmin }),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export function adminExportUsageCsvUrl(): string {
  return `${BASE}/admin/export/usage.csv`;
}

export function adminExportCasesJsonUrl(): string {
  return `${BASE}/admin/export/cases.json`;
}
