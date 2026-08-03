#!/usr/bin/env node
/**
 * Mint license keys against the API's primary SQLite DB.
 *
 * Usage:
 *   npx tsx api/scripts/generateLicenses.ts [count] [tier]
 *
 * Defaults: count=10, tier=starter. Reads DB_PATH from api/.env (or process
 * env), falling back to api/data/cases.sqlite to match the API's runtime
 * default.
 */
import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mintLicenseKeys } from '../src/license.js';
import { openDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const API_DIR = resolve(SCRIPT_DIR, '..');
dotenvConfig({ path: resolve(API_DIR, '.env') });

const COUNT = Number(process.argv[2] ?? '10');
const TIER  = process.argv[3] ?? 'starter';

if (!Number.isInteger(COUNT) || COUNT <= 0 || COUNT > 1_000) {
  console.error('Count must be an integer between 1 and 1000.');
  process.exit(2);
}
if (!/^[a-z][a-z0-9_-]{0,31}$/i.test(TIER)) {
  console.error('Tier must be a short alphanumeric identifier.');
  process.exit(2);
}

const dbPath = resolve(API_DIR, process.env['DB_PATH'] ?? 'data/cases.sqlite');
const db = openDb(dbPath);
migrate(db);

const keys = mintLicenseKeys(db, COUNT, TIER);
for (const k of keys) console.log(k);
console.error(`\nGenerated ${keys.length} local invitation key(s).`);
db.close();
