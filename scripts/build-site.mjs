#!/usr/bin/env node
/**
 * Stages the public website into _site/ for GitHub Pages.
 *
 * Only deployable files are copied. Source code, documentation, scripts,
 * cached APKs, and Cloudflare-only configuration never reach the artifact.
 *
 * Usage: node scripts/build-site.mjs
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SITE_DIR = path.join(ROOT, '_site');

const PUBLIC_FILES = [
  '404.html',
  'index.html',
  'support.html',
  'feedback.html',
  'privacy.html',
  'terms.html',
  'releases.json',
  'checksums.txt',
  'site.webmanifest',
  'sitemap.xml',
  'robots.txt',
];

const PUBLIC_DIRECTORIES = ['assets', 'releases', '.well-known'];

async function copyEntry(source, destination) {
  const stat = await fsp.stat(source);
  if (stat.isDirectory()) {
    await fsp.cp(source, destination, { recursive: true, force: true });
  } else {
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await fsp.copyFile(source, destination);
  }
}

async function main() {
  await fsp.rm(SITE_DIR, { recursive: true, force: true });
  await fsp.mkdir(SITE_DIR, { recursive: true });

  const copied = [];

  for (const file of PUBLIC_FILES) {
    const source = path.join(ROOT, file);
    if (!fs.existsSync(source)) {
      throw new Error(`Required public file is missing: ${file}`);
    }
    await copyEntry(source, path.join(SITE_DIR, file));
    copied.push(file);
  }

  for (const directory of PUBLIC_DIRECTORIES) {
    const source = path.join(ROOT, directory);
    if (!fs.existsSync(source)) {
      throw new Error(`Required public directory is missing: ${directory}`);
    }
    await copyEntry(source, path.join(SITE_DIR, directory));
    copied.push(`${directory}/`);
  }

  // RFC 9116 defines /.well-known/security.txt. Keep a root copy as a
  // compatibility fallback for clients that only request /security.txt.
  await fsp.copyFile(
    path.join(ROOT, '.well-known', 'security.txt'),
    path.join(SITE_DIR, 'security.txt'),
  );
  copied.push('security.txt');

  // Browsers and some feed readers still probe /favicon.ico directly. The
  // pages reference the PNG icons, so stage the packaged ICO at the root too.
  await fsp.copyFile(
    path.join(ROOT, 'assets', 'images', 'favicon.ico'),
    path.join(SITE_DIR, 'favicon.ico'),
  );
  copied.push('favicon.ico');

  // GitHub Pages runs Jekyll unless this marker file is present.
  await fsp.writeFile(path.join(SITE_DIR, '.nojekyll'), '', 'utf8');
  copied.push('.nojekyll');

  const bytes = await directorySize(SITE_DIR);
  console.log(
    `Staged ${copied.length} public entries into ${path.relative(ROOT, SITE_DIR)} (${(bytes / 1024 / 1024).toFixed(2)} MB).`,
  );
  console.log('Excluded: backend/, verifier/, scripts/, docs/, data/, .cache/, .git/, _headers, _redirects.');
}

async function directorySize(directory) {
  let total = 0;
  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(fullPath);
    } else if (entry.isFile()) {
      total += (await fsp.stat(fullPath)).size;
    }
  }
  return total;
}

main().catch((error) => {
  console.error('[site] FAILED:', error);
  process.exitCode = 1;
});
