#!/usr/bin/env node
/**
 * CI Release Completion and Verification Script
 * Implements Section 15.2 of docs/BACKEND_ARCHITECTURE.md
 *
 * Verifies the uploaded APK and publishes the release transactionally
 */

const API_BASE = (process.env.DOCMAC_API_URL || 'https://api.docmac.app/v1').replace(/\/+$/, '');
const TOKEN = process.env.DOCMAC_API_TOKEN || '';
const RELEASE_ID = process.env.RELEASE_ID || '';
const AUTO_PUBLISH = process.env.AUTO_PUBLISH !== 'false';

if (!TOKEN || !RELEASE_ID) {
  console.error('[ci-release] Error: DOCMAC_API_TOKEN and RELEASE_ID are required.');
  process.exit(1);
}

async function run() {
  console.log(`[ci-release] Declaring upload complete for release ${RELEASE_ID}...`);

  const res = await fetch(`${API_BASE}/admin/releases/${RELEASE_ID}/complete`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
  });

  const data = await res.json();
  if (!res.ok) {
    console.error('[ci-release] Verification failed or rejected:', data.detail || data.verification || data);
    process.exit(1);
  }

  console.log(`[ci-release] Verification PASSED! Status: ${data.status}`);
  if (data.verification?.checks) {
    console.log('[ci-release] Verification checks:', data.verification.checks);
  }

  if (AUTO_PUBLISH) {
    console.log(`[ci-release] Publishing release ${RELEASE_ID} to production...`);
    const pubRes = await fetch(`${API_BASE}/admin/releases/${RELEASE_ID}/publish`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    const pubData = await pubRes.json();
    if (!pubRes.ok) {
      console.error('[ci-release] Publish transaction failed:', pubData.detail || pubData);
      process.exit(1);
    }

    console.log(`[ci-release] SUCCESS: v${pubData.version_name} is now published and active!`);
  }
}

run().catch((err) => {
  const code = err?.cause?.code || err?.code;
  if (err?.message === 'fetch failed' || code) {
    console.error(
      `[ci-release] Could not reach the release API at ${API_BASE}${code ? ` (${code})` : ''}.`,
    );
    console.error(
      '[ci-release] The target API/verifier is not deployed. Use a GitHub Release for Phase 0, or deploy backend/ before running this workflow.',
    );
  } else {
    console.error('[ci-release] Unexpected error:', err);
  }
  process.exit(1);
});

