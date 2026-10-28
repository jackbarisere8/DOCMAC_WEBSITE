#!/usr/bin/env node
/**
 * CI Release Initializer Script
 * Implements Section 15.2 of docs/BACKEND_ARCHITECTURE.md
 *
 * Creates a draft release in the Docmac API and outputs upload instructions
 */

import fs from 'node:fs';

const API_BASE = (process.env.DOCMAC_API_URL || 'https://api.docmac.app/v1').replace(/\/+$/, '');
const TOKEN = process.env.DOCMAC_API_TOKEN || '';
const CHANNEL = process.env.CHANNEL || 'stable';
const NOTES = process.env.NOTES || 'Release built by CI automation.';
const VERSION_NAME = process.env.VERSION_NAME;
const VERSION_CODE = Number(process.env.VERSION_CODE);

if (!TOKEN) {
  console.error('[ci-release] Error: DOCMAC_API_TOKEN environment variable is required.');
  process.exit(1);
}
if (!VERSION_NAME || !VERSION_CODE) {
  console.error('[ci-release] Error: VERSION_NAME and VERSION_CODE are required.');
  process.exit(1);
}

async function run() {
  console.log(`[ci-release] Creating draft release v${VERSION_NAME} (code ${VERSION_CODE}) on channel "${CHANNEL}"...`);

  const res = await fetch(`${API_BASE}/admin/releases`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({
      versionName: VERSION_NAME,
      versionCode: VERSION_CODE,
      channel: CHANNEL,
      releaseNotes: NOTES,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error('[ci-release] API returned error:', data.detail || data.title || data);
    process.exit(1);
  }

  console.log(`[ci-release] Draft release created: ${data.id}`);
  console.log(`[ci-release] Upload URL: ${data.upload.url}`);

  // Write to GitHub Actions outputs if running in Actions environment
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `releaseId=${data.id}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `uploadUrl=${data.upload.url}\n`);
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

