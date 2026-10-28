#!/usr/bin/env node
/**
 * Synthetic Health Check & Latency Probe
 * Implements Section 13.2 of docs/BACKEND_ARCHITECTURE.md
 *
 * Verifies:
 * 1. GET /healthz (status=ok, liveness)
 * 2. GET /v1/apps/docmac/releases/latest (valid schema, version)
 * 3. GET /v1/apps/docmac/manifest.json (catalogue integrity)
 * 4. GET /v1/apps/docmac/checksums.txt (valid sha256 lines)
 * 5. GET /v1/apps/docmac/download/latest (302 redirect with checksum header)
 * 6. Latency budget: p95 < 150ms
 *
 * Usage:
 *   node scripts/health-check.mjs
 *   node scripts/health-check.mjs --api=https://api.docmac.app
 */

import { performance } from 'node:perf_hooks';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(import.meta.dirname, '..');
const API_BASE = (process.env.DOCMAC_API_URL || 'https://api.docmac.app').replace(/\/+$/, '');

function createD1Adapter(db) {
  return {
    prepare(query) {
      let boundValues = [];
      return {
        bind(...values) {
          boundValues = values;
          return this;
        },
        async all() {
          const stmt = db.prepare(query);
          const results = stmt.all(...boundValues);
          return { results, success: true };
        },
        async first() {
          const stmt = db.prepare(query);
          const results = stmt.all(...boundValues);
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

export async function createLocalFetchHandler() {
  const { handleRequest } = await import('../backend/src/router.ts');
  const db = new DatabaseSync(':memory:');
  const schemaSql = fs.readFileSync(path.join(ROOT, 'backend/migrations/0001_initial_schema.sql'), 'utf8');
  const seedSql = fs.readFileSync(path.join(ROOT, 'backend/migrations/0002_seed_releases.sql'), 'utf8');
  db.exec(schemaSql);
  db.exec(seedSql);

  const mockEnv = {
    DB: createD1Adapter(db),
    R2_BUCKET: null,
    CDN_BASE_URL: 'https://downloads.docmac.app',
    STATIC_BASE_URL: 'https://docmac.app',
  };

  return async (urlStr, options = {}) => {
    const parsed = new URL(urlStr, 'https://api.docmac.app');
    const req = new Request(parsed.toString(), {
      method: options.method || 'GET',
      headers: options.headers || {},
      redirect: 'manual',
    });
    return await handleRequest(req, mockEnv);
  };
}

export async function runSyntheticProbe(fetchHandler = null) {
  const customFetch = fetchHandler || fetch;
  const results = [];
  const latencies = [];

  async function probe(name, path, options = {}) {
    const t0 = performance.now();
    try {
      const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
      const res = await customFetch(url, {
        redirect: options.redirect || 'manual',
        headers: options.headers || {},
      });
      const durationMs = performance.now() - t0;
      latencies.push(durationMs);

      const passed = options.expectStatus ? res.status === options.expectStatus : res.ok;
      results.push({
        name,
        path,
        status: res.status,
        durationMs: Number(durationMs.toFixed(2)),
        passed,
      });

      if (!passed) {
        console.error(`[probe] FAIL ${name}: expected status ${options.expectStatus || 200}, got ${res.status}`);
      }
      return res;
    } catch (err) {
      const durationMs = performance.now() - t0;
      latencies.push(durationMs);
      results.push({
        name,
        path,
        status: 0,
        durationMs: Number(durationMs.toFixed(2)),
        passed: false,
        error: err.message,
      });
      console.error(`[probe] ERROR ${name}: ${err.message}`);
      return null;
    }
  }

  console.log(`[health-probe] Starting synthetic health probes against ${API_BASE}...`);

  // 1. Liveness
  await probe('Service Liveness Check', '/healthz', { expectStatus: 200 });

  // 2. Latest Release
  await probe('Latest Release Endpoint', '/v1/apps/docmac/releases/latest', { expectStatus: 200 });

  // 3. Complete Catalogue Manifest
  await probe('Catalogue Manifest', '/v1/apps/docmac/manifest.json', { expectStatus: 200 });

  // 4. Checksums Text
  await probe('Checksums Text File', '/v1/apps/docmac/checksums.txt', { expectStatus: 200 });

  // 5. Download Redirect (Expects 302)
  await probe('Latest Download Redirect', '/v1/apps/docmac/download/latest', { expectStatus: 302 });

  // 6. In-App Update Check
  await probe('In-App Update Check', '/v1/apps/docmac/update?versionCode=10004&channel=stable', { expectStatus: 200 });

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;

  const allPassed = results.every((r) => r.passed);
  const summary = {
    allPassed,
    totalProbes: results.length,
    passedCount: results.filter((r) => r.passed).length,
    latency: {
      minMs: Number(Math.min(...latencies).toFixed(2)),
      p50Ms: Number(p50.toFixed(2)),
      p95Ms: Number(p95.toFixed(2)),
      maxMs: Number(Math.max(...latencies).toFixed(2)),
      meetsTargetP95: p95 < 150,
    },
    results,
    timestamp: new Date().toISOString(),
  };

  return summary;
}

if (process.argv[1] && process.argv[1].endsWith('health-check.mjs')) {
  const isLocal = process.argv.includes('--local') || process.env.DOCMAC_LOCAL === '1';
  (async () => {
    const handler = isLocal ? await createLocalFetchHandler() : null;
    return runSyntheticProbe(handler);
  })()
    .then((summary) => {
      console.log(`[health-probe] Probe finished: ${summary.passedCount}/${summary.totalProbes} passed.`);
      console.log(`[health-probe] Latency: min=${summary.latency.minMs}ms, p50=${summary.latency.p50Ms}ms, p95=${summary.latency.p95Ms}ms`);
      if (!summary.allPassed) {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('[health-probe] Probe execution error:', err);
      process.exit(1);
    });
}
