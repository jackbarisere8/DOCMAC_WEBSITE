#!/usr/bin/env node
/**
 * Validates the public site before deployment.
 *
 * - Local links, images, fonts, and same-document anchors resolve.
 * - Every HTML page has the required document metadata.
 * - releases.json, apk-integrity.json, checksums.txt, release pages, and the
 *   sitemap agree with each other.
 *
 * Usage: node scripts/validate.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SITE_URL = 'https://jackbarisere8.github.io/DOCMAC_WEBSITE';
const EXCLUDED_DIRECTORIES = new Set([
  '.cache',
  '.git',
  '.github',
  '_site',
  'backend',
  'data',
  'docs',
  'node_modules',
  'scripts',
  'verifier',
]);

const errors = [];
const warnings = [];

function fail(message) {
  errors.push(message);
}

function warn(message) {
  warnings.push(message);
}

function findHtmlFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findHtmlFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(fullPath);
    }
  }
  return files;
}

function relative(file) {
  return path.relative(ROOT, file).replaceAll('\\', '/');
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasFragmentTarget(content, fragment) {
  const id = escapeRegex(fragment);
  return new RegExp(`\\bid=(["'])${id}\\1`).test(content) || new RegExp(`\\bname=(["'])${id}\\1`).test(content);
}

function resolveLocalPath(fromFile, rawValue) {
  const cleanPath = rawValue.split('?')[0].split('#')[0];
  if (!cleanPath) return null;

  let decoded;
  try {
    decoded = decodeURIComponent(cleanPath);
  } catch {
    decoded = cleanPath;
  }

  const base = decoded.startsWith('/') ? ROOT : path.dirname(fromFile);
  const withoutLeadingSlash = decoded.replace(/^\/+/, '');
  const target = path.resolve(base, withoutLeadingSlash);

  if (!target.startsWith(ROOT)) {
    fail(`Path escapes the project root in ${relative(fromFile)}: "${rawValue}"`);
    return null;
  }
  return target;
}

const htmlFiles = findHtmlFiles(ROOT);
const htmlCache = new Map();

function readHtml(file) {
  if (!htmlCache.has(file)) htmlCache.set(file, fs.readFileSync(file, 'utf8'));
  return htmlCache.get(file);
}

for (const file of htmlFiles) {
  const content = readHtml(file);
  const name = relative(file);

  if (!/<html\b[^>]*\blang=/i.test(content)) fail(`${name}: missing <html lang>`);
  if (!/<meta[^>]+name=["']viewport["']/i.test(content)) fail(`${name}: missing viewport meta tag`);
  if (!/<title>[^<]+<\/title>/i.test(content)) fail(`${name}: missing or empty <title>`);
  if (!/<meta[^>]+name=["']description["'][^>]+content=["'][^"']+/i.test(content)) {
    warn(`${name}: missing meta description`);
  }
  if (!/<h1\b/i.test(content)) warn(`${name}: missing <h1>`);

  const matches = content.matchAll(/(?:href|src|srcset)="([^"]+)"/g);
  for (const match of matches) {
    const rawValue = match[1];
    const entries = rawValue.split(',').map((entry) => entry.trim().split(/\s+/)[0]);

    for (const value of entries) {
      if (
        !value ||
        value.startsWith('http://') ||
        value.startsWith('https://') ||
        value.startsWith('mailto:') ||
        value.startsWith('tel:') ||
        value.startsWith('data:') ||
        value.startsWith('javascript:')
      ) {
        continue;
      }

      if (value.startsWith('#')) {
        const fragment = decodeURIComponent(value.slice(1));
        if (fragment && !hasFragmentTarget(content, fragment)) {
          fail(`${name}: missing anchor target "${value}"`);
        }
        continue;
      }

      const target = resolveLocalPath(file, value);
      if (!target) continue;

      let exists = fs.existsSync(target);
      if (exists && fs.statSync(target).isDirectory()) {
        exists = fs.existsSync(path.join(target, 'index.html'));
      }
      if (!exists) {
        fail(`${name}: broken local link "${value}" (${relative(target)})`);
        continue;
      }

      if (value.includes('#') && target.endsWith('.html') && fs.statSync(target).isFile()) {
        const fragment = decodeURIComponent(value.split('#')[1] || '');
        if (fragment && !hasFragmentTarget(readHtml(target), fragment)) {
          fail(`${name}: broken anchor "${value}"`);
        }
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Fonts                                                                      */
/* -------------------------------------------------------------------------- */

