// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';

const applyHelmet = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      upgradeInsecureRequests: null,
    },
  },
  crossOriginEmbedderPolicy: false,
});

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  applyHelmet(req, res, (error?: unknown) => {
    if (error) {
      next(error);
      return;
    }
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
    );
    next();
  });
}
