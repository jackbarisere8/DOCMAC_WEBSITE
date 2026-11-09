#!/usr/bin/env node
/**
 * Stages the latest signed APK into _site/downloads/ so the website can serve
 * the file from its own origin.
 *
 * GitHub release assets already send Content-Disposition: attachment, but the
 * URL is still github.com. A same-origin copy guarantees that clicking the
 * download button starts the download without leaving the site or opening a
 * GitHub page. The APK is not committed to git: it is read from the release
 * sync cache when available, otherwise downloaded from the official GitHub
 * release and verified against releases.json before it is staged.
 *
 * Usage:
 *   node scripts/stage-apk.mjs
 *   node scripts/stage-apk.mjs --skip   # local UI work without the APK
 *
 * Environment:
 *   SKIP_APK=1   Same as --skip.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ROOT = path.resolve(import.meta.dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'releases.json');
const SITE_DIR = path.join(ROOT, '_site');
const DOWNLOAD_DIR = path.join(SITE_DIR, 'downloads');
const CACHE_DIR = path.join(ROOT, '.cache', 'apk');
const STABLE_NAME = 'docmac-latest.apk';
const SKIP = process.argv.includes('--skip') || process.env.SKIP_APK === '1';

const log = (...args) => console.log('[apk]', ...args);
const warn = (...args) => console.warn('[apk] warning:', ...args);

const RETRYABLE_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ABORT_ERR',
  'UND_ERR_SOCKET',
  'UND_ERR_CLOSED',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const errorCode = (error) => error?.cause?.code || error?.code || '';
const isRetryable = (error) =>
  RETRYABLE_CODES.has(errorCode(error)) ||
  error?.cause?.name === 'TimeoutError' ||
  error?.name === 'TimeoutError';

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function hashFile(file, algorithm) {
  const hash = crypto.createHash(algorithm);
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex').toUpperCase();
}

async function matchesManifest(file, release) {
  try {
    const stat = await fsp.stat(file);
    if (stat.size !== release.sizeBytes) return false;
    const digest = await hashFile(file, 'sha256');
    return digest === String(release.sha256).toUpperCase();
  } catch {
    return false;
  }
}

async function download(url, destination) {
  const temp = `${destination}.part`;
  const attempts = 4;
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'docmac-site-apk-stage' },
        redirect: 'follow',
        signal: AbortSignal.timeout(10 * 60_000),
      });
      if (!res.ok) throw new Error(`Download failed ${res.status} ${res.statusText}: ${url}`);
      if (!res.body) throw new Error(`Download response had no body: ${url}`);

      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(temp));
      const stat = await fsp.stat(temp);
      if (!stat.size) throw new Error(`Downloaded file is empty: ${url}`);

      await fsp.rm(destination, { force: true });
      await fsp.rename(temp, destination);
      return;
    } catch (error) {
      lastError = error;
      await fsp.rm(temp, { force: true }).catch(() => {});
      if (attempt >= attempts || !isRetryable(error)) throw error;
      const delay = 1_500 * 2 ** (attempt - 1);
      warn(
        `APK download failed (${errorCode(error) || error.message}); retrying in ${delay}ms (${attempt}/${attempts})...`,
      );
      await sleep(delay);
    }
  }

  throw lastError;
}

async function main() {
  if (SKIP) {
    log('Skipping APK staging (--skip or SKIP_APK=1). Local download links will not resolve until stage:apk runs.');
    return;
  }

  const manifest = JSON.parse(await fsp.readFile(MANIFEST_PATH, 'utf8'));
  const latest = manifest.latest;
  if (!latest?.versionName || !latest?.sha256 || !latest?.sizeBytes) {
    throw new Error('releases.json does not contain a complete latest release.');
  }

  const cachePath = path.join(
    CACHE_DIR,
    latest.tag || `v${latest.versionName}`,
    latest.fileName || 'app-release.apk',
  );

  let source = cachePath;
  if (await matchesManifest(cachePath, latest)) {
    log(`${latest.versionName}: using verified cached APK`);
  } else {
    if (fs.existsSync(cachePath)) {
      warn(`${latest.versionName}: cached APK does not match releases.json; downloading a fresh copy.`);
    }
    log(`${latest.versionName}: downloading ${latest.downloadUrl}`);
    await download(latest.downloadUrl, cachePath);
    if (!(await matchesManifest(cachePath, latest))) {
      throw new Error(
        `Downloaded APK failed verification for v${latest.versionName}. Expected SHA-256 ${latest.sha256}.`,
      );
    }
    source = cachePath;
  }

  await fsp.mkdir(DOWNLOAD_DIR, { recursive: true });
  const destination = path.join(DOWNLOAD_DIR, STABLE_NAME);
  const temp = `${destination}.part`;
  await fsp.copyFile(source, temp);
  await fsp.rm(destination, { force: true });
  await fsp.rename(temp, destination);

  log(
    `Staged ${STABLE_NAME} (v${latest.versionName}, ${formatBytes(latest.sizeBytes)}, SHA-256 ${latest.sha256.slice(0, 16)}…) in ${path.relative(ROOT, DOWNLOAD_DIR)}.`,
  );
}

main().catch((error) => {
  console.error('[apk] FAILED:', error);
  process.exitCode = 1;
});
