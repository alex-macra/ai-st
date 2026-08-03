#!/usr/bin/env node
import 'dotenv/config';
import { seedReferenceDocs } from '../src/refs/seedReferenceDocs.js';

try {
  const status = seedReferenceDocs();
  process.stdout.write(`${JSON.stringify(status)}\n`);
  if (!status.enabled) process.exitCode = 1;
} catch {
  process.stderr.write('Reference pack validation failed.\n');
  process.exitCode = 1;
}
