#!/usr/bin/env node
/**
 * Load & Benchmark Runner for Docmac Release Service
 * Implements Section 13.1 SLO Verification of docs/BACKEND_ARCHITECTURE.md
 *
 * Verifies:
 * - API p95 latency < 150 ms
 * - API 5xx rate < 0.5%
 * - Download redirect success > 99.9%
 *
 * Usage:
 *   node backend/scripts/load-test.mjs
 *   node backend/scripts/load-test.mjs --concurrency=20 --requests=200
 *   node backend/scripts/load-test.mjs --url=https://api.docmac.app
 */

import { performance } from 'node:perf_hooks';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleRequest } from '../src/router.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');

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

export async function runLoadTest({
  targetUrl = null,
  concurrency = 10,
  totalRequests = 100,
  fetchHandler = null,
} = {}) {
  let db = null;
  let customFetch = fetchHandler;

  // If no external URL or fetch handler provided, construct offline test environment
  if (!targetUrl && !customFetch) {
    db = new DatabaseSync(':memory:');
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

    customFetch = async (urlStr, options = {}) => {
      const parsed = new URL(urlStr, 'https://api.docmac.app');
      const req = new Request(parsed.toString(), {
        method: options.method || 'GET',
        headers: options.headers || {},
        redirect: 'manual',
      });
      return await handleRequest(req, mockEnv);
    };
  } else if (!customFetch) {
    customFetch = async (urlStr, options = {}) => {
      return await fetch(urlStr, {
        method: options.method || 'GET',
        headers: options.headers || {},
        redirect: 'manual',
      });
    };
  }

  const baseUrl = targetUrl ? targetUrl.replace(/\/+$/, '') : 'https://api.docmac.app';
  const endpoints = [
    { name: 'Health check', path: '/healthz', expect: [200] },
    { name: 'Latest release', path: '/v1/apps/docmac/releases/latest', expect: [200] },
    { name: 'Catalogue manifest', path: '/v1/apps/docmac/manifest.json', expect: [200] },
    { name: 'Checksums text', path: '/v1/apps/docmac/checksums.txt', expect: [200] },
    { name: 'Download redirect', path: '/v1/apps/docmac/download/latest', expect: [302] },
    { name: 'In-app update check', path: '/v1/apps/docmac/update?versionCode=10004', expect: [200] },
  ];

  console.log(`[load-test] Starting benchmark: ${totalRequests} requests, concurrency=${concurrency}...`);
  const t0 = performance.now();

  const latencies = [];
  let successCount = 0;
  let serverErrorCount = 0;
  let redirectSuccessCount = 0;
  let redirectTotalCount = 0;

  let requestIndex = 0;

  async function worker() {
    while (requestIndex < totalRequests) {
      const idx = requestIndex++;
      const endpoint = endpoints[idx % endpoints.length];
      const fullUrl = `${baseUrl}${endpoint.path}`;

      const reqStart = performance.now();
      try {
        const res = await customFetch(fullUrl, { redirect: 'manual' });
        const dur = performance.now() - reqStart;
        latencies.push(dur);

        if (endpoint.expect.includes(res.status)) {
          successCount++;
        }

        if (res.status >= 500) {
          serverErrorCount++;
        }

        if (endpoint.path.includes('/download/')) {
          redirectTotalCount++;
          if (res.status === 302) {
            redirectSuccessCount++;
          }
        }
      } catch (err) {
        const dur = performance.now() - reqStart;
        latencies.push(dur);
        serverErrorCount++;
      }
    }
  }

  // Launch workers up to concurrency level
  const workers = Array.from({ length: Math.min(concurrency, totalRequests) }, () => worker());
  await Promise.all(workers);

  const totalTimeSec = (performance.now() - t0) / 1000;
  latencies.sort((a, b) => a - b);

  const p50 = latencies[Math.floor(latencies.length * 0.50)] || 0;
  const p90 = latencies[Math.floor(latencies.length * 0.90)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;
  const min = latencies[0] || 0;
  const max = latencies[latencies.length - 1] || 0;

  const rps = totalRequests / totalTimeSec;
  const serverErrorRatePct = (serverErrorCount / totalRequests) * 100;
  const redirectSuccessPct = redirectTotalCount > 0 ? (redirectSuccessCount / redirectTotalCount) * 100 : 100;

  const sloChecks = {
    p95LatencyPassed: p95 < 150, // Target: < 150ms
    serverErrorRatePassed: serverErrorRatePct < 0.5, // Target: < 0.5%
    redirectSuccessPassed: redirectSuccessPct >= 99.9, // Target: > 99.9%
  };

  const allSlosMet = sloChecks.p95LatencyPassed && sloChecks.serverErrorRatePassed && sloChecks.redirectSuccessPassed;

  if (db) {
    db.close();
  }

  const results = {
    totalRequests,
    concurrency,
    durationSeconds: Number(totalTimeSec.toFixed(3)),
    requestsPerSecond: Number(rps.toFixed(1)),
    successCount,
    serverErrorCount,
    latencies: {
      minMs: Number(min.toFixed(2)),
      p50Ms: Number(p50.toFixed(2)),
      p90Ms: Number(p90.toFixed(2)),
      p95Ms: Number(p95.toFixed(2)),
      p99Ms: Number(p99.toFixed(2)),
      maxMs: Number(max.toFixed(2)),
    },
    metrics: {
      serverErrorRatePct: Number(serverErrorRatePct.toFixed(2)),
      redirectSuccessPct: Number(redirectSuccessPct.toFixed(2)),
    },
    slos: {
      targets: {
        p95Latency: '< 150 ms',
        serverErrorRate: '< 0.5%',
        redirectSuccessRate: '> 99.9%',
      },
      ...sloChecks,
      allPassed: allSlosMet,
    },
  };

  return results;
}

if (process.argv[1] && process.argv[1].endsWith('load-test.mjs')) {
  const args = process.argv.slice(2);
  const getArg = (name, fallback) => {
    const found = args.find((a) => a.startsWith(`--${name}=`));
    return found ? found.split('=')[1] : fallback;
  };

  const concurrency = parseInt(getArg('concurrency', '10'), 10);
  const requests = parseInt(getArg('requests', '100'), 10);
  const url = getArg('url', null);

  runLoadTest({ targetUrl: url, concurrency, totalRequests: requests })
    .then((results) => {
      console.log('\n--- Load Test Summary ---');
      console.log(`Requests: ${results.totalRequests} | Concurrency: ${results.concurrency} | Duration: ${results.durationSeconds}s`);
      console.log(`Throughput: ${results.requestsPerSecond} req/sec`);
      console.log(`Latencies: Min=${results.latencies.minMs}ms | p50=${results.latencies.p50Ms}ms | p95=${results.latencies.p95Ms}ms | p99=${results.latencies.p99Ms}ms | Max=${results.latencies.maxMs}ms`);
      console.log(`5xx Error Rate: ${results.metrics.serverErrorRatePct}% (SLO: < 0.5%)`);
      console.log(`Redirect Success: ${results.metrics.redirectSuccessPct}% (SLO: > 99.9%)`);
      console.log(`All SLOs Passed: ${results.slos.allPassed ? 'YES' : 'NO'}`);
      if (!results.slos.allPassed) {
        process.exitCode = 1;
      }
    })
    .catch((err) => {
      console.error('[load-test] Failed:', err);
      process.exit(1);
    });
}
