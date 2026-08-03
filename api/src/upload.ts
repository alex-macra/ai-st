import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync } from 'node:fs';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { createCaseWithAudit } from './db.js';
import {
  PREPROCESSOR_URL,
  MAX_UPLOAD_BYTES,
  MAX_TOTAL_UPLOAD_BYTES,
  MAX_PDF_UPLOAD_BYTES,
  MAX_SCREENSHOT_UPLOAD_BYTES,
  MAX_CASE_PACKAGE_BYTES,
  PROMPT_VERSION,
  GPT_MODEL,
  SCREENSHOTS_DIR,
} from './constants.js';
import { logger, hashIp, errorLogFields } from './logger.js';
import { sendError } from './errors.js';
import type { AuditRecord } from './shared/types.js';

const require = createRequire(import.meta.url);
const multer = require('multer') as typeof import('multer');

const uploadDirectories = new WeakMap<Request, string>();

function requestUploadDirectory(req: Request): string {
  const existing = uploadDirectories.get(req);
  if (existing) return existing;
  const root = process.env['UPLOAD_TMP_DIR'] ?? path.join(tmpdir(), 'ai-st-uploads');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
  const directory = mkdtempSync(path.join(root, 'request-'));
  chmodSync(directory, 0o700);
  uploadDirectories.set(req, directory);
  return directory;
}

const upload = multer({
  storage: multer.diskStorage({
    destination(req, _file, callback) {
      try {
        callback(null, requestUploadDirectory(req));
      } catch (error) {
        callback(error as Error, '');
      }
    },
    filename(_req, _file, callback) {
      callback(null, randomUUID());
    },
  }),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 102,
    fields: 8,
    fieldSize: 4 * 1024,
    parts: 110,
  },
});

const metaSchema = z.object({
  cohort: z.enum(['adult', 'pediatric']).optional(),
});

const PreprocessorResponseSchema = z.object({
  schema_version: z.string(),
  edf_available: z.boolean().optional(),
  channels: z.array(z.unknown()).optional(),
  candidate_windows: z.array(z.unknown()).optional(),
});

class PreprocessorResponseLimitError extends Error {
  override name = 'PreprocessorResponseLimitError';
}

async function readBoundedJsonResponse(
  response: globalThis.Response,
): Promise<Record<string, unknown>> {
  const declaredLength = response.headers.get('content-length');
  if (
    declaredLength &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > MAX_CASE_PACKAGE_BYTES
  ) {
    await response.body?.cancel();
    throw new PreprocessorResponseLimitError();
  }
  if (!response.body) throw new SyntaxError('Response body is missing');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let body = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_CASE_PACKAGE_BYTES) {
      await reader.cancel();
      throw new PreprocessorResponseLimitError();
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  return JSON.parse(body) as Record<string, unknown>;
}

export const uploadMiddleware = upload.fields([
  { name: 'edf', maxCount: 1 },
  { name: 'pdf', maxCount: 1 },
  { name: 'screenshots', maxCount: 100 },
]);

export function enforceUploadContentLength(req: Request, res: Response, next: () => void): void {
  const raw = req.get('content-length');
  if (!raw) {
    next();
    return;
  }
  if (!/^\d+$/.test(raw)) {
    sendError(res, 400, 'INVALID_CONTENT_LENGTH', 'Invalid Content-Length header');
    return;
  }
  const length = Number(raw);
  if (!Number.isSafeInteger(length) || length > MAX_TOTAL_UPLOAD_BYTES) {
    sendError(res, 413, 'UPLOAD_TOO_LARGE', 'The combined upload exceeds the size limit');
    return;
  }
  next();
}

export async function cleanupUploadTemp(req: Request): Promise<void> {
  const directory = uploadDirectories.get(req);
  if (!directory) return;
  uploadDirectories.delete(req);
  await rm(directory, { recursive: true, force: true });
}

interface UploadState {
  screenshotDirectory?: string;
  retainScreenshots: boolean;
}

export async function handleUpload(req: Request, res: Response): Promise<void> {
  const state: UploadState = { retainScreenshots: false };
  try {
    await processUpload(req, res, state);
  } finally {
    await cleanupUploadTemp(req);
    if (state.screenshotDirectory && !state.retainScreenshots) {
      await rm(state.screenshotDirectory, { recursive: true, force: true });
    }
  }
}

