import { chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { migrate } from './migrate.js';

export const DB_PATH = process.env['DB_PATH'] ?? path.join(process.cwd(), 'data', 'cases.sqlite');

let database: BetterSqlite3.Database | undefined;

export function openDb(dbPath: string): BetterSqlite3.Database {
  const resolvedPath = path.resolve(dbPath);
  if (dbPath !== ':memory:') {
    const parent = path.dirname(resolvedPath);
    const created = mkdirSync(parent, { recursive: true, mode: 0o700 });
    if (created !== undefined) chmodSync(parent, 0o700);
  }
  const db = new BetterSqlite3(dbPath === ':memory:' ? dbPath : resolvedPath);
  if (dbPath !== ':memory:') chmodSync(resolvedPath, 0o600);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  if (dbPath !== ':memory:') db.pragma('journal_mode = WAL');
  return db;
}

export function getDb(): BetterSqlite3.Database {
  if (!database) {
    database = openDb(DB_PATH);
    migrate(database);
  }
  return database;
}
