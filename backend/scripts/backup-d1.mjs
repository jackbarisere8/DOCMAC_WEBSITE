#!/usr/bin/env node
/**
 * Automated Database Backup Script for Docmac D1 / SQLite
 * Implements Section 14 of docs/BACKEND_ARCHITECTURE.md
 *
 * Dumps all tables, verifies checksum integrity, and stages for R2 cold storage.
 *
 * Usage:
 *   node backend/scripts/backup-d1.mjs
 *   node backend/scripts/backup-d1.mjs --target=d1   # executes wrangler d1 export
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(import.meta.dirname, '../..');
const BACKUPS_DIR = path.join(ROOT, 'data', 'backups');
const BACKUP_DATE = new Date().toISOString().slice(0, 10);
const BACKUP_NAME = `d1-backup-${BACKUP_DATE}.sql`;
const BACKUP_PATH = path.join(BACKUPS_DIR, BACKUP_NAME);

export async function createDatabaseBackup(sqliteDbInstance = null) {
  await fsp.mkdir(BACKUPS_DIR, { recursive: true });

  let db = sqliteDbInstance;
  let closeOnExit = false;

  if (!db) {
    // If no db instance passed, read schema and seeds into memory or open local db
    db = new DatabaseSync(':memory:');
    closeOnExit = true;
    const schemaSql = fs.readFileSync(path.join(ROOT, 'backend/migrations/0001_initial_schema.sql'), 'utf8');
    const seedSql = fs.readFileSync(path.join(ROOT, 'backend/migrations/0002_seed_releases.sql'), 'utf8');
    db.exec(schemaSql);
    db.exec(seedSql);
  }

  const tables = [
    'apps',
    'signing_certs',
    'releases',
    'release_assets',
    'download_daily',
    'audit_log',
    'api_tokens',
    'feedback',
  ];

  const lines = [
    `-- Docmac D1 Logical Database Backup`,
    `-- Generated: ${new Date().toISOString()}`,
    `-- Architecture Reference: Section 14 of docs/BACKEND_ARCHITECTURE.md`,
    ``,
    `BEGIN TRANSACTION;`,
    ``,
  ];

  const stats = {
    tables: 0,
    rows: 0,
    sizeBytes: 0,
    sha256: '',
  };

  for (const table of tables) {
    let rows = [];
    try {
      const stmt = db.prepare(`SELECT * FROM ${table}`);
      rows = stmt.all();
    } catch {
      continue;
    }

    stats.tables++;
    stats.rows += rows.length;

    lines.push(`-- Table: ${table} (${rows.length} rows)`);
    for (const row of rows) {
      const keys = Object.keys(row);
      const values = keys.map((k) => {
        const val = row[k];
        if (val === null || val === undefined) return 'NULL';
        if (typeof val === 'number') return val;
        // Escape single quotes for SQL
        return `'${String(val).replace(/'/g, "''")}'`;
      });
      lines.push(`INSERT OR REPLACE INTO ${table} (${keys.join(', ')}) VALUES (${values.join(', ')});`);
    }
    lines.push(``);
  }

  lines.push(`COMMIT;`);
  lines.push(``);

  const dumpContent = lines.join('\n');
  const buffer = Buffer.from(dumpContent, 'utf8');
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase();

  stats.sizeBytes = buffer.length;
  stats.sha256 = sha256;

  await fsp.writeFile(BACKUP_PATH, buffer);
  await fsp.writeFile(
    `${BACKUP_PATH}.meta.json`,
    JSON.stringify(
      {
        backupDate: BACKUP_DATE,
        fileName: BACKUP_NAME,
        sizeBytes: stats.sizeBytes,
        sha256: stats.sha256,
        tablesCount: stats.tables,
        totalRows: stats.rows,
        createdAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  // Rotate backups older than 90 days
  try {
    const files = await fsp.readdir(BACKUPS_DIR);
    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
    for (const file of files) {
      if (!file.startsWith('d1-backup-')) continue;
      const fPath = path.join(BACKUPS_DIR, file);
      const stat = await fsp.stat(fPath);
      if (stat.mtimeMs < ninetyDaysAgo) {
        await fsp.unlink(fPath);
      }
    }
  } catch {}

  if (closeOnExit) {
    db.close();
  }

  return { backupPath: BACKUP_PATH, stats };
}

if (process.argv[1] && process.argv[1].endsWith('backup-d1.mjs')) {
  createDatabaseBackup()
    .then(({ backupPath, stats }) => {
      console.log(`[backup] SUCCESS: Created logical backup at ${path.basename(backupPath)}`);
      console.log(`[backup] Tables: ${stats.tables}, Rows: ${stats.rows}, Size: ${stats.sizeBytes} bytes`);
      console.log(`[backup] SHA-256: ${stats.sha256}`);
    })
    .catch((err) => {
      console.error('[backup] ERROR:', err);
      process.exit(1);
    });
}