async function processUpload(req: Request, res: Response, state: UploadState): Promise<void> {
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const edfFile = files?.['edf']?.[0];
  const pdfFile = files?.['pdf']?.[0];
  const screenshotFiles = files?.['screenshots'] ?? [];

  const totalBytes = [edfFile, pdfFile, ...screenshotFiles].reduce(
    (sum, file) => sum + (file?.size ?? 0),
    0,
  );
  if (totalBytes > MAX_TOTAL_UPLOAD_BYTES) {
    sendError(res, 413, 'UPLOAD_TOO_LARGE', 'The combined upload exceeds the size limit');
    return;
  }
  if ((pdfFile?.size ?? 0) > MAX_PDF_UPLOAD_BYTES) {
    sendError(res, 413, 'PDF_TOO_LARGE', 'The PDF exceeds the size limit');
    return;
  }
  if (screenshotFiles.some((file) => file.size > MAX_SCREENSHOT_UPLOAD_BYTES)) {
    sendError(res, 413, 'SCREENSHOT_TOO_LARGE', 'One or more screenshots exceed the size limit');
    return;
  }

  if (!edfFile && !pdfFile && screenshotFiles.length === 0) {
    sendError(res, 400, 'MISSING_FILES', 'Attach at least one of: EDF, PDF, or screenshots');
    return;
  }

  const signaturesValid = await validateFileSignatures(edfFile, pdfFile, screenshotFiles);
  if (!signaturesValid) {
    sendError(
      res,
      415,
      'INVALID_FILE_SIGNATURE',
      'One or more uploaded files do not match the expected format',
    );
    return;
  }

  const metaParsed = metaSchema.safeParse(req.body);
  if (!metaParsed.success) {
    sendError(res, 400, 'INVALID_METADATA', 'Invalid metadata');
    return;
  }

  // studyHash identifies the case content. Prefer EDF (the primary clinical
  // artifact); fall back to PDF, then first screenshot, so every upload has a
  // stable dedupe/audit hash even without an EDF.
  let studyHash: string;
  let hashedArtifact: 'edf' | 'pdf' | 'screenshot';
  try {
    if (edfFile) {
      studyHash = createHash('sha256')
        .update(await readFile(edfFile.path))
        .digest('hex');
      hashedArtifact = 'edf';
    } else if (pdfFile) {
      studyHash = createHash('sha256')
        .update(await readFile(pdfFile.path))
        .digest('hex');
      hashedArtifact = 'pdf';
    } else {
      const first = screenshotFiles[0];
      if (!first) throw new Error('no file to hash');
      studyHash = createHash('sha256')
        .update(await readFile(first.path))
        .digest('hex');
      hashedArtifact = 'screenshot';
    }
  } catch (err) {
    logger.error(errorLogFields(err), 'upload_hash_failed');
    sendError(res, 500, 'HASH_FAILED', 'Failed to hash uploaded file');
    return;
  }

  const prelimCaseId = randomUUID();
  let casePackage: Record<string, unknown>;
  let preprocessorVersion = 'unknown';
  const screenshotMetadata: Array<{ id: string; originalName: string }> = [];

  try {
    if (screenshotFiles.length > 0) {
      state.screenshotDirectory = path.join(SCREENSHOTS_DIR, prelimCaseId);
      await mkdir(state.screenshotDirectory, { recursive: true, mode: 0o700 });
    }

    const form = new FormData();
    if (metaParsed.data.cohort) form.append('cohort', metaParsed.data.cohort);

    if (edfFile) {
      const buf = await readFile(edfFile.path);
      form.append('edf', new Blob([buf]), 'study.edf');
    }

    if (pdfFile) {
      const pdfBuf = await readFile(pdfFile.path);
      form.append('pdf', new Blob([pdfBuf]), 'report.pdf');
    }

    for (const [index, ss] of screenshotFiles.entries()) {
      const ssBuf = await readFile(ss.path);
      const image = detectImageFormat(ssBuf);
      if (!image) throw new Error('validated screenshot signature changed during processing');
      const safeName = `screenshot-${String(index + 1).padStart(3, '0')}.${image.extension}`;
      form.append('screenshots', new Blob([ssBuf], { type: image.mimeType }), safeName);

      const screenshotId = randomUUID();
      const screenshotPath = path.join(
        SCREENSHOTS_DIR,
        prelimCaseId,
        `${screenshotId}-${safeName}`,
      );
      await writeFile(screenshotPath, ssBuf);
      screenshotMetadata.push({ id: screenshotId, originalName: safeName });
    }

    const resp = await fetch(`${PREPROCESSOR_URL}/ingest`, { method: 'POST', body: form });
    if (!resp.ok) {
      await resp.body?.cancel();
      logger.error({ status: resp.status }, 'preprocessor_ingest_failed');
      sendError(
        res,
        502,
        'PREPROCESSOR_ERROR',
        'Study preprocessing failed. Please check your file and try again.',
      );
      return;
    }
    let rawResponse: Record<string, unknown>;
    try {
      rawResponse = await readBoundedJsonResponse(resp);
    } catch (error) {
      if (error instanceof PreprocessorResponseLimitError) {
        logger.error(
          { responseLimitBytes: MAX_CASE_PACKAGE_BYTES },
          'preprocessor_response_too_large',
        );
        sendError(
          res,
          422,
          'PREPROCESSOR_RESPONSE_TOO_LARGE',
          'Study processing returned too much data. Please try again or contact support.',
        );
      } else {
        logger.error(errorLogFields(error), 'preprocessor_response_invalid_json');
        sendError(
          res,
          422,
          'PREPROCESSOR_SCHEMA_MISMATCH',
          'Study processing returned an unexpected result. Please try again or contact support.',
        );
      }
      return;
    }
    const parsed = PreprocessorResponseSchema.safeParse(rawResponse);
    if (!parsed.success) {
      logger.error(
        { issueCount: parsed.error.issues.length },
        'preprocessor_response_schema_mismatch',
      );
      sendError(
        res,
        422,
        'PREPROCESSOR_SCHEMA_MISMATCH',
        'Study processing returned an unexpected result. Please try again or contact support.',
      );
      return;
    }
    casePackage = { ...rawResponse, screenshot_metadata: screenshotMetadata };
    if (typeof casePackage['preprocessor_version'] === 'string') {
      preprocessorVersion = casePackage['preprocessor_version'];
    }
  } catch (err) {
    logger.error(errorLogFields(err), 'preprocessor_request_failed');
    sendError(
      res,
      502,
      'PREPROCESSOR_UNREACHABLE',
      'Preprocessing service is unreachable. Please try again.',
    );
    return;
  }

  const caseId = prelimCaseId;
  const now = new Date().toISOString();
  const basename = 'study';

  const userId = req.user!.id;
  const orgId = req.user!.organizationId;

  const audit: AuditRecord = {
    id: randomUUID(),
    caseId,
    action: 'case_created',
    actorId: userId,
    metadata: {
      studyHash,
      hashedArtifact,
      cohort: metaParsed.data.cohort ?? 'unknown',
      edfAttached: edfFile !== undefined,
      pdfAttached: pdfFile !== undefined,
      screenshotCount: screenshotFiles.length,
      preprocessorVersion,
      casePackageKeys: Object.keys(casePackage),
    },
    createdAt: now,
  };

  const uploadCohort: 'adult' | 'pediatric' | 'generic' =
    casePackage['cohort'] === 'pediatric'
      ? 'pediatric'
      : casePackage['cohort'] === 'generic'
        ? 'generic'
        : 'adult';

  let name: string;
  try {
    name = createCaseWithAudit(
      {
        id: caseId,
        studyHash,
        status: 'draft',
        findings: [],
        cohort: uploadCohort,
        casePackage: JSON.stringify(casePackage),
        createdBy: userId,
        ...(orgId ? { organizationId: orgId } : {}),
        preprocessorVersion,
        promptVersion: PROMPT_VERSION,
        modelVersion: GPT_MODEL,
        createdAt: now,
        updatedAt: now,
      },
      audit,
      basename,
    );
  } catch (err) {
    logger.error(errorLogFields(err), 'case_create_failed');
    sendError(res, 500, 'CASE_CREATE_FAILED', 'Could not save the study record. Please try again.');
    return;
  }

  logger.info({ caseId, ipHash: hashIp(req.ip) }, 'case_created');

  state.retainScreenshots = true;
  res.status(201).json({ caseId, studyHash, name, status: 'draft' });
}

interface ImageFormat {
  extension: 'png' | 'jpg' | 'webp';
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
}

function detectImageFormat(buffer: Buffer): ImageFormat | null {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { extension: 'png', mimeType: 'image/png' };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: 'jpg', mimeType: 'image/jpeg' };
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { extension: 'webp', mimeType: 'image/webp' };
  }
  return null;
}

async function validateFileSignatures(
  edfFile: Express.Multer.File | undefined,
  pdfFile: Express.Multer.File | undefined,
  screenshotFiles: Express.Multer.File[],
): Promise<boolean> {
  if (edfFile) {
    const buffer = await readFile(edfFile.path);
    if (buffer.length < 256 || buffer.toString('ascii', 0, 8) !== '0       ') return false;
  }
  if (pdfFile) {
    const buffer = await readFile(pdfFile.path);
    if (buffer.length < 5 || buffer.toString('ascii', 0, 5) !== '%PDF-') return false;
  }
  for (const screenshot of screenshotFiles) {
    if (!detectImageFormat(await readFile(screenshot.path))) return false;
  }
  return true;
}
