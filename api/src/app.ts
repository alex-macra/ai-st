import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction, ErrorRequestHandler, Express } from 'express';

import { casesRouter } from './routes/cases.js';
import { referencesRouter } from './routes/references.js';
import { createAuthRouter } from './routes/auth.js';
import { createOrgRouter } from './routes/org.js';
import { createAdminRouter } from './routes/admin.js';
import {
  cleanupUploadTemp,
  enforceUploadContentLength,
  handleUpload,
  uploadMiddleware,
} from './upload.js';
import { createRateLimiter } from './middleware/rateLimit.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { requireAuth } from './middleware/auth.js';
import { logger, hashIp, errorLogFields } from './logger.js';
import { sendError } from './errors.js';
import { parseTrustProxy, type TrustProxySetting } from './env.js';
import {
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX,
  UPLOAD_RATE_LIMIT_MAX,
  AUTH_RATE_LIMIT_MAX,
  ALLOWED_MODELS,
  GPT_MODEL,
} from './constants.js';

const require = createRequire(import.meta.url);
const express = require('express') as typeof import('express');
const cors = require('cors') as typeof import('cors');
const cookieParser = require('cookie-parser') as typeof import('cookie-parser');

export interface AppConfig {
  corsOrigins?: string[];
  rateLimitWindowMs?: number;
  rateLimitMax?: number;
  uploadRateLimitMax?: number;
  trustProxy?: TrustProxySetting;
}

function browserOriginAllowed(req: Request, configuredOrigins: string[]): boolean {
  const origin = req.get('origin');
  if (!origin) return true;
  if (configuredOrigins.length > 0) return configuredOrigins.includes(origin);
  const host = req.get('host');
  if (!host) return false;
  try {
    return new URL(origin).origin === `${req.protocol}://${host}`;
  } catch {
    return false;
  }
}

export function createApp(cfg: AppConfig = {}): Express {
  const corsOrigins = cfg.corsOrigins ?? [];
  const rateLimitWindowMs = cfg.rateLimitWindowMs ?? RATE_LIMIT_WINDOW_MS;
  const rateLimitMax = cfg.rateLimitMax ?? RATE_LIMIT_MAX;
  const uploadRateLimitMax = cfg.uploadRateLimitMax ?? UPLOAD_RATE_LIMIT_MAX;

  const app = express();
  app.set('trust proxy', cfg.trustProxy ?? parseTrustProxy(process.env['TRUST_PROXY']));
  app.disable('x-powered-by');

  app.use(securityHeaders);
  app.use(express.json({ limit: '64kb' }));
  app.use(cookieParser());

  app.use((_req: Request, res: Response, next: NextFunction): void => {
    res.locals['requestId'] = randomUUID();
    next();
  });

  app.use((req: Request, res: Response, next: NextFunction): void => {
    const requestId = res.locals['requestId'] as string;
    res.locals['log'] = logger.child({ requestId });
    const start = Date.now();
    res.on('finish', () => {
      logger.info(
        {
          requestId,
          method: req.method,
          status: res.statusCode,
          durationMs: Date.now() - start,
          ipHash: hashIp(req.ip),
        },
        'request',
      );
    });
    next();
  });

  if (corsOrigins.length > 0) {
    app.use(
      cors({
        methods: ['GET', 'POST', 'PATCH', 'DELETE'],
        credentials: true,
        origin(origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) {
          if (!origin) return cb(null, true);
          cb(null, corsOrigins.includes(origin));
        },
      }),
    );
  }

  app.use((req: Request, res: Response, next: NextFunction): void => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      next();
      return;
    }
    if (browserOriginAllowed(req, corsOrigins)) {
      next();
      return;
    }
    sendError(res, 403, 'ORIGIN_NOT_ALLOWED', 'Request origin is not allowed');
  });

  // Loopback skips rate limiting in dev so health probes don't burn budget;
  // TEST_RATE_LIMIT_INCLUDE_LOOPBACK=1 disables the skip for limiter tests.
  const skipLoopback = process.env['TEST_RATE_LIMIT_INCLUDE_LOOPBACK'] !== '1';
  const globalLimiter = createRateLimiter({
    windowMs: rateLimitWindowMs,
    maxRequests: rateLimitMax,
    skipLoopback,
  });
  const uploadLimiter = createRateLimiter({
    windowMs: rateLimitWindowMs,
    maxRequests: uploadRateLimitMax,
    skipLoopback,
  });
  const authLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    maxRequests: AUTH_RATE_LIMIT_MAX,
    skipLoopback: false,
  });

  app.use(globalLimiter);

  app.get('/healthz', (_req: Request, res: Response): void => {
    res.json({ ok: true, ts: new Date().toISOString() });
  });

  app.get('/api/models', (_req: Request, res: Response): void => {
    res.json({ models: ALLOWED_MODELS, default: GPT_MODEL });
  });

  app.use('/api/auth', authLimiter, createAuthRouter());
  app.use('/api/org', createOrgRouter());
  app.use('/api/cases', casesRouter());
  app.use('/api/references', referencesRouter());
  app.use('/api/admin', createAdminRouter());

  app.post(
    '/api/upload',
    uploadLimiter,
    requireAuth,
    enforceUploadContentLength,
    (req: Request, res: Response, next: NextFunction) => {
      uploadMiddleware(req, res, (err?: unknown) => {
        if (!err) {
          next();
          return;
        }
        void cleanupUploadTemp(req)
          .then(() => {
            const code =
              err && typeof err === 'object' && 'code' in err
                ? (err as { code: string }).code
                : null;
            if (code === 'LIMIT_UNEXPECTED_FILE' || code === 'LIMIT_FILE_COUNT') {
              sendError(res, 400, 'TOO_MANY_FILES', 'Too many screenshots - max 100 allowed');
            } else if (code === 'LIMIT_FILE_SIZE') {
              sendError(res, 413, 'FILE_TOO_LARGE', 'One or more files exceed the size limit');
            } else if (
              code === 'LIMIT_FIELD_VALUE' ||
              code === 'LIMIT_FIELD_COUNT' ||
              code === 'LIMIT_PART_COUNT'
            ) {
              sendError(
                res,
                413,
                'UPLOAD_TOO_LARGE',
                'The multipart request exceeds the size limit',
              );
            } else {
              next(err);
            }
          })
          .catch(next);
      });
    },
    (req: Request, res: Response): void => {
      handleUpload(req, res).catch((err: unknown) => {
        logger.error(errorLogFields(err), 'upload_handler_error');
        if (!res.headersSent) sendError(res, 500, 'INTERNAL_ERROR', 'Internal Server Error');
      });
    },
  );

  const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
    logger.error(errorLogFields(err), 'unhandled_error');
    if (res.headersSent) return;
    const error =
      err && typeof err === 'object' ? (err as { status?: unknown; type?: unknown }) : null;
    if (error?.status === 400 && error.type === 'entity.parse.failed') {
      sendError(res, 400, 'INVALID_JSON', 'Request body is not valid JSON');
      return;
    }
    if (error?.status === 413) {
      sendError(res, 413, 'REQUEST_TOO_LARGE', 'Request body exceeds the size limit');
      return;
    }
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal Server Error');
  };

  app.use(errorHandler);

  return app;
}
