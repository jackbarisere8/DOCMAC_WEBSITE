/**
 * Test Suite for Docmac Phase 4 — Security Hardening, Backups, Monitoring & Recovery
 * Execute: node --test backend/tests/phase4.test.ts
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { handleRequest } from '../src/router.ts';
import type { Env, D1DatabaseLike } from '../src/types.ts';
import { createDatabaseBackup } from '../scripts/backup-d1.mjs';
import { runRestoreDrill } from '../scripts/restore-d1.mjs';
import { runSyntheticProbe, createLocalFetchHandler } from '../../scripts/health-check.mjs';
import { runLoadTest } from '../scripts/load-test.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');

function createD1Adapter(db: DatabaseSync): D1DatabaseLike {
  return {
    prepare(query: string) {
      let boundValues: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          boundValues = values;
          return this;
        },
        async all<T = unknown>() {
          const stmt = db.prepare(query);
          const results = stmt.all(...boundValues) as T[];
          return { results, success: true };
        },
        async first<T = unknown>() {
          const stmt = db.prepare(query);
          const results = stmt.all(...boundValues) as T[];
          return results[0] ?? null;
        },
        async run() {
          const stmt = db.prepare(query);
          stmt.run(...boundValues);
          return { success: true };
        },
      };
    },
  };
}

describe('Docmac Phase 4 — Security Hardening, Backups, Monitoring & Recovery', () => {
  let db: DatabaseSync;
  let env: Env;

  before(() => {
    db = new DatabaseSync(':memory:');
    const schemaSql = fs.readFileSync(path.join(ROOT, 'backend/migrations/0001_initial_schema.sql'), 'utf8');
    const seedSql = fs.readFileSync(path.join(ROOT, 'backend/migrations/0002_seed_releases.sql'), 'utf8');

    db.exec(schemaSql);
    db.exec(seedSql);

    env = {
      DB: createD1Adapter(db),
      R2_BUCKET: null,
      CDN_BASE_URL: 'https://downloads.docmac.app',
      STATIC_BASE_URL: 'https://docmac.app',
    };
  });

  test('Security Hardening: API responses include RFC-compliant security headers', async () => {
    const endpoints = [
      '/healthz',
      '/v1/apps/docmac/releases/latest',
      '/v1/apps/docmac/manifest.json',
      '/v1/apps/docmac/checksums.txt',
      '/v1/apps/docmac/download/latest',
      '/v1/apps/docmac/update?versionCode=10004',
    ];

    for (const ep of endpoints) {
      const req = new Request(`https://api.docmac.app${ep}`, {
        headers: { 'X-Docmac-Test': 'true' },
        redirect: 'manual',
      });
      const res = await handleRequest(req, env);

      // Verify mandatory security headers (Section 11)
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff', `Missing nosniff on ${ep}`);
      assert.equal(res.headers.get('x-frame-options'), 'DENY', `Missing X-Frame-Options on ${ep}`);
      assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin', `Missing Referrer-Policy on ${ep}`);
      assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin', `Missing COOP on ${ep}`);
      assert.match(res.headers.get('strict-transport-security') || '', /max-age=31536000/, `Missing HSTS on ${ep}`);
      assert.ok(res.headers.get('x-request-id'), `Missing X-Request-Id on ${ep}`);
    }
  });

  test('Security Hardening: Static _headers file defines strict CSP and cache policies', () => {
    const headersPath = path.join(ROOT, '_headers');
    assert.ok(fs.existsSync(headersPath), '_headers file must exist');

    const content = fs.readFileSync(headersPath, 'utf8');
    assert.match(content, /Strict-Transport-Security:\s*max-age=31536000/);
    assert.match(content, /X-Content-Type-Options:\s*nosniff/);
    assert.match(content, /X-Frame-Options:\s*DENY/);
    assert.match(content, /Content-Security-Policy:/);
    assert.match(content, /frame-ancestors 'none'/);
  });

  test('Backup Engine: createDatabaseBackup dumps all 8 tables with verifiable SHA-256', async () => {
    const { backupPath, stats } = await createDatabaseBackup(db);

    assert.ok(fs.existsSync(backupPath), `Backup file ${backupPath} must exist`);
    assert.ok(fs.existsSync(`${backupPath}.meta.json`), 'Metadata file must exist');

    // Verify metadata
    const meta = JSON.parse(fs.readFileSync(`${backupPath}.meta.json`, 'utf8'));
    assert.equal(meta.tablesCount, 8, 'Must backup all 8 database tables');
    assert.ok(meta.totalRows >= 17, 'Must backup seeded rows across all tables');
    assert.equal(meta.sha256, stats.sha256, 'Metadata SHA-256 must match returned stats');

    // Verify file content matches SHA-256
    const fileBytes = fs.readFileSync(backupPath);
    const calculatedHash = crypto.createHash('sha256').update(fileBytes).digest('hex').toUpperCase();
    assert.equal(calculatedHash, stats.sha256, 'File content SHA-256 must match');

    // Verify SQL transactional envelope
    const sqlText = fileBytes.toString('utf8');
    assert.ok(sqlText.includes('BEGIN TRANSACTION;'), 'Backup must wrap operations in a transaction');
    assert.ok(sqlText.includes('INSERT OR REPLACE INTO releases'), 'Backup must contain release table records');
    assert.ok(sqlText.includes('COMMIT;'), 'Backup must commit transaction');
  });

  test('Disaster Recovery: runRestoreDrill successfully verifies and restores clean database (RTO < 1h)', async () => {
    const report = await runRestoreDrill();

    assert.equal(report.passed, true, 'Restore drill must pass');
    assert.ok(report.restored.appsCount >= 1, 'Must restore apps');
    assert.ok(report.restored.releasesCount >= 5, 'Must restore all 5 releases');
    assert.equal(report.restored.activeCurrentCount, 1, 'Must have exactly 1 active current release');
    assert.equal(report.restored.latestVersion, '1.0.4', 'Latest version must be 1.0.4');
    assert.equal(report.restored.latestVersionCode, 10004, 'Latest version code must be 10004');
    assert.ok(report.durationMs < 60000, 'RTO must execute well within budget (< 60s for local drill)');
  });

  test('Synthetic Health Monitoring: runSyntheticProbe verifies all edge endpoints & p95 latency budget', async () => {
    const localFetch = await createLocalFetchHandler();
    const probeSummary = await runSyntheticProbe(localFetch);

    assert.equal(probeSummary.allPassed, true, 'All synthetic health probes must pass');
    assert.equal(probeSummary.totalProbes, 6, 'Must probe 6 critical endpoints');
    assert.equal(probeSummary.passedCount, 6, 'All 6 probes must pass');
    assert.equal(probeSummary.latency.meetsTargetP95, true, 'p95 latency must meet < 150ms budget');
  });

  test('Load Testing & Benchmarking: runLoadTest satisfies latency and reliability SLOs', async () => {
    const results = await runLoadTest({ concurrency: 10, totalRequests: 50 });

    assert.equal(results.slos.allPassed, true, 'All SLO targets must be satisfied');
    assert.equal(results.slos.serverErrorRatePassed, true, '5xx error rate must be < 0.5%');
    assert.equal(results.slos.redirectSuccessPassed, true, 'Redirect success must be >= 99.9%');
    assert.equal(results.slos.p95LatencyPassed, true, 'p95 latency must be < 150ms');
    assert.ok(results.requestsPerSecond > 50, 'Throughput must exceed 50 req/sec');
  });

  test('Operational Runbooks: docs/RUNBOOKS.md covers all 5 required operational scenarios', () => {
    const runbooksPath = path.join(ROOT, 'docs/RUNBOOKS.md');
    assert.ok(fs.existsSync(runbooksPath), 'docs/RUNBOOKS.md must exist');

    const content = fs.readFileSync(runbooksPath, 'utf8');

    // 1. Bad release published
    assert.match(content, /Bad or Malfunctioning Release Published/, 'Must cover bad release procedure');
    assert.match(content, /yank/, 'Must include yank instructions');

    // 2. Signing key compromise
    assert.match(content, /Signing Key \/ Certificate Compromise/, 'Must cover key compromise');
    assert.match(content, /signing_certs/, 'Must include certificate revocation');

    // 3. Storage / R2 outage
    assert.match(content, /Cloudflare R2 \/ Storage Provider Outage/, 'Must cover storage outage');
    assert.match(content, /GitHub Releases/, 'Must include mirror failover instructions');

    // 4. Database loss
    assert.match(content, /Database Loss \/ D1 Catastrophic Corruption/, 'Must cover database loss');
    assert.match(content, /time-travel|restore-d1\.mjs/, 'Must include restore procedures');

    // 5. Abuse spike / DDoS
    assert.match(content, /Traffic Spike, Abuse, or Distributed Denial of Service/, 'Must cover abuse mitigation');
    assert.match(content, /WAF|rate limiting/i, 'Must include WAF rate limiting instructions');

    // Post-incident review template
    assert.match(content, /Post-Incident Review \(PIR\) Template/, 'Must include PIR template');
  });
});