const fontsCssPath = path.join(ROOT, 'assets', 'fonts.css');
if (!fs.existsSync(fontsCssPath)) {
  fail('assets/fonts.css is missing');
} else {
  const fontsCss = fs.readFileSync(fontsCssPath, 'utf8');
  for (const match of fontsCss.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)) {
    const fontFile = path.resolve(path.dirname(fontsCssPath), match[1]);
    if (!fs.existsSync(fontFile)) {
      fail(`assets/fonts.css references a missing font: ${relative(fontFile)}`);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Release manifest, integrity cache, checksums, pages, and sitemap           */
/* -------------------------------------------------------------------------- */

const manifestPath = path.join(ROOT, 'releases.json');
let manifest = null;
if (!fs.existsSync(manifestPath)) {
  fail('releases.json is missing');
} else {
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    fail(`releases.json is not valid JSON: ${error.message}`);
  }
}

if (manifest) {
  if (!manifest.app || !manifest.latest || !Array.isArray(manifest.releases) || !manifest.releases.length) {
    fail('releases.json must include app, latest, and a non-empty releases array');
  }

  const versions = new Set();
  for (const release of manifest.releases || []) {
    const label = `releases.json ${release.versionName || '(unknown version)'}`;
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(release.versionName || ''))) {
      fail(`${label}: invalid versionName`);
    }
    if (versions.has(release.versionName)) fail(`${label}: duplicate versionName`);
    versions.add(release.versionName);

    if (!/^[0-9A-F]{64}$/.test(String(release.sha256 || ''))) fail(`${label}: invalid SHA-256`);
    if (!/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(String(release.signatureSha256 || ''))) {
      fail(`${label}: invalid signing certificate fingerprint`);
    }
    if (!Number.isInteger(release.sizeBytes) || release.sizeBytes <= 0) fail(`${label}: invalid sizeBytes`);
    if (!release.publishedAt || Number.isNaN(Date.parse(release.publishedAt))) fail(`${label}: invalid publishedAt`);
    if (!release.releaseNotes) fail(`${label}: missing releaseNotes`);

    try {
      const downloadUrl = new URL(release.downloadUrl);
      if (downloadUrl.protocol !== 'https:') fail(`${label}: downloadUrl must use HTTPS`);
      if (downloadUrl.hostname !== 'github.com' || !downloadUrl.pathname.startsWith('/jackbarisere8/DOCMAC/releases/download/')) {
        fail(`${label}: downloadUrl is not an official Docmac GitHub release asset`);
      }
    } catch {
      fail(`${label}: invalid downloadUrl`);
    }

    try {
      const releaseUrl = new URL(release.releaseUrl);
      if (releaseUrl.protocol !== 'https:' || !releaseUrl.pathname.startsWith('/jackbarisere8/DOCMAC/releases/')) {
        fail(`${label}: releaseUrl is not an official Docmac GitHub release`);
      }
    } catch {
      fail(`${label}: invalid releaseUrl`);
    }
  }

  if (manifest.latest?.versionName !== manifest.releases?.[0]?.versionName) {
    fail('releases.json latest does not match the first release entry');
  }
  if (manifest.app?.signingCertSha256 !== manifest.latest?.signatureSha256) {
    fail('releases.json app signing certificate does not match the latest release');
  }

  const integrityPath = path.join(ROOT, 'data', 'apk-integrity.json');
  if (!fs.existsSync(integrityPath)) {
    fail('data/apk-integrity.json is missing');
  } else {
    try {
      const integrity = JSON.parse(fs.readFileSync(integrityPath, 'utf8'));
      for (const release of manifest.releases || []) {
        const record = integrity.releases?.[release.versionName];
        if (!record) {
          fail(`apk-integrity.json is missing ${release.versionName}`);
          continue;
        }
        if (record.sha256 !== release.sha256) fail(`SHA-256 mismatch for ${release.versionName}`);
        if (record.signatureSha256 !== release.signatureSha256) {
          fail(`Signing certificate mismatch for ${release.versionName}`);
        }
        if (record.sizeBytes !== release.sizeBytes) fail(`Size mismatch for ${release.versionName}`);
      }
      for (const version of Object.keys(integrity.releases || {})) {
        if (!versions.has(version)) fail(`apk-integrity.json contains a stale release: ${version}`);
      }
    } catch (error) {
      fail(`data/apk-integrity.json is not valid JSON: ${error.message}`);
    }
  }

  const checksumsPath = path.join(ROOT, 'checksums.txt');
  if (!fs.existsSync(checksumsPath)) {
    fail('checksums.txt is missing');
  } else {
    const checksumLines = fs
      .readFileSync(checksumsPath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));

    const seen = new Set();
    const checksums = new Map();
    for (const line of checksumLines) {
      const match = line.match(/^([0-9a-f]{64})\s{2}(.+)$/i);
      if (!match) {
        fail(`checksums.txt has an invalid line: "${line}"`);
        continue;
      }
      const [, hash, fileName] = match;
      if (seen.has(fileName)) fail(`checksums.txt lists ${fileName} more than once`);
      seen.add(fileName);
      checksums.set(fileName, hash.toUpperCase());
    }

    for (const release of manifest.releases || []) {
      const expectedName = `docmac-${release.versionName}.apk`;
      if (checksums.get(expectedName) !== release.sha256) {
        fail(`checksums.txt does not match the SHA-256 for ${release.versionName}`);
      }
    }
    if (checksums.size !== (manifest.releases || []).length) {
      fail('checksums.txt contains entries that are not in releases.json');
    }
  }

  for (const release of manifest.releases || []) {
    for (const fileName of [`${release.versionName}.html`, `v${release.versionName}.html`]) {
      const releasePage = path.join(ROOT, 'releases', fileName);
      if (!fs.existsSync(releasePage)) {
        fail(`Missing generated release page: releases/${fileName}`);
        continue;
      }
      const page = readHtml(releasePage);
      if (!page.includes(release.sha256)) fail(`releases/${fileName} does not contain the published SHA-256`);
    }
  }

  const sitemapPath = path.join(ROOT, 'sitemap.xml');
  if (!fs.existsSync(sitemapPath)) {
    fail('sitemap.xml is missing');
  } else {
    const sitemap = fs.readFileSync(sitemapPath, 'utf8');
    for (const release of manifest.releases || []) {
      if (release.yanked) continue;
      const loc = `${SITE_URL}/releases/${release.versionName}.html`;
      if (!sitemap.includes(`<loc>${loc}</loc>`)) fail(`sitemap.xml is missing ${loc}`);
    }
    for (const page of ['', 'support.html', 'feedback.html', 'privacy.html', 'terms.html']) {
      const loc = `${SITE_URL}/${page}`;
      if (!sitemap.includes(`<loc>${loc}</loc>`)) fail(`sitemap.xml is missing ${loc}`);
    }
  }
}

/* -------------------------------------------------------------------------- */

for (const message of warnings) console.warn(`warning: ${message}`);

if (errors.length) {
  for (const message of errors) console.error(`ERROR: ${message}`);
  console.error(`\nValidation failed with ${errors.length} error(s).`);
  process.exitCode = 1;
} else {
  console.log(
    `Validated ${htmlFiles.length} HTML files, local links and anchors, fonts, release manifest, checksums, release pages, and sitemap.`,
  );
}
