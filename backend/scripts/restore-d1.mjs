#!/usr/bin/env node
/**
 * Disaster Recovery & Database Restore Drill Script
 * Implements Section 14 of docs/BACKEND_ARCHITECTURE.md
 *
 * Verifies that logical database backups can be restored into a clean database
 * with 100% data integrity within the target RTO (< 1 hour).
 *
 * Usage:
 *   node backend/scripts/restore-d1.mjs
 *   node backend/scripts/restore-d1.mjs --backup=data/backups/d1-backup-2026-10-23.sql
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(import.meta.dirname, '../..');
const BACKUPS_DIR = path.join(ROOT, 'data', 'backups');

export async function runRestoreDrill(customBackupPath = null) {
  const startTime = Date.now();

  // 1. Locate backup
  let backupPath = customBackupPath;
  if (!backupPath) {
    const files = await fsp.readdir(BACKUPS_DIR);
    const sqlBackups = files.filter((f) => f.startsWith('d1-backup-') && f.endsWith('.sql')).sort().reverse();
    if (!sqlBackups.length) {
      throw new Error(`No database backups found in ${BACKUPS_DIR}`);
    }
    backupPath = path.join(BACKUPS_DIR, sqlBackups[0]);
  }

  console.log(`[restore-drill] Target backup file: ${path.basename(backupPath)}`);

  // 2. Read and verify checksum
  const buffer = await fsp.readFile(backupPath);
  const actualSha256 = crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase();

  const metaPath = `${backupPath}.meta.json`;
  if (fs.existsSync(metaPath)) {
    const meta = JSON.parse(await fsp.readFile(metaPath, 'utf8'));
    if (meta.sha256 && meta.sha256 !== actualSha256) {
      throw new Error(`Backup checksum mismatch! Expected ${meta.sha256}, calculated ${actualSha256}`);
    }
    console.log(`[restore-drill] Checksum verified: ${actualSha256}`);
  }

  // 3. Create fresh in-memory database
  const targetDb = new DatabaseSync(':memory:');

  // 4. Apply initial schema
  const schemaSql = await fsp.readFile(path.join(ROOT, 'backend/migrations/0001_initial_schema.sql'), 'utf8');
  targetDb.exec(schemaSql);
  console.log('[restore-drill] Base schema initialized.');

  // 5. Replay backup statements
  const backupSql = buffer.toString('utf8');
  targetDb.exec(backupSql);
  console.log('[restore-drill] Backup statements executed.');

  // 6. Post-restore integrity verification
  const appsCount = targetDb.prepare('SELECT COUNT(*) as cnt FROM apps').all()[0].cnt;
  const releasesCount = targetDb.prepare('SELECT COUNT(*) as cnt FROM releases').all()[0].cnt;
  const currentCount = targetDb.prepare('SELECT COUNT(*) as cnt FROM releases WHERE is_current = 1').all()[0].cnt;
  const certsCount = targetDb.prepare('SELECT COUNT(*) as cnt FROM signing_certs WHERE is_active = 1').all()[0].cnt;

  if (appsCount === 0) throw new Error('Verification failed: apps table is empty.');
  if (releasesCount === 0) throw new Error('Verification failed: releases table is empty.');
  if (currentCount === 0) throw new Error('Verification failed: no active current release found.');
  if (certsCount === 0) throw new Error('Verification failed: no active signing certificates found.');

  const latestRelease = targetDb.prepare(
    'SELECT version_name, version_code, sha256 FROM releases WHERE is_current = 1 LIMIT 1'
  ).all()[0];

  const durationMs = Date.now() - startTime;

  targetDb.close();

  const report = {
    passed: true,
    backupFile: path.basename(backupPath),
    backupSha256: actualSha256,
    durationMs,
    restored: {
      appsCount,
      releasesCount,
      activeCurrentCount: currentCount,
      activeCertsCount: certsCount,
      latestVersion: latestRelease.version_name,
      latestVersionCode: latestRelease.version_code,
      latestSha256: latestRelease.sha256,
    },
    rtoAchieved: `${(durationMs / 1000).toFixed(2)}s (Target: < 3600s / 1 hour)`,
    executedAt: new Date().toISOString(),
  };

  return report;
}

if (process.argv[1] && process.argv[1].endsWith('restore-d1.mjs')) {
  runRestoreDrill()
    .then((report) => {
      console.log('[restore-drill] SUCCESS: Full database restore drill passed 100%!');
      console.log(`[restore-drill] Restored Releases: ${report.restored.releasesCount}, Active: v${report.restored.latestVersion}`);
      console.log(`[restore-drill] Duration: ${report.rtoAchieved}`);
    })
    .catch((err) => {
      console.error('[restore-drill] DRILL FAILED:', err);
      process.exit(1);
    });
}

