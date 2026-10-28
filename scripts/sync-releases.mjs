#!/usr/bin/env node
/**
 * Sync Docmac Android releases from GitHub into releases.json.
 *
 * - Fetches every published GitHub release and its APK asset.
 * - Downloads missing APKs once, then records SHA-256, SHA-512, size, and the
 *   signing-certificate SHA-256 fingerprint in data/apk-integrity.json.
 * - Merges curated metadata from data/release-meta.json.
 * - Writes a single releases.json consumed by the website.
 *
 * Usage:
 *   node scripts/sync-releases.mjs
 *   node scripts/sync-releases.mjs --force   # re-download and re-hash
 *
 * Environment:
 *   GITHUB_TOKEN         Optional, raises the GitHub API rate limit.
 *   RELEASES_REPOSITORY  Optional, defaults to jackbarisere8/DOCMAC.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ROOT = path.resolve(import.meta.dirname, '..');
const REPO = process.env.RELEASES_REPOSITORY || 'jackbarisere8/DOCMAC';
const TOKEN = process.env.GITHUB_TOKEN || '';
const FORCE = process.argv.includes('--force');

const CACHE_DIR = path.join(ROOT, '.cache', 'apk');
const META_PATH = path.join(ROOT, 'data', 'release-meta.json');
const INTEGRITY_PATH = path.join(ROOT, 'data', 'apk-integrity.json');
const OUTPUT_PATH = path.join(ROOT, 'releases.json');
const CHECKSUMS_PATH = path.join(ROOT, 'checksums.txt');

const log = (...args) => console.log('[releases]', ...args);
const warn = (...args) => console.warn('[releases] warning:', ...args);

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

function apiHeaders() {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'docmac-release-sync',
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
  };
}

async function githubJson(pathname) {
  const url = `https://api.github.com/repos/${REPO}${pathname}`;
  const attempts = 4;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: apiHeaders(),
        signal: AbortSignal.timeout(30_000),
      });

      if (res.status >= 500 && res.status <= 599 && attempt < attempts) {
        await res.body?.cancel().catch(() => {});
        warn(`GitHub API ${res.status} for ${pathname}; retrying (${attempt}/${attempts})...`);
        await sleep(1_000 * 2 ** (attempt - 1));
        continue;
      }
      if (!res.ok) {
        throw new Error(`GitHub API ${res.status} for ${pathname}: ${await res.text()}`);
      }
      return await res.json();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetryable(error)) throw error;
      const delay = 1_000 * 2 ** (attempt - 1);
      warn(
        `GitHub API request failed (${errorCode(error) || error.message}); retrying in ${delay}ms (${attempt}/${attempts})...`,
      );
      await sleep(delay);
    }
  }

  throw lastError;
}

async function download(url, destination) {
  const temp = `${destination}.part`;
  const attempts = 4;
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'docmac-release-sync' },
        redirect: 'follow',
        signal: AbortSignal.timeout(10 * 60_000),
      });
      if (!res.ok) {
        throw new Error(`Download failed ${res.status} ${res.statusText}: ${url}`);
      }
      if (!res.body) throw new Error(`Download response had no body: ${url}`);

      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(temp));
      const stat = await fsp.stat(temp);
      if (!stat.size) throw new Error(`Downloaded file is empty: ${url}`);

      // A partial file must never be treated as a complete cached APK.
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

async function hashFile(file, algorithm) {
  const hash = crypto.createHash(algorithm);
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex').toUpperCase();
}

/* -------------------------------------------------------------------------- */
/* APK signing block parser                                                    */
/* -------------------------------------------------------------------------- */

function readUInt64LE(buffer, offset) {
  return Number(buffer.readBigUInt64LE(offset));
}

function readLengthPrefixed(buffer, offset) {
  const length = buffer.readUInt32LE(offset);
  const start = offset + 4;
  const end = start + length;
  if (end > buffer.length) throw new Error('Length-prefixed value exceeds buffer');
  return { value: buffer.subarray(start, end), next: end };
}

