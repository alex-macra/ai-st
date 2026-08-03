import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb } from '../db/connection.js';

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'ai-st-db-permissions-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('database filesystem permissions', () => {
  it('protects the database file without changing a pre-existing parent', () => {
    const root = temporaryRoot();
    chmodSync(root, 0o755);
    const dbPath = path.join(root, 'cases.sqlite');

    const db = openDb(dbPath);
    db.close();

    expect(statSync(root).mode & 0o777).toBe(0o755);
    expect(statSync(dbPath).mode & 0o777).toBe(0o600);
  });

  it('creates a missing database directory with private permissions', () => {
    const root = temporaryRoot();
    const parent = path.join(root, 'private-data');
    const dbPath = path.join(parent, 'cases.sqlite');

    const db = openDb(dbPath);
    db.close();

    expect(statSync(parent).mode & 0o777).toBe(0o700);
    expect(statSync(dbPath).mode & 0o777).toBe(0o600);
  });
});
