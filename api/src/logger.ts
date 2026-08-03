import { createHash } from 'node:crypto';
import pino from 'pino';

const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'request.headers.authorization',
  'request.headers.cookie',
  '*.password',
  '*.token',
  '*.code',
  '*.email',
  '*.filename',
  '*.originalname',
  '*.casePackage',
  '*.case_package',
  '*.content',
  '*.body',
];

export const logger = pino({
  level: process.env['NODE_ENV'] === 'test' ? 'silent' : (process.env['LOG_LEVEL'] ?? 'info'),
  redact: { paths: redactPaths, censor: '[REDACTED]' },
});

export interface SafeErrorLogFields {
  errorType: string;
  errorCode?: string;
  status?: number;
}

function safeErrorIdentifier(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value)
    ? value
    : fallback;
}

/** Log only stable error metadata; messages and stacks can contain clinical data or paths. */
export function errorLogFields(error: unknown): SafeErrorLogFields {
  if (!error || typeof error !== 'object') return { errorType: 'UnknownError' };
  const candidate = error as { name?: unknown; code?: unknown; status?: unknown };
  const fields: SafeErrorLogFields = {
    errorType: safeErrorIdentifier(candidate.name, 'UnknownError'),
  };
  if (typeof candidate.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(candidate.code)) {
    fields.errorCode = candidate.code;
  }
  if (typeof candidate.status === 'number'
    && Number.isInteger(candidate.status)
    && candidate.status >= 100
    && candidate.status <= 599) {
    fields.status = candidate.status;
  }
  return fields;
}

export function hashIp(ip: string | undefined): string {
  const salt = process.env['LOG_HASH_SALT'] ?? process.env['JWT_SECRET'] ?? 'local-development';
  return createHash('sha256').update(`${salt}:${ip ?? ''}`).digest('hex').slice(0, 16);
}
