#!/usr/bin/env node
// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Promote a user to admin by email.
 *
 * Usage:
 *   npx tsx api/scripts/makeAdmin.ts <email>
 *
 * Loads api/.env reliably regardless of cwd, then runs the full migrate()
 * before flipping `is_admin = 1`. Mirrors the pattern used by
 * api/scripts/generateLicenses.ts.
 */
import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { openDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const API_DIR = resolve(SCRIPT_DIR, '..');
dotenvConfig({ path: resolve(API_DIR, '.env') });

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error('Usage: npx tsx api/scripts/makeAdmin.ts <email>');
  process.exit(2);
}

const dbPath = resolve(API_DIR, process.env['DB_PATH'] ?? 'data/cases.sqlite');
const db = openDb(dbPath);
migrate(db);

const result = db.prepare('UPDATE users SET is_admin = 1 WHERE email = ?').run(email) as {
  changes: number;
};
if (result.changes === 0) {
  console.error('No matching user was found.');
  db.close();
  process.exit(1);
}
console.log('The matching user now has administrator access.');
db.close();
