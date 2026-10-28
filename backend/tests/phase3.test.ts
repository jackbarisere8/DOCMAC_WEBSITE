/**
 * Integration Test Suite for Docmac Phase 3:
 * In-app update channel, Server feedback intake, Rate limits, Telemetry, and Analytics
 * Execute: node --test backend/tests/phase3.test.ts
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

import { handleRequest } from '../src/router.ts';
import type { Env, D1DatabaseLike } from '../src/types.ts';

describe('Docmac Phase 3 — In-App Update Channel, Feedback API & Analytics', () => {
  let db: DatabaseSync;
  let env: Env;
  const adminHeaders = {
    'Content-Type': 'application/json',
    'X-Admin-Key': 'test-admin-secret',
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

  /* ------------------------------------------------------------------------ */
  /* 1. In-App Update Channel                                                 */
  /* ------------------------------------------------------------------------ */

  test('GET /update returns updateAvailable=false when client is on latest release', async () => {
    // Current latest in DB is 10004 (v1.0.4)
    const req = new Request('https://api.docmac.app/v1/apps/docmac/update?versionCode=10004&channel=stable', {
      method: 'GET',
    });
    const res = await handleRequest(req, env);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.updateAvailable, false);
    assert.equal(data.mandatory, false);
    assert.equal(data.latest, null);
  });

  test('GET /update returns updateAvailable=true with notes and downloadUrl when client is behind', async () => {
    const req = new Request('https://api.docmac.app/v1/apps/docmac/update?versionCode=10002&channel=stable', {
      method: 'GET',
    });
    const res = await handleRequest(req, env);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.updateAvailable, true);
    assert.equal(data.mandatory, false);
    assert.equal(data.latest.versionName, '1.0.4');
    assert.equal(data.latest.versionCode, 10004);
    assert.match(data.downloadUrl, /\/releases\/1\.0\.4\/download/);
  });

  test('GET /update sets mandatory=true when latest release has force_update=1', async () => {
    // Set force_update = 1 on latest release
    db.exec(`UPDATE releases SET force_update = 1 WHERE is_current = 1`);

    const req = new Request('https://api.docmac.app/v1/apps/docmac/update?versionCode=10002&channel=stable', {
      method: 'GET',
    });
    const res = await handleRequest(req, env);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.updateAvailable, true);
    assert.equal(data.mandatory, true);

    // Reset force_update
    db.exec(`UPDATE releases SET force_update = 0 WHERE is_current = 1`);
  });

  test('GET /update returns 410 Gone with safe upgrade when client installed version is yanked', async () => {
    // Yank v1.0.2 (code 10002) in DB
    db.exec(`UPDATE releases SET status = 'yanked', yanked_reason = 'Critical memory leak' WHERE version_code = 10002`);

    const req = new Request('https://api.docmac.app/v1/apps/docmac/update?versionCode=10002&channel=stable', {
      method: 'GET',
    });
    const res = await handleRequest(req, env);
    assert.equal(res.status, 410);
    assert.equal(res.headers.get('X-Docmac-Yanked'), 'true');
    const data = await res.json();
    assert.equal(data.clientVersionYanked, true);
    assert.equal(data.mandatory, true);
    assert.equal(data.yankedReason, 'Critical memory leak');
    assert.match(data.message, /withdrawn/);
    assert.equal(data.latest.versionName, '1.0.4');
  });

  test('GET /update alias route functions identically', async () => {
    const req = new Request('https://api.docmac.app/update?versionCode=10001&channel=stable', {
      method: 'GET',
    });
    const res = await handleRequest(req, env);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.updateAvailable, true);
    assert.equal(data.latest.versionName, '1.0.4');
  });

  /* ------------------------------------------------------------------------ */
  /* 2. Feedback Intake API                                                   */
  /* ------------------------------------------------------------------------ */

  test('POST /v1/feedback accepts report and assigns formatted ticket ID (DOC-2026-XXXX)', async () => {
    const req = new Request('https://api.docmac.app/v1/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'cf-connecting-ip': '197.210.45.10',
      },
      body: JSON.stringify({
        name: 'Adaobi Okon',
        email: 'adaobi@example.com',
        topic: 'Something is not working',
        message: 'The incoming call screen did not display caller name on Android 14.',
      }),
    });
    const res = await handleRequest(req, env);
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.match(data.ticketId, /^DOC-\d{4}-[A-Z0-9]+$/);
    assert.ok(data.responseExpectation);

    // Verify stored in DB
    const stmt = db.prepare('SELECT * FROM feedback WHERE id = ?');
    const row = stmt.all(data.ticketId)[0] as any;
    assert.equal(row.topic, 'Something is not working');
    assert.equal(row.email, 'adaobi@example.com');
    assert.equal(row.status, 'new');
    assert.ok(row.ip_hash); // Hashed, not raw IP
  });

  test('POST /v1/feedback rejects missing required fields with 400 Problem Details', async () => {
    const req = new Request('https://api.docmac.app/v1/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Incomplete' }),
    });
    const res = await handleRequest(req, env);
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.code, 'VALIDATION_ERROR');
  });

  test('POST /v1/feedback enforces rate limit per IP hash (429)', async () => {
    const spamIp = '197.210.99.88';
    // Submit 10 times to hit limit
    for (let i = 0; i < 10; i++) {
      await handleRequest(
        new Request('https://api.docmac.app/v1/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': spamIp },
          body: JSON.stringify({ topic: 'Rate limit test', message: `Test message ${i}` }),
        }),
        env
      );
    }

    // 11th request must trigger rate limit
    const req = new Request('https://api.docmac.app/v1/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': spamIp },
      body: JSON.stringify({ topic: 'Rate limit test', message: 'Should be blocked' }),
    });
    const res = await handleRequest(req, env);
    assert.equal(res.status, 429);
    const data = await res.json();
    assert.equal(data.code, 'RATE_LIMIT_EXCEEDED');
  });

  /* ------------------------------------------------------------------------ */
  /* 3. Admin Feedback Triage                                                 */
  /* ------------------------------------------------------------------------ */

  test('Admin feedback endpoints: list and update ticket status', async () => {
    // 1. List feedback
    const listReq = new Request('https://api.docmac.app/v1/admin/feedback', {
      method: 'GET',
      headers: adminHeaders,
    });
    const listRes = await handleRequest(listReq, env);
    assert.equal(listRes.status, 200);
    const listData = await listRes.json();
    assert.ok(listData.feedback.length >= 1);
    const firstTicket = listData.feedback[0];

    // 2. Update status to 'replied'
    const patchReq = new Request(`https://api.docmac.app/v1/admin/feedback/${firstTicket.id}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ status: 'replied' }),
    });
    const patchRes = await handleRequest(patchReq, env);
    assert.equal(patchRes.status, 200);

    // Verify in DB
    const checkStmt = db.prepare('SELECT status FROM feedback WHERE id = ?');
    const updated = checkStmt.all(firstTicket.id)[0] as any;
    assert.equal(updated.status, 'replied');
  });

  /* ------------------------------------------------------------------------ */
  /* 4. Download Telemetry & Analytics                                        */
  /* ------------------------------------------------------------------------ */

  test('Download endpoints record telemetry by country and date without raw IPs', async () => {
    // Simulate downloads from Nigeria (NG) and United Kingdom (GB)
    const dl1 = new Request('https://api.docmac.app/v1/apps/docmac/releases/1.0.4/download', {
      method: 'GET',
      headers: { 'cf-ipcountry': 'NG' },
    });
    const res1 = await handleRequest(dl1, env);
    assert.equal(res1.status, 302);

    const dl2 = new Request('https://api.docmac.app/v1/apps/docmac/download/latest', {
      method: 'GET',
      headers: { 'cf-ipcountry': 'GB' },
    });
    const res2 = await handleRequest(dl2, env);
    assert.equal(res2.status, 302);

    // Check stats endpoint reflects downloads
    const statsReq = new Request('https://api.docmac.app/v1/admin/stats', {
      method: 'GET',
      headers: adminHeaders,
    });
    const statsRes = await handleRequest(statsReq, env);
    assert.equal(statsRes.status, 200);
    const stats = await statsRes.json();
    assert.ok(stats.totalDownloads >= 2);
    assert.ok(stats.downloadsByVersion.length >= 1);

    const countries = stats.recentDownloads.map((r: any) => r.country.toLowerCase());
    assert.ok(countries.includes('ng'));
    assert.ok(countries.includes('gb'));
  });
});
