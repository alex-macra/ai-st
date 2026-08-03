import { getDb } from './connection.js';
import type { ReferenceDoc } from '../shared/types.js';

interface DbRefRow {
  id: string;
  title: string;
  content: string;
  cohort: string;
  type: string;
  license: string;
  created_at: string;
}

function rowToRef(r: DbRefRow): ReferenceDoc {
  return {
    id: r.id,
    title: r.title,
    content: r.content,
    cohort: r.cohort as ReferenceDoc['cohort'],
    type: r.type as ReferenceDoc['type'],
    license: r.license as ReferenceDoc['license'],
    createdAt: r.created_at,
  };
}

export function insertReferenceDoc(doc: ReferenceDoc): void {
  getDb()
    .prepare(
      `INSERT INTO reference_docs (id, title, content, cohort, type, license, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(doc.id, doc.title, doc.content, doc.cohort, doc.type, doc.license, doc.createdAt);
}

export function upsertReferenceDoc(doc: ReferenceDoc): void {
  getDb()
    .prepare(
      `INSERT INTO reference_docs (id, title, content, cohort, type, license, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         content = excluded.content,
         cohort = excluded.cohort,
         type = excluded.type,
         license = excluded.license,
         created_at = excluded.created_at`,
    )
    .run(doc.id, doc.title, doc.content, doc.cohort, doc.type, doc.license, doc.createdAt);
}

export function clearReferencePackDocs(): number {
  const result = getDb().prepare("DELETE FROM reference_docs WHERE instr(id, ':') > 0").run() as {
    changes: number;
  };
  return result.changes;
}

export function replaceReferencePackDocs(docs: ReferenceDoc[]): void {
  const db = getDb();
  db.transaction(() => {
    clearReferencePackDocs();
    for (const doc of docs) upsertReferenceDoc(doc);
  })();
}

export function deleteReferenceDocsByPrefix(prefix: string): number {
  const result = getDb()
    .prepare('DELETE FROM reference_docs WHERE id LIKE ?')
    .run(`${prefix}%`) as { changes: number };
  return result.changes;
}

export function getReferenceDocs(cohort?: string): ReferenceDoc[] {
  // Never return restricted docs (AASM Scoring Manual excluded here)
  const rows = (
    cohort
      ? getDb()
          .prepare(
            "SELECT * FROM reference_docs WHERE cohort = ? AND license != 'restricted' ORDER BY created_at DESC",
          )
          .all(cohort)
      : getDb()
          .prepare(
            "SELECT * FROM reference_docs WHERE license != 'restricted' ORDER BY created_at DESC",
          )
          .all()
  ) as DbRefRow[];
  return rows.map(rowToRef);
}

export function getReferenceDocsForCohortAndType(cohort: string, type: string): ReferenceDoc[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM reference_docs
        WHERE cohort IN (?, 'generic')
          AND type IN (?, 'generic')
          AND license != 'restricted'
        ORDER BY created_at DESC`,
    )
    .all(cohort, type) as DbRefRow[];
  return rows.map(rowToRef);
}

export function deleteReferenceDoc(id: string): boolean {
  const result = getDb().prepare('DELETE FROM reference_docs WHERE id = ?').run(id) as {
    changes: number;
  };
  return result.changes > 0;
}
