import { rateLimit, type AugmentedRequest } from 'express-rate-limit';
import type { RequestHandler } from 'express';

export interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  skipLoopback?: boolean;
}

function isLoopback(ip: string | undefined): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

export function createRateLimiter(options: RateLimitOptions): RequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.maxRequests,
    standardHeaders: false,
    legacyHeaders: true,
    skip: (req) => options.skipLoopback === true && isLoopback(req.ip),
    handler: (req, res) => {
      const resetTime = (req as AugmentedRequest).rateLimit?.resetTime?.getTime() ?? Date.now() + options.windowMs;
      const retryAfterSec = Math.max(1, Math.ceil((resetTime - Date.now()) / 1_000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({ error: 'Rate limit exceeded', retryAfterSec });
    },
  });
}
