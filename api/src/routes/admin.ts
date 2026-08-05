// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { createRequire } from 'node:module';
import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import {
  getDb,
  getUserById,
  setUserAdmin,
  getUsersPage,
  getAdminDashboardCounts,
  insertAdminAuditRecord,
} from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { logger, errorLogFields } from '../logger.js';

const require = createRequire(import.meta.url);
const express = require('express') as typeof import('express');

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

const uuidSchema = z.string().uuid();

const usersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

const setAdminBodySchema = z.object({
  isAdmin: z.boolean(),
});

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function createAdminRouter(): Router {
  const router = express.Router();

  router.use(requireAdmin);

  router.get('/dashboard', (_req: Request, res: Response): void => {
    try {
      const counts = getAdminDashboardCounts();
      res.json(counts);
    } catch (err) {
      logger.error(errorLogFields(err), 'admin_dashboard_failed');
      res.status(500).json({ error: 'Failed to load dashboard' });
    }
  });

  router.get('/users', (req: Request, res: Response): void => {
    const parsed = usersQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query', issues: parsed.error.issues });
      return;
    }
    try {
      const { page, pageSize } = parsed.data;
      const { users, total } = getUsersPage(page, pageSize);
      res.json({ users, total, page, pageSize });
    } catch (err) {
      logger.error(errorLogFields(err), 'admin_users_failed');
      res.status(500).json({ error: 'Failed to load users' });
    }
  });

  router.patch('/users/:id/admin', (req: Request, res: Response): void => {
    const idParsed = uuidSchema.safeParse(req.params['id']);
    if (!idParsed.success) {
      res.status(400).json({ error: 'Invalid user id' });
      return;
    }
    const bodyParsed = setAdminBodySchema.safeParse(req.body);
    if (!bodyParsed.success) {
      res.status(400).json({ error: 'Invalid body', issues: bodyParsed.error.issues });
      return;
    }
    const actorId = req.user!.id;
    const targetId = idParsed.data;
    const nextIsAdmin = bodyParsed.data.isAdmin;
    try {
      const result = getDb().transaction(() => {
        const existing = getUserById(targetId);
        if (!existing) return { kind: 'not_found' as const };
        if (existing.isDemo) return { kind: 'demo_user' as const };

        if (nextIsAdmin === false) {
          if (actorId === targetId) return { kind: 'self_demote' as const };
          const adminCount = (
            getDb().prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').get() as {
              n: number;
            }
          ).n;
          if (existing.isAdmin && adminCount <= 1) return { kind: 'last_admin' as const };
        }

        setUserAdmin(targetId, nextIsAdmin);
        insertAdminAuditRecord({
          actorId,
          action: 'set_admin',
          targetUserId: targetId,
          metadata: { isAdmin: nextIsAdmin, previousIsAdmin: existing.isAdmin },
        });
        return { kind: 'updated' as const, user: getUserById(targetId) };
      })();

      if (result.kind === 'not_found') {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      if (result.kind === 'demo_user') {
        res.status(403).json({ error: 'Demo users cannot be granted administrator access.' });
        return;
      }
      if (result.kind === 'self_demote') {
        res.status(409).json({ error: 'You cannot revoke your own admin access.' });
        return;
      }
      if (result.kind === 'last_admin') {
        res.status(409).json({ error: 'Cannot demote the last admin.' });
        return;
      }

      logger.info(
        { actorId, targetUserId: targetId, isAdmin: nextIsAdmin },
        'admin_user_admin_changed',
      );
      res.json({ user: result.user });
    } catch (err) {
      logger.error(errorLogFields(err), 'admin_set_admin_failed');
      res.status(500).json({ error: 'Failed to update user' });
    }
  });

  router.get('/export/usage.csv', (req: Request, res: Response): void => {
    try {
      interface UsageRow {
        case_id: string;
        user_id: string;
        tokens_in: number;
        tokens_out: number;
        created_at: string;
      }
      const rows = getDb()
        .prepare(
          `SELECT case_id, user_id, tokens_in, tokens_out, created_at
             FROM analysis_audit
            ORDER BY created_at DESC`,
        )
        .all() as UsageRow[];

      const headers = [
        'case_id',
        'user_id',
        'model',
        'tokens_in',
        'tokens_out',
        'cache_read',
        'cost_usd',
        'created_at',
      ];
      const lines = [headers.join(',')];
      for (const r of rows) {
        lines.push(
          [
            csvEscape(r.case_id),
            csvEscape(r.user_id),
            csvEscape(''),
            csvEscape(r.tokens_in),
            csvEscape(r.tokens_out),
            csvEscape(''),
            csvEscape(''),
            csvEscape(r.created_at),
          ].join(','),
        );
      }
      const csv = lines.join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="usage-${todayStamp()}.csv"`);
      insertAdminAuditRecord({
        actorId: req.user!.id,
        action: 'export_usage_csv',
        metadata: { rowCount: rows.length },
      });
      res.send(csv);
    } catch (err) {
      logger.error(errorLogFields(err), 'admin_export_usage_failed');
      res.status(500).json({ error: 'Failed to export usage' });
    }
  });

  router.get('/export/cases.json', (req: Request, res: Response): void => {
    try {
      interface CaseExportRow {
        id: string;
        status: string;
        cohort: string | null;
        created_at: string;
        signed_off_at: string | null;
        tokens_in: number;
        tokens_out: number;
      }
      // Whitelist non-PHI columns only — never case_data / findings / narrative.
      // Per-field COALESCE because SQLite NULL+n = NULL would poison the token
      // sums if any pass-field is missing.
      const rows = getDb()
        .prepare(
          `SELECT c.id AS id,
                  c.status AS status,
                  json_extract(c.case_package, '$.cohort') AS cohort,
                  c.created_at AS created_at,
                  (SELECT al.created_at FROM audit_log al
                    WHERE al.case_id = c.id AND al.action = 'signed_off'
                    ORDER BY al.created_at DESC LIMIT 1) AS signed_off_at,
                  COALESCE(json_extract(c.token_stats, '$.pass1In'),  0)
                + COALESCE(json_extract(c.token_stats, '$.pass2In'),  0)
                + COALESCE(json_extract(c.token_stats, '$.pass3In'),  0) AS tokens_in,
                  COALESCE(json_extract(c.token_stats, '$.pass1Out'), 0)
                + COALESCE(json_extract(c.token_stats, '$.pass2Out'), 0)
                + COALESCE(json_extract(c.token_stats, '$.pass3Out'), 0) AS tokens_out
             FROM cases c
            ORDER BY c.created_at DESC`,
        )
        .all() as CaseExportRow[];

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="cases-${todayStamp()}.json"`);
      insertAdminAuditRecord({
        actorId: req.user!.id,
        action: 'export_cases_json',
        metadata: { rowCount: rows.length },
      });
      res.json(rows);
    } catch (err) {
      logger.error(errorLogFields(err), 'admin_export_cases_failed');
      res.status(500).json({ error: 'Failed to export cases' });
    }
  });

  return router;
}
