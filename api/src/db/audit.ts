import { randomUUID } from 'node:crypto';
import { getDb } from './connection.js';
import type { AuditRecord } from '../shared/types.js';

export function insertAuditRecord(r: AuditRecord): void {
  getDb()
    .prepare(
      `INSERT INTO audit_log (id, case_id, action, actor_id, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      r.id,
      r.caseId,
      r.action,
      r.actorId ?? null,
      r.metadata ? JSON.stringify(r.metadata) : null,
      r.createdAt
    );
}

export function insertAnalysisAuditRecord(
  caseId: string,
  userId: string,
  tokensIn: number,
  tokensOut: number
): void {
  getDb()
    .prepare(
      'INSERT INTO analysis_audit (id, case_id, user_id, tokens_in, tokens_out, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(randomUUID(), caseId, userId, tokensIn, tokensOut, new Date().toISOString());
}

export interface AdminAuditRecord {
  actorId: string;
  action: 'set_admin' | 'export_usage_csv' | 'export_cases_json';
  targetUserId?: string;
  metadata?: Record<string, unknown>;
}

export function insertAdminAuditRecord(r: AdminAuditRecord): void {
  getDb()
    .prepare(
      `INSERT INTO admin_audit_log (id, actor_id, action, target_user_id, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      r.actorId,
      r.action,
      r.targetUserId ?? null,
      r.metadata ? JSON.stringify(r.metadata) : null,
      new Date().toISOString()
    );
}

export function getAuditLog(caseId: string): AuditRecord[] {
  interface DbAuditRow {
    id: string;
    case_id: string;
    action: string;
    actor_id: string | null;
    metadata: string | null;
    created_at: string;
  }
  const rows: DbAuditRow[] = getDb()
    .prepare('SELECT * FROM audit_log WHERE case_id = ? ORDER BY created_at ASC')
    .all(caseId) as DbAuditRow[];
  return rows.map((r) => ({
    id: r.id,
    caseId: r.case_id,
    action: r.action,
    ...(r.actor_id !== null ? { actorId: r.actor_id } : {}),
    ...(r.metadata !== null ? { metadata: JSON.parse(r.metadata) as Record<string, unknown> } : {}),
    createdAt: r.created_at
  }));
}
