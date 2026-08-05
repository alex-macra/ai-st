// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import 'dotenv/config';
import { createApp } from './app.js';
import { logger, errorLogFields } from './logger.js';
import { seedReferenceDocs } from './refs/seedReferenceDocs.js';
import {
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX,
  UPLOAD_RATE_LIMIT_MAX,
  PREPROCESSOR_URL,
  NANO_MODEL,
  ALLOWED_MODELS,
} from './constants.js';
import { jwtSecretError, parseTrustProxy } from './env.js';
import { purgeDemoDataForCurrentMode } from './demoData.js';

const jwtErr = jwtSecretError();
if (jwtErr) {
  process.stderr.write(`FATAL: ${jwtErr}\n`);
  process.exit(1);
}

if (!(ALLOWED_MODELS as readonly string[]).includes(NANO_MODEL)) {
  process.stderr.write(`FATAL: NANO_MODEL "${NANO_MODEL}" is not in ALLOWED_MODELS\n`);
  process.exit(1);
}

const PORT = Number(process.env['PORT'] ?? 3001);
const HOST = process.env['HOST'] ?? '127.0.0.1';

async function checkPreprocessor(): Promise<void> {
  try {
    const resp = await fetch(`${PREPROCESSOR_URL}/healthz`, { signal: AbortSignal.timeout(3000) });
    if (resp.ok) {
      logger.info('preprocessor_healthy');
    } else {
      logger.warn({ status: resp.status }, 'preprocessor_unhealthy');
    }
  } catch {
    logger.warn('preprocessor_unreachable');
  }
}

const app = createApp({
  corsOrigins: (process.env['CORS_ORIGINS'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  rateLimitWindowMs: Number(process.env['RATE_LIMIT_WINDOW_MS'] ?? RATE_LIMIT_WINDOW_MS),
  rateLimitMax: Number(process.env['RATE_LIMIT_MAX'] ?? RATE_LIMIT_MAX),
  uploadRateLimitMax: Number(process.env['UPLOAD_RATE_LIMIT_MAX'] ?? UPLOAD_RATE_LIMIT_MAX),
  trustProxy: parseTrustProxy(process.env['TRUST_PROXY']),
});

try {
  seedReferenceDocs();
} catch (err) {
  logger.warn(
    { errorType: err instanceof Error ? err.name : 'UnknownError' },
    'reference_docs_seed_failed',
  );
}

void purgeDemoDataForCurrentMode();
const demoPurgeTimer = setInterval(
  () => {
    void purgeDemoDataForCurrentMode();
  },
  15 * 60 * 1_000,
);
demoPurgeTimer.unref();

const server = app.listen(PORT, HOST, () => {
  logger.info({ host: HOST, port: PORT }, 'server_listening');
  void checkPreprocessor();
});

server.on('error', (err: NodeJS.ErrnoException) => {
  logger.fatal(errorLogFields(err), 'server_start_failed');
  process.exit(1);
});

process.on('SIGTERM', () => {
  logger.info('sigterm_received');
  server.close(() => {
    logger.info('server_closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('sigint_received');
  server.close(() => {
    logger.info('server_closed');
    process.exit(0);
  });
});
