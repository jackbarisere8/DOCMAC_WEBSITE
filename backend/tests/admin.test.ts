/**
 * Integration Test Suite for Docmac Phase 2 Admin & Publishing Pipeline
 * Runs against in-memory SQLite using Node.js built-in node:sqlite
 * Execute: node --test backend/tests/admin.test.ts
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

import { handleRequest } from '../src/router.ts';
import type { Env, D1DatabaseLike } from '../src/types.ts';

describe('Docmac Phase 2 Publishing Pipeline', () => {
  let db: DatabaseSync;
  let env: Env;
  const adminHeaders = {
    'Content-Type': 'application/json',
    'X-Admin-Key': 'test-secret',
  };

  before(() => {
    db = new DatabaseSync(':memory:');
    const root = path.resolve(import.meta.dirname, '../..');
    const schemaSql = fs.readFileSync(path.join(root, 'backend/migrations/0001_initial_schema.sql'), 'utf8');
    const seedSql = fs.readFileSync(path.join(root, 'backend/migrations/0002_seed_releases.sql'), 'utf8');

    db.exec(schemaSql);
    db.exec(seedSql);

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
      FEEDBACK_EMAIL: 'support@docmac.app',
    };
  });

  test('GET /admin renders single-page admin console HTML', async () => {
    const req = new Request('https://api.docmac.app/admin', { method: 'GET' });
    const res = await handleRequest(req, env);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('Content-Type') || '', /text\/html/);
    const html = await res.text();
    assert.match(html, /Docmac Release Admin Console/);
    assert.match(html, /Release Catalogue/);
  });

  test('Admin endpoint rejects unauthenticated access with 401 Problem Details', async () => {
    const req = new Request('https://api.docmac.app/v1/admin/releases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ versionName: '1.0.5', versionCode: 105 }),
    });
    const res = await handleRequest(req, env);
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.code, 'UNAUTHORIZED');
    assert.match(data.type, /problems/);
  });

  test('POST /v1/admin/tokens creates a scoped API Bearer token', async () => {
    const req = new Request('https://api.docmac.app/v1/admin/tokens', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ name: 'ci-github-actions', scopes: ['release:write', 'release:publish'] }),
    });
    const res = await handleRequest(req, env);
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.token.startsWith('docmac_tok_'));
    assert.equal(data.name, 'ci-github-actions');

    // Verify token authenticates subsequent request
    const authReq = new Request('https://api.docmac.app/v1/admin/stats', {
      method: 'GET',
      headers: { Authorization: `Bearer ${data.token}` },
    });
    const authRes = await handleRequest(authReq, env);
    assert.equal(authRes.status, 200);
  });

  test('POST /v1/admin/releases creates draft release and returns upload instructions', async () => {
    const req = new Request('https://api.docmac.app/v1/admin/releases', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        versionName: '1.0.5',
        versionCode: 105,
        channel: 'stable',
        releaseNotes: 'Fixed calling reconnects and UI responsiveness.',
      }),
    });
    const res = await handleRequest(req, env);
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.id.startsWith('rel_'));
    assert.equal(data.status, 'draft');
    assert.equal(data.upload.method, 'PUT');
    assert.match(data.upload.url, new RegExp(`/v1/admin/releases/${data.id}/upload`));
  });

  test('Upload endpoint rejects unauthenticated requests in production (401)', async () => {
    const createReq = new Request('https://api.docmac.app/v1/admin/releases', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        versionName: '1.0.6',
        versionCode: 106,
        channel: 'stable',
        releaseNotes: 'Auth regression fixture.',
      }),
    });
    const createRes = await handleRequest(createReq, env);
    assert.equal(createRes.status, 201);
    const draft = await createRes.json();

    const uploadReq = new Request(draft.upload.url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/vnd.android.package-archive' },
      body: Buffer.alloc(64, 1),
    });
    const uploadRes = await handleRequest(uploadReq, { ...env, ENVIRONMENT: 'production' });
    assert.equal(uploadRes.status, 401);
    const data = await uploadRes.json();
    assert.equal(data.code, 'UNAUTHORIZED');
  });

  test('Hard-coded development token is rejected in production (401)', async () => {
    const req = new Request('https://api.docmac.app/v1/admin/stats', {
      method: 'GET',
      headers: { Authorization: 'Bearer docmac_admin_dev_secret' },
    });
    const res = await handleRequest(req, { ...env, ENVIRONMENT: 'production' });
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.code, 'UNAUTHORIZED');
  });

  test('POST /v1/admin/releases enforces version code uniqueness within channel (409)', async () => {
    const req = new Request('https://api.docmac.app/v1/admin/releases', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        versionName: '1.0.5-duplicate',
        versionCode: 105,
        channel: 'stable',
      }),
    });
    const res = await handleRequest(req, env);
    assert.equal(res.status, 409);
    const data = await res.json();
    assert.equal(data.code, 'VERSION_CODE_CONFLICT');
  });

  test('End-to-end publishing pipeline: upload -> verify -> publish -> manifest update', async () => {
    // 1. Create Draft
    const createReq = new Request('https://api.docmac.app/v1/admin/releases', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        versionName: '1.0.4',
        versionCode: 5,
        channel: 'internal', // Use internal channel so we don't conflict with stable 104
        releaseNotes: 'Verified internal build.',
      }),
    });
    const createRes = await handleRequest(createReq, env);
    assert.equal(createRes.status, 201);
    const draft = await createRes.json();
    const releaseId = draft.id;

    // 2. Direct Upload of APK
    const root = path.resolve(import.meta.dirname, '../..');
    const apkBuffer = fs.readFileSync(path.join(root, '.cache/apk/v1.0.4/app-release.apk'));

    const uploadReq = new Request(draft.upload.url, {
      method: 'PUT',
      headers: {
        ...adminHeaders,
        'Content-Type': 'application/vnd.android.package-archive',
      },
      body: apkBuffer,
    });
    const uploadRes = await handleRequest(uploadReq, env);
    assert.equal(uploadRes.status, 200);
    const uploadData = await uploadRes.json();
    assert.equal(uploadData.sizeBytes, apkBuffer.length);

    // 3. Declare complete and trigger verification
    const completeReq = new Request(`https://api.docmac.app/v1/admin/releases/${releaseId}/complete`, {
      method: 'POST',
      headers: adminHeaders,
    });
    const completeRes = await handleRequest(completeReq, env);
    assert.equal(completeRes.status, 200);
    const verifiedData = await completeRes.json();
    assert.equal(verifiedData.status, 'ready');
    assert.equal(verifiedData.verification.checks.manifestExtracted, true);
    assert.equal(verifiedData.verification.checks.signatureValid, true);

    // 4. Publish Release
    const publishReq = new Request(`https://api.docmac.app/v1/admin/releases/${releaseId}/publish`, {
      method: 'POST',
      headers: adminHeaders,
    });
    const publishRes = await handleRequest(publishReq, env);
    assert.equal(publishRes.status, 200);
    const published = await publishRes.json();
    assert.equal(published.status, 'published');
    assert.equal(published.is_current, 1);

    // 5. Verify public manifest reflects published release
    const manifestReq = new Request('https://api.docmac.app/v1/apps/docmac/manifest.json?channel=internal', {
      method: 'GET',
    });
    const manifestRes = await handleRequest(manifestReq, env);
    assert.equal(manifestRes.status, 200);
    const manifest = await manifestRes.json();
    assert.equal(manifest.latest.versionName, '1.0.4');
    assert.equal(manifest.latest.versionCode, 5);
  });

  test('Transactional Yank removes version from catalogue and restores previous current', async () => {
    // 1. Create two releases in beta channel: 1.0.0 (code 100) and 1.0.1 (code 101)
    const d1 = await (await handleRequest(new Request('https://api.docmac.app/v1/admin/releases', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ versionName: '1.0.0', versionCode: 100, channel: 'beta' }),
    }), env)).json();

    const d2 = await (await handleRequest(new Request('https://api.docmac.app/v1/admin/releases', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ versionName: '1.0.1', versionCode: 101, channel: 'beta' }),
    }), env)).json();

    // Mark both ready directly in DB for testing publish transition
    db.exec(`UPDATE releases SET status = 'ready' WHERE id IN ('${d1.id}', '${d2.id}')`);

    // Publish v1.0.0
    await handleRequest(new Request(`https://api.docmac.app/v1/admin/releases/${d1.id}/publish`, {
      method: 'POST',
      headers: adminHeaders,
    }), env);

    // Publish v1.0.1 (now current)
    await handleRequest(new Request(`https://api.docmac.app/v1/admin/releases/${d2.id}/publish`, {
      method: 'POST',
      headers: adminHeaders,
    }), env);

    // Check manifest shows 1.0.1 as latest
    let m = await (await handleRequest(new Request('https://api.docmac.app/v1/apps/docmac/manifest.json?channel=beta', { method: 'GET' }), env)).json();
    assert.equal(m.latest.versionCode, 101);

    // Yank v1.0.1 with reason
    const yankRes = await handleRequest(new Request(`https://api.docmac.app/v1/admin/releases/${d2.id}/yank`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ reason: 'Critical regression discovered.' }),
    }), env);
    assert.equal(yankRes.status, 200);
    const yanked = await yankRes.json();
    assert.equal(yanked.status, 'yanked');
    assert.equal(yanked.yanked_reason, 'Critical regression discovered.');
    assert.equal(yanked.is_current, 0);

    // Check manifest automatically fell back to v1.0.0 as current!
    m = await (await handleRequest(new Request('https://api.docmac.app/v1/apps/docmac/manifest.json?channel=beta', { method: 'GET' }), env)).json();
    assert.equal(m.latest.versionCode, 100);
    assert.equal(m.latest.versionName, '1.0.0');
  });

  test('Immutability policy: published releases cannot be deleted (403)', async () => {
    // Attempt to delete stable 1.0.4 (which is published)
    const req = new Request('https://api.docmac.app/v1/admin/releases/rel_1_0_4', {
      method: 'DELETE',
      headers: adminHeaders,
    });
    const res = await handleRequest(req, env);
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.equal(data.code, 'IMMUTABLE_RELEASE');
  });

  test('Audit trail records all mutations chronologically', async () => {
    const req = new Request('https://api.docmac.app/v1/admin/audit?limit=10', {
      method: 'GET',
      headers: adminHeaders,
    });
    const res = await handleRequest(req, env);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.total >= 3);
    const actions = data.logs.map((l: any) => l.action);
    assert.ok(actions.includes('release.draft_created'));
    assert.ok(actions.includes('release.publish'));
    assert.ok(actions.includes('release.yank'));
  });

  test('GET /v1/admin/stats returns aggregate metrics', async () => {
    const req = new Request('https://api.docmac.app/v1/admin/stats', {
      method: 'GET',
      headers: adminHeaders,
    });
    const res = await handleRequest(req, env);
    assert.equal(res.status, 200);
    const stats = await res.json();
    assert.ok(stats.totalPublished >= 5);
    assert.ok(stats.totalYanked >= 1);
  });
});

