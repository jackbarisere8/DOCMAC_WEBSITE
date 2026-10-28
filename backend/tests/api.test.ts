/**
 * Test Suite for Docmac Release API Worker
 * Runs against in-memory SQLite using Node.js built-in node:sqlite
 * Execute: node --test backend/tests/api.test.ts
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

import { handleRequest } from '../src/router.ts';
import type { Env, D1DatabaseLike, D1PreparedStatementLike } from '../src/types.ts';

function createD1Adapter(db: DatabaseSync): D1DatabaseLike {
  return {
    prepare(query: string): D1PreparedStatementLike {
      return {
        bind(...values: unknown[]) {
          return this;
        },
        async all<T = unknown>() {
          const stmt = db.prepare(query);
          const results = stmt.all(...arguments) as T[];
          return { results, success: true };
        },
        async first<T = unknown>() {
          const stmt = db.prepare(query);
          const results = stmt.all(...arguments) as T[];
          return results[0] ?? null;
        },
        async run() {
          const stmt = db.prepare(query);
          stmt.run(...arguments);
          return { success: true };
        },
      };
    },
  };
}

describe('Docmac Release Service API', () => {
  let db: DatabaseSync;
  let env: Env;

  before(() => {
    db = new DatabaseSync(':memory:');
    const root = path.resolve(import.meta.dirname, '../..');
    const schemaSql = fs.readFileSync(path.join(root, 'backend/migrations/0001_initial_schema.sql'), 'utf8');
    const seedSql = fs.readFileSync(path.join(root, 'backend/migrations/0002_seed_releases.sql'), 'utf8');

    db.exec(schemaSql);
    db.exec(seedSql);

    // Dynamic prepare with bind support
    const d1: D1DatabaseLike = {
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

    env = {
      DB: d1,
      ENVIRONMENT: 'test',
      APP_SLUG: 'docmac',
      CDN_BASE_URL: 'https://downloads.docmac.app',
    };
  });

  test('GET /healthz returns 200 and healthy status', async () => {
    const req = new Request('https://api.docmac.app/healthz');
    const res = await handleRequest(req, env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.environment, 'test');
  });

  test('OPTIONS preflight returns 204 with CORS headers', async () => {
    const req = new Request('https://api.docmac.app/v1/apps/docmac/manifest.json', {
      method: 'OPTIONS',
      headers: { Origin: 'https://jackbarisere8.github.io' },
    });
    const res = await handleRequest(req, env);
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://jackbarisere8.github.io');
  });

  test('GET /v1/apps/docmac/manifest.json returns complete catalogue', async () => {
    const req = new Request('https://api.docmac.app/v1/apps/docmac/manifest.json');
    const res = await handleRequest(req, env);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Cache-Control'), 'public, max-age=60');

    const manifest = await res.json();
    assert.equal(manifest.app.slug, 'docmac');
    assert.equal(manifest.app.packageName, 'com.docmac.app');
    assert.equal(manifest.latest.versionName, '1.0.4');
    assert.equal(manifest.latest.versionCode, 10004);
    assert.equal(manifest.releases.length, 5);
  });

  test('GET /v1/apps/docmac/releases/latest returns current release', async () => {
    const req = new Request('https://api.docmac.app/v1/apps/docmac/releases/latest');
    const res = await handleRequest(req, env);
    assert.equal(res.status, 200);

    const latest = await res.json();
    assert.equal(latest.versionName, '1.0.4');
    assert.equal(latest.sha256, '1D4EDC3C546E0818884EAFEB6BBDE3CB911668109871912C7809818AC1DA2E6C');
  });

  test('GET /v1/apps/docmac/releases returns paginated list', async () => {
    const req = new Request('https://api.docmac.app/v1/apps/docmac/releases?limit=3');
    const res = await handleRequest(req, env);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.total, 5);
    assert.equal(body.releases.length, 3);
  });

  test('GET /v1/apps/docmac/releases/:version returns single release', async () => {
    const req = new Request('https://api.docmac.app/v1/apps/docmac/releases/1.0.3');
    const res = await handleRequest(req, env);
    assert.equal(res.status, 200);

    const release = await res.json();
    assert.equal(release.versionName, '1.0.3');
    assert.equal(release.sha256, 'AEB2F1CEE5A2BF20E4E925A118C047F3D4ABB558E19B64123AF499A4DD7C9661');
  });

  test('GET /v1/apps/docmac/releases/1.0.4/download redirects (302) to immutable CDN URL', async () => {
    const req = new Request('https://api.docmac.app/v1/apps/docmac/releases/1.0.4/download', {
      headers: { 'cf-ipcountry': 'NG' },
    });
    const res = await handleRequest(req, env);
    assert.equal(res.status, 302);
    assert.ok(res.headers.get('Location')?.includes('downloads.docmac.app/android/stable/1.0.4/'));
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
  });

  test('GET /v1/apps/docmac/download/latest redirects (302) to latest APK', async () => {
    const req = new Request('https://api.docmac.app/v1/apps/docmac/download/latest');
    const res = await handleRequest(req, env);
    assert.equal(res.status, 302);
    assert.ok(res.headers.get('Location')?.includes('docmac-1.0.4.apk'));
  });

  test('GET /v1/apps/docmac/checksums.txt returns valid sha256sum lines', async () => {
    const req = new Request('https://api.docmac.app/v1/apps/docmac/checksums.txt');
    const res = await handleRequest(req, env);
    assert.equal(res.status, 200);

    const text = await res.text();
    assert.ok(text.includes('1d4edc3c546e0818884eafeb6bbde3cb911668109871912c7809818ac1da2e6c  docmac-1.0.4.apk'));
    assert.ok(text.includes('26459b9675dbc0b6420bee1031500a70e27b994af6adea911ff6b41a4e656767  docmac-1.0.0.apk'));
  });

  test('GET /v1/apps/docmac/update checks for newer versions', async () => {
    // When client is on older version (10003)
    const reqOld = new Request('https://api.docmac.app/v1/apps/docmac/update?versionCode=10003');
    const resOld = await handleRequest(reqOld, env);
    const bodyOld = await resOld.json();
    assert.equal(bodyOld.updateAvailable, true);
    assert.equal(bodyOld.latest.versionName, '1.0.4');

    // When client is already on latest (10004)
    const reqLatest = new Request('https://api.docmac.app/v1/apps/docmac/update?versionCode=10004');
    const resLatest = await handleRequest(reqLatest, env);
    const bodyLatest = await resLatest.json();
    assert.equal(bodyLatest.updateAvailable, false);
  });

  test('POST /v1/feedback saves message and returns 201', async () => {
    const req = new Request('https://api.docmac.app/v1/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Tester',
        email: 'tester@example.com',
        topic: 'Idea or feature request',
        message: 'Great app! Please add voice messages.',
      }),
    });
    const res = await handleRequest(req, env);
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.id.startsWith('DOC-') || body.id.startsWith('fb_'));
  });

  test('Nonexistent route returns RFC 9457 Problem Details', async () => {
    const req = new Request('https://api.docmac.app/v1/apps/unknown-app/manifest.json');
    const res = await handleRequest(req, env);
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('Content-Type'), 'application/problem+json; charset=utf-8');

    const problem = await res.json();
    assert.equal(problem.status, 404);
    assert.equal(problem.code, 'APP_NOT_FOUND');
    assert.ok(problem.requestId);
  });
});