function readSigningBlockPairs(buffer) {
  let eocd = -1;
  const minOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) return null;

  const centralDirectoryOffset = buffer.readUInt32LE(eocd + 16);
  if (centralDirectoryOffset < 32) return null;
  if (buffer.subarray(centralDirectoryOffset - 16, centralDirectoryOffset).toString('latin1') !== 'APK Sig Block 42') {
    return null;
  }

  const blockSize = readUInt64LE(buffer, centralDirectoryOffset - 24);
  const blockStart = centralDirectoryOffset - blockSize - 8;
  if (blockStart < 0) return null;
  if (readUInt64LE(buffer, blockStart) !== blockSize) return null;

  const pairs = [];
  let offset = blockStart + 8;
  const pairsEnd = centralDirectoryOffset - 24;
  while (offset + 12 <= pairsEnd) {
    const pairLength = readUInt64LE(buffer, offset);
    if (pairLength < 4 || offset + 8 + pairLength > pairsEnd) break;
    const id = buffer.readUInt32LE(offset + 8);
    pairs.push({ id, value: buffer.subarray(offset + 12, offset + 8 + pairLength) });
    offset += 8 + pairLength;
  }
  return pairs;
}

function extractCertificates(schemeValue) {
  const signers = readLengthPrefixed(schemeValue, 0);
  const certificates = [];
  let offset = 0;
  while (offset < signers.value.length) {
    const signer = readLengthPrefixed(signers.value, offset);
    offset = signer.next;

    // Signed data is the first length-prefixed field of every signer.
    const signedData = readLengthPrefixed(signer.value, 0);
    let cursor = 0;
    const digests = readLengthPrefixed(signedData.value, cursor);
    cursor = digests.next;
    const certSequence = readLengthPrefixed(signedData.value, cursor);

    let certOffset = 0;
    while (certOffset < certSequence.value.length) {
      const certificate = readLengthPrefixed(certSequence.value, certOffset);
      certOffset = certificate.next;
      certificates.push(certificate.value);
    }
  }
  return certificates;
}

function readApkSigningCertificates(buffer) {
  const pairs = readSigningBlockPairs(buffer);
  if (!pairs) return [];
  // Prefer v3, then v2. v3.1 is a key-rotation block and is not needed here.
  for (const id of [0xf05368c0, 0x7109871a]) {
    const pair = pairs.find((entry) => entry.id === id);
    if (!pair) continue;
    try {
      const certificates = extractCertificates(pair.value);
      if (certificates.length) return certificates;
    } catch (error) {
      warn(`Could not parse signing scheme 0x${id.toString(16)}: ${error.message}`);
    }
  }
  return [];
}

function fingerprint(der) {
  return crypto
    .createHash('sha256')
    .update(der)
    .digest('hex')
    .toUpperCase()
    .match(/.{2}/g)
    .join(':');
}

function certificateInfo(der) {
  try {
    const certificate = new crypto.X509Certificate(der);
    return {
      sha256: fingerprint(der),
      subject: certificate.subject.replace(/\n/g, ', '),
      issuer: certificate.issuer.replace(/\n/g, ', '),
      validFrom: new Date(certificate.validFrom).toISOString(),
      validTo: new Date(certificate.validTo).toISOString(),
    };
  } catch {
    return { sha256: fingerprint(der), subject: null, issuer: null, validFrom: null, validTo: null };
  }
}

async function inspectApk(file) {
  const buffer = await fsp.readFile(file);
  const certificates = readApkSigningCertificates(buffer);
  if (!certificates.length) {
    warn(`No APK signing certificate found in ${path.basename(file)}`);
    return null;
  }
  return certificateInfo(certificates[0]);
}

/* -------------------------------------------------------------------------- */
/* Release metadata                                                            */
/* -------------------------------------------------------------------------- */

