import { randomBytes } from 'node:crypto';
import type BetterSqlite3 from 'better-sqlite3';

export interface Invitation {
  key: string;
  used: number;
  used_at: string | null;
  used_by: string | null;
  tier: string;
  created_at: string;
}

export function createLicenseTable(
  db: BetterSqlite3.Database,
  options: { trackUsedBy?: boolean } = {},
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS licenses (
      key        TEXT PRIMARY KEY,
      used       INTEGER NOT NULL DEFAULT 0,
      used_at    TEXT,
      used_by    TEXT,
      tier       TEXT NOT NULL DEFAULT 'starter',
      created_at TEXT NOT NULL
    )
  `);

  if (options.trackUsedBy) {
    const columns = db.prepare('PRAGMA table_info(licenses)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'used_by')) {
      db.exec('ALTER TABLE licenses ADD COLUMN used_by TEXT');
    }
  }
}

export function insertLicense(db: BetterSqlite3.Database, key: string, tier = 'starter'): void {
  db.prepare(
    `
    INSERT INTO licenses (key, used, used_at, used_by, tier, created_at)
    VALUES (?, 0, NULL, NULL, ?, ?)
  `,
  ).run(key, tier, new Date().toISOString());
}

export function getLicense(db: BetterSqlite3.Database, key: string): Invitation | undefined {
  return db.prepare('SELECT * FROM licenses WHERE key = ?').get(key) as Invitation | undefined;
}

export function burnLicense(db: BetterSqlite3.Database, key: string, usedBy?: string): boolean {
  const result = db
    .prepare(
      `
    UPDATE licenses
       SET used = 1, used_at = ?, used_by = ?
     WHERE key = ? AND used = 0
  `,
    )
    .run(new Date().toISOString(), usedBy ?? null, key);
  return result.changes === 1;
}

function generateInvitationKey(): string {
  const body = randomBytes(10)
    .toString('hex')
    .toUpperCase()
    .match(/.{1,4}/g)
    ?.join('-');
  if (!body) throw new Error('Failed to generate invitation key');
  return `AIST-${body}`;
}

export function mintLicenseKeys(
  db: BetterSqlite3.Database,
  count: number,
  tier = 'starter',
): string[] {
  if (!Number.isInteger(count) || count < 1 || count > 1_000) {
    throw new RangeError('count must be an integer between 1 and 1000');
  }

  const keys: string[] = [];
  const insert = db.transaction(() => {
    while (keys.length < count) {
      const key = generateInvitationKey();
      try {
        insertLicense(db, key, tier);
        keys.push(key);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('UNIQUE')) throw error;
      }
    }
  });
  insert();
  return keys;
}
