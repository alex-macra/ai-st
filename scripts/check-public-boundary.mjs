// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This file necessarily contains every marker string it searches for, so it is
// the one file exempt from the marker scan. All other checks still apply to it.
const selfPath = path
  .relative(process.cwd(), fileURLToPath(import.meta.url))
  .split(path.sep)
  .join('/');

const allowedRoots = new Set([
  '.dockerignore',
  '.editorconfig',
  '.github',
  '.gitleaks.toml',
  '.gitignore',
  '.nvmrc',
  '.prettierignore',
  '.prettierrc',
  'ARCHITECTURE.md',
  'CHANGELOG.md',
  'CITATION.cff',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'DCO',
  'LICENSE',
  'LICENSE-COMMERCIAL.md',
  'NOTICE',
  'README.md',
  'SAFETY.md',
  'SECURITY.md',
  'THIRD_PARTY_NOTICES.md',
  'api',
  'docker-compose.yml',
  'docs',
  'e2e',
  'eslint.config.js',
  'examples',
  'frontend',
  'package-lock.json',
  'package.json',
  'playwright.config.ts',
  'preprocessor',
  'scripts',
]);

const bannedExtensions = new Set([
  '.bdf',
  '.db',
  '.duckdb',
  '.edf',
  '.p12',
  '.parquet',
  '.pdf',
  '.pfx',
  '.sqlite',
  '.sqlite3',
]);

const bannedSegments = new Set([
  '_research',
  'generated',
  'private-references',
  'reports',
  'tasks',
]);

// Dot-directories and dotfiles carry local tooling and editor state. Allow the
// few this repository publishes and reject the rest at any depth, so a new one
// never needs to be enumerated here to be caught.
const allowedDotSegments = new Set([
  '.auth',
  '.dockerignore',
  '.editorconfig',
  '.env.example',
  '.github',
  '.gitleaks.toml',
  '.gitignore',
  '.nvmrc',
  '.prettierignore',
  '.prettierrc',
]);

const allowedBinaryFiles = new Set(['docs/images/review-workspace.png']);

const privateMarkers = ['shared-core', '@shared/', 'file:../../', 'PlanForProjects'];

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
];

const allowedEmailDomains = new Set(['example.com', 'example.org', 'example.test', 'localhost']);

function publishableFiles() {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { encoding: 'buffer' },
  );
  return output
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .filter((file) => {
      try {
        lstatSync(file);
        return true;
      } catch (error) {
        if (error && typeof error === 'object' && error.code === 'ENOENT') return false;
        throw error;
      }
    })
    .sort();
}

function checkPath(file, failures) {
  const normalized = file.split(path.sep).join('/');
  const segments = normalized.split('/');
  if (!allowedRoots.has(segments[0])) failures.push(`${file}: top-level path is not allowlisted`);
  if (segments.some((segment) => bannedSegments.has(segment)))
    failures.push(`${file}: forbidden directory`);
  if (segments.some((segment) => segment.startsWith('.') && !allowedDotSegments.has(segment))) {
    failures.push(`${file}: dot-path is not allowlisted`);
  }
  if (normalized.startsWith('api/refs/'))
    failures.push(`${file}: bundled reference pack is forbidden`);
  if (normalized.startsWith('e2e/.auth/') && !normalized.endsWith('/.gitignore'))
    failures.push(`${file}: browser auth state is forbidden`);
  if (bannedExtensions.has(path.extname(normalized).toLowerCase()))
    failures.push(`${file}: forbidden artifact type`);
  if (/^(?:latest|generated[-_].*|.*[-_]report)\./i.test(path.basename(normalized)))
    failures.push(`${file}: generated report-like filename`);

  const stat = lstatSync(file);
  if (stat.isSymbolicLink()) failures.push(`${file}: symlinks are forbidden`);
  if (!stat.isFile() && !stat.isSymbolicLink()) failures.push(`${file}: non-file repository entry`);
  if (stat.size > 1_500_000) failures.push(`${file}: file exceeds the public-source size limit`);
}

function checkText(file, failures) {
  const buffer = readFileSync(file);
  if (buffer.includes(0)) {
    const normalized = file.split(path.sep).join('/');
    if (!allowedBinaryFiles.has(normalized))
      failures.push(`${file}: binary file is not allowlisted`);
    return;
  }
  const content = buffer.toString('utf8');

  if (
    /\/home\/[A-Za-z0-9._-]+\//.test(content) ||
    /\/Users\/[A-Za-z0-9._-]+\//.test(content) ||
    /[A-Za-z]:\\Users\\/.test(content)
  ) {
    failures.push(`${file}: absolute machine path`);
  }
  if (file !== selfPath) {
    for (const marker of privateMarkers) {
      if (content.toLowerCase().includes(marker.toLowerCase()))
        failures.push(`${file}: private marker detected`);
    }
  }
  for (const pattern of secretPatterns) {
    if (pattern.test(content)) failures.push(`${file}: secret-like value detected`);
  }

  const emails = content.match(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,}|localhost)/gi) ?? [];
  for (const email of emails) {
    const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
    if (!allowedEmailDomains.has(domain))
      failures.push(`${file}: non-example email address detected`);
  }
}

const files = publishableFiles();
const failures = [];
for (const file of files) {
  try {
    checkPath(file, failures);
    if (!lstatSync(file).isSymbolicLink()) checkText(file, failures);
  } catch (error) {
    failures.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length > 0) {
  console.error('Public boundary check failed:');
  for (const failure of [...new Set(failures)].sort()) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Public boundary check passed (${files.length} publishable files).`);