function parseVersion(name) {
  const match = String(name)
    .replace(/^v/i, '')
    .match(/^(\d+)\.(\d+)\.(\d+)(?:[-+]([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    text: `${match[1]}.${match[2]}.${match[3]}${match[4] ? `-${match[4]}` : ''}`,
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] || '',
  };
}

function compareVersions(a, b) {
  const left = parseVersion(a.versionName);
  const right = parseVersion(b.versionName);
  if (!left || !right) return String(b.versionName).localeCompare(String(a.versionName));
  for (let index = 0; index < 3; index += 1) {
    if (left.core[index] !== right.core[index]) return right.core[index] - left.core[index];
  }
  if (left.prerelease === right.prerelease) return 0;
  if (!left.prerelease) return -1;
  if (!right.prerelease) return 1;
  return right.prerelease.localeCompare(left.prerelease);
}

function normalizeNotes(value) {
  return String(value || '')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .trim();
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function buildChecksums(manifest) {
  const latest = manifest.latest;
  const lines = [
    '# Docmac Official Android APK SHA-256 Checksums',
    `# Generated: ${manifest.generatedAt}`,
    `# Signing Certificate SHA-256: ${manifest.app?.signingCertSha256 || latest?.signatureSha256 || 'Unavailable'}`,
    '#',
    '# Download filenames use the pattern docmac-<version>.apk.',
    '# Rename your downloaded app-release.apk to match before verifying.',
    '#',
    '# Verification on Linux/macOS:',
    '#   sha256sum -c checksums.txt',
    '# Verification on Windows:',
    '#   certutil -hashfile docmac-<version>.apk SHA256',
    '#',
    `# Latest release: v${latest?.versionName || 'unknown'} (docmac-${latest?.versionName || 'unknown'}.apk)`,
    '',
    ...manifest.releases
      .filter((release) => release.sha256)
      .map((release) => `${release.sha256.toLowerCase()}  docmac-${release.versionName}.apk`),
    '',
  ];
  return lines.join('\n');
}

async function writeIfChanged(file, content) {
  const previous = await fsp.readFile(file, 'utf8').catch(() => null);
  if (previous === content) return false;
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, content);
  return true;
}

function withoutGeneratedAt(value) {
  const copy = { ...value };
  delete copy.generatedAt;
  return copy;
}

async function commitNotesForRelease(release, olderTag) {
  try {
    if (olderTag) {
      const comparison = await githubJson(
        `/compare/${encodeURIComponent(olderTag)}...${encodeURIComponent(release.tag_name)}`,
      );
      const lines = (comparison.commits || [])
        .map((commit) => commit.commit.message.split('\n')[0].trim())
        .filter((message) => message && !/^merge\b/i.test(message) && !/^release docmac\b/i.test(message));
      if (lines.length) return lines.slice(0, 10).map((line) => `- ${line}`).join('\n');
    } else {
      const commits = await githubJson(
        `/commits?sha=${encodeURIComponent(release.tag_name)}&per_page=10`,
      );
      const lines = commits
        .map((commit) => commit.commit.message.split('\n')[0].trim())
        .filter((message) => message && !/^merge\b/i.test(message));
      if (lines.length) return lines.slice(0, 10).map((line) => `- ${line}`).join('\n');
    }
  } catch (error) {
    warn(`Could not build notes from commits for ${release.tag_name}: ${error.message}`);
  }
  return null;
}

function isUsefulReleaseBody(body) {
  const text = normalizeNotes(body);
  if (!text) return false;
  if (/^release v?\d+(\.\d+)*\.?$/i.test(text)) return false;
  if (/^production android apk for docmac v?\d+(\.\d+)*\.?$/i.test(text)) return false;
  if (/^android release apk\.?$/i.test(text)) return false;
  return text.length >= 24;
}

/* -------------------------------------------------------------------------- */
/* Integrity cache                                                             */
/* -------------------------------------------------------------------------- */

async function loadJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function assetForRelease(release) {
  const assets = release.assets || [];
  return (
    assets.find((asset) => /app-release\.apk$/i.test(asset.name)) ||
    assets.find((asset) => /\.apk$/i.test(asset.name)) ||
    null
  );
}

async function ensureIntegrity(release, asset, existing) {
  const version = release.tag_name.replace(/^v/i, '');
  const cached = existing.releases?.[version];
  if (!FORCE && cached?.sha256 && cached?.signatureSha256 && cached?.sizeBytes === asset.size) {
    log(`${version}: using cached checksum and signature`);
    return cached;
  }

  const destination = path.join(CACHE_DIR, release.tag_name, asset.name);
  const exists = await fsp
    .stat(destination)
    .then((stat) => stat.size === asset.size)
    .catch(() => false);

  if (!exists) {
    log(`${version}: downloading ${asset.name} (${formatBytes(asset.size)})`);
    await download(asset.browser_download_url, destination);
  } else {
    log(`${version}: using cached APK file`);
  }

  const [sha256, sha512, certificate] = await Promise.all([
    hashFile(destination, 'sha256'),
    hashFile(destination, 'sha512'),
    inspectApk(destination),
  ]);

  if (!certificate) {
    throw new Error(`Could not extract a signing certificate from ${asset.name}. Refusing to publish incomplete integrity data.`);
  }

  const stat = await fsp.stat(destination);
  return {
    sha256,
    sha512,
    sizeBytes: stat.size,
    signatureSha256: certificate.sha256,
    certificateSubject: certificate.subject,
    certificateIssuer: certificate.issuer,
    certificateValidFrom: certificate.validFrom,
    certificateValidTo: certificate.validTo,
    checkedAt: new Date().toISOString(),
    source: asset.browser_download_url,
  };
}

/* -------------------------------------------------------------------------- */
/* Main                                                                        */
/* -------------------------------------------------------------------------- */

async function main() {
  const meta = await loadJson(META_PATH, { app: {}, releases: {} });
  const integrity = await loadJson(INTEGRITY_PATH, { releases: {} });

  let rawReleases = [];
  try {
    log(`Fetching releases for ${REPO}`);
    rawReleases = await githubJson('/releases?per_page=100');
  } catch (error) {
    if (fs.existsSync(OUTPUT_PATH)) {
      warn(`GitHub API request failed (${error.message}). Regenerating from cached release catalogue.`);
      const existing = await loadJson(OUTPUT_PATH);
      if (existing?.releases?.length) {
        const fallbackManifest = {
          ...existing,
          generatedAt: existing.generatedAt || new Date().toISOString(),
        };
        const checksumsChanged = await writeIfChanged(
          CHECKSUMS_PATH,
          buildChecksums(fallbackManifest),
        );
        log(
          `${checksumsChanged ? 'Updated' : 'Unchanged'} ${path.relative(ROOT, CHECKSUMS_PATH)} from cached catalogue.`,
        );
        return;
      }
    }
    throw error;
  }
  const published = rawReleases
    .filter((release) => !release.draft)
    .filter((release) => parseVersion(release.tag_name))
    .sort((a, b) => compareVersions({ versionName: a.tag_name }, { versionName: b.tag_name }));

  if (!published.length) throw new Error('No published releases found.');

  const releases = [];
  for (let index = 0; index < published.length; index += 1) {
    const release = published[index];
    const version = release.tag_name.replace(/^v/i, '');
    const asset = assetForRelease(release);
    if (!asset) {
      warn(`${release.tag_name}: no APK asset found, skipping.`);
      continue;
    }

    const record = await ensureIntegrity(release, asset, integrity);
    integrity.releases[version] = record;

    const curated = meta.releases?.[version] || {};
    const olderTag = published[index + 1]?.tag_name || null;
    let notes = curated.notes ? normalizeNotes(curated.notes) : null;
    if (!notes && isUsefulReleaseBody(release.body)) notes = normalizeNotes(release.body);
    if (!notes && !curated.notes) notes = await commitNotesForRelease(release, olderTag);
    if (!notes) notes = 'No release notes were published for this build.';

    const versionName = version.replace(/^v/i, '');
    releases.push({
      versionName,
      tag: release.tag_name,
      channel: curated.channel || (release.prerelease ? 'beta' : 'stable'),
      publishedAt: release.published_at || release.created_at,
      releaseNotes: notes,
      sizeBytes: record.sizeBytes,
      sizeLabel: formatBytes(record.sizeBytes),
      sha256: record.sha256,
      sha512: record.sha512,
      signatureSha256: record.signatureSha256,
      certificateSubject: record.certificateSubject || null,
      minSdk: curated.minSdk || meta.app.minSdk || null,
      minAndroid: curated.minAndroid || meta.app.minAndroid || null,
      downloadUrl: asset.browser_download_url,
      releaseUrl: release.html_url,
      fileName: asset.name,
      yanked: Boolean(curated.yanked),
      forceUpdate: Boolean(curated.forceUpdate),
      versionCode: curated.versionCode ?? null,
    });
  }

  releases.sort(compareVersions);
  const latest =
    releases.find((release) => release.channel === 'stable' && !release.yanked) ||
    releases.find((release) => !release.yanked) ||
    releases[0];

  if (!latest) throw new Error('No usable release found.');

  const previousIntegrity = await loadJson(INTEGRITY_PATH, { releases: {} });
  const prunedIntegrity = {};
  for (const release of releases) {
    const record = integrity.releases?.[release.versionName];
    if (record) prunedIntegrity[release.versionName] = record;
  }
  const integrityChanged =
    JSON.stringify(previousIntegrity.releases || {}) !== JSON.stringify(prunedIntegrity) ||
    previousIntegrity.repo !== REPO;

  const generatedAt = new Date().toISOString();
  const integrityDocument = {
    releases: prunedIntegrity,
    generatedAt: integrityChanged ? generatedAt : previousIntegrity.generatedAt || generatedAt,
    repo: REPO,
  };
  await writeIfChanged(INTEGRITY_PATH, `${JSON.stringify(integrityDocument, null, 2)}\n`);

  const manifestCore = {
    schemaVersion: 1,
    source: 'github-releases',
    app: {
      ...meta.app,
      signingCertSha256: latest.signatureSha256,
    },
    latest,
    releases,
  };
  const previousManifest = await loadJson(OUTPUT_PATH, null);
  const manifestChanged =
    !previousManifest ||
    JSON.stringify(withoutGeneratedAt(previousManifest)) !== JSON.stringify(manifestCore);

  const manifest = {
    schemaVersion: manifestCore.schemaVersion,
    generatedAt: manifestChanged ? generatedAt : previousManifest.generatedAt || generatedAt,
    source: manifestCore.source,
    app: manifestCore.app,
    latest,
    releases,
  };

  await writeIfChanged(OUTPUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  const checksumsChanged = await writeIfChanged(CHECKSUMS_PATH, buildChecksums(manifest));
  log(`${checksumsChanged ? 'Updated' : 'Unchanged'} ${path.relative(ROOT, CHECKSUMS_PATH)}.`);

  log(
    `${manifestChanged ? 'Updated' : 'Unchanged'} ${path.relative(ROOT, OUTPUT_PATH)} with ${releases.length} releases.`,
  );
  log(`Latest: v${latest.versionName} · ${latest.sizeLabel} · ${latest.sha256.slice(0, 16)}…`);
  log(`Signing cert: ${latest.signatureSha256}`);
}

main().catch((error) => {
  console.error('[releases] FAILED:', error);
  if (isRetryable(error)) {
    console.error(
      '[releases] The network transfer failed after retries. Re-run the sync; completed APKs are cached and partial downloads are discarded.',
    );
  }
  process.exitCode = 1;
});
