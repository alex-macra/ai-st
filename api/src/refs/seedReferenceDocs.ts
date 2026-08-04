// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseRulesMarkdown, type ParsedRulesFile } from './parseRulesMarkdown.js';
import { clearReferencePackDocs, replaceReferencePackDocs } from '../db.js';
import { logger } from '../logger.js';

const MAX_REFERENCE_FILE_BYTES = 256 * 1024;
const MAX_REFERENCE_FILES = 100;
const MAX_REFERENCE_RULES = 1_000;

export interface ReferenceStatus {
  enabled: boolean;
  filesLoaded: number;
  rulesLoaded: number;
}

let status: ReferenceStatus = { enabled: false, filesLoaded: 0, rulesLoaded: 0 };
let activeReferenceIds = new Set<string>();

export function getReferenceStatus(): ReferenceStatus {
  return { ...status };
}

export function isReferenceRuleActive(id: string): boolean {
  return activeReferenceIds.has(id);
}

interface ValidatedReferenceFile {
  parsed: ParsedRulesFile;
}

function validateReferenceDirectory(refsDir: string): ValidatedReferenceFile[] {
  const directory = lstatSync(refsDir);
  if (directory.isSymbolicLink() || !directory.isDirectory()) {
    throw new Error('REFERENCE_DIR must be a real directory, not a symlink');
  }

  const files = readdirSync(refsDir, { withFileTypes: true });
  const markdownFiles = files.filter((entry) => entry.name.endsWith('.md'));
  if (markdownFiles.length === 0) throw new Error('REFERENCE_DIR contains no Markdown files');
  if (markdownFiles.length > MAX_REFERENCE_FILES) {
    throw new Error(`REFERENCE_DIR exceeds the ${MAX_REFERENCE_FILES}-file limit`);
  }

  const knownIds = new Set<string>();
  let ruleCount = 0;
  return markdownFiles.map((entry) => {
    const filePath = join(refsDir, entry.name);
    const file = lstatSync(filePath);
    if (entry.isSymbolicLink() || file.isSymbolicLink() || !file.isFile()) {
      throw new Error('REFERENCE_DIR Markdown entries must be direct regular files');
    }
    if (file.size > MAX_REFERENCE_FILE_BYTES) {
      throw new Error(`Reference Markdown exceeds ${MAX_REFERENCE_FILE_BYTES} bytes`);
    }
    const parsed = parseRulesMarkdown(readFileSync(filePath, 'utf8'));
    ruleCount += parsed.rules.length;
    if (ruleCount > MAX_REFERENCE_RULES) {
      throw new Error(`REFERENCE_DIR exceeds the ${MAX_REFERENCE_RULES}-rule limit`);
    }
    for (const rule of parsed.rules) {
      const id = `${parsed.sourceRefId}:${rule.id}`;
      if (knownIds.has(id)) throw new Error(`Duplicate reference id: ${id}`);
      knownIds.add(id);
    }
    return { parsed };
  });
}

export function seedReferenceDocs(refsDir = process.env['REFERENCE_DIR']): ReferenceStatus {
  if (!refsDir) {
    clearReferencePackDocs();
    status = { enabled: false, filesLoaded: 0, rulesLoaded: 0 };
    activeReferenceIds = new Set();
    logger.warn('reference_pack_unavailable');
    return getReferenceStatus();
  }

  status = { enabled: false, filesLoaded: 0, rulesLoaded: 0 };
  activeReferenceIds = new Set();
  clearReferencePackDocs();
  const files = validateReferenceDirectory(refsDir);
  const now = new Date().toISOString();
  const docs = files.flatMap(({ parsed }) =>
    parsed.rules.map((rule) => ({
      id: `${parsed.sourceRefId}:${rule.id}`,
      title: parsed.sourceTitle,
      content: JSON.stringify(rule),
      cohort: parsed.cohort,
      type: parsed.type,
      license: parsed.license,
      createdAt: now,
    })),
  );

  replaceReferencePackDocs(docs);

  activeReferenceIds = new Set(docs.map((doc) => doc.id));
  status = { enabled: true, filesLoaded: files.length, rulesLoaded: docs.length };
  logger.info(status, 'reference_docs_seeded');
  return getReferenceStatus();
}
