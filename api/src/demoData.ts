// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { lstat, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { CHARTS_DIR, SCREENSHOTS_DIR, SLICES_DIR } from './constants.js';
import { purgeDemoUsers } from './db.js';
import { publicDemoModeEnabled } from './llm.js';
import { logger, errorLogFields } from './logger.js';

export interface DemoArtifactRoots {
  charts: string;
  screenshots: string;
  slices: string;
}

export interface DemoArtifactTargets {
  caseIds: readonly string[];
  orphanedStudyHashes: readonly string[];
}

const defaultArtifactRoots: DemoArtifactRoots = {
  charts: CHARTS_DIR,
  screenshots: SCREENSHOTS_DIR,
  slices: SLICES_DIR,
};

function pathWithin(rootPath: string, childName: string): string | null {
  const root = path.resolve(rootPath);
  const child = path.resolve(root, childName);
  const relative = path.relative(root, child);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return null;
  }
  return child;
}

async function rootIsDirectory(rootPath: string): Promise<boolean> {
  try {
    const stat = await lstat(path.resolve(rootPath));
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

async function removeFile(rootPath: string, fileName: string): Promise<void> {
  if (!(await rootIsDirectory(rootPath))) return;
  const target = pathWithin(rootPath, fileName);
  if (!target) return;
  const stat = await lstat(target).catch(() => undefined);
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) return;
  await rm(target, { force: true });
}

async function removeDirectory(rootPath: string, directoryName: string): Promise<void> {
  if (!(await rootIsDirectory(rootPath))) return;
  const target = pathWithin(rootPath, directoryName);
  if (!target) return;
  const stat = await lstat(target).catch(() => undefined);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) return;
  await rm(target, { recursive: true, force: true });
}

export async function purgeDemoArtifacts(
  targets: DemoArtifactTargets,
  roots: DemoArtifactRoots = defaultArtifactRoots,
): Promise<number> {
  const removals: Array<Promise<void>> = [];
  for (const caseId of targets.caseIds) {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(caseId)) {
      removals.push(removeDirectory(roots.screenshots, caseId));
    }
  }
  for (const studyHash of targets.orphanedStudyHashes) {
    if (!/^[a-f0-9]{64}$/.test(studyHash)) continue;
    removals.push(removeFile(roots.slices, `${studyHash}.json`));
    if (await rootIsDirectory(roots.charts)) {
      const entries = await readdir(roots.charts, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && !entry.isSymbolicLink() && entry.name.startsWith(`${studyHash}_`)) {
          removals.push(removeFile(roots.charts, entry.name));
        }
      }
    }
  }
  const results = await Promise.allSettled(removals);
  return results.filter((result) => result.status === 'rejected').length;
}

async function purgeDemoData(includeActive: boolean): Promise<void> {
  const targets = purgeDemoUsers(new Date().toISOString(), includeActive);
  const artifactFailures = await purgeDemoArtifacts(targets);
  if (artifactFailures > 0) {
    logger.warn(
      { artifactFailures, deletedUsers: targets.deletedUsers },
      'demo_artifact_purge_failed',
    );
  }
}

export async function purgeExpiredDemoData(): Promise<void> {
  await purgeDemoData(false);
}

export async function purgeDemoDataForCurrentMode(): Promise<void> {
  try {
    await purgeDemoData(!publicDemoModeEnabled());
  } catch (err) {
    logger.warn(errorLogFields(err), 'demo_data_purge_failed');
  }
}
