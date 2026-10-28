#!/usr/bin/env node
/**
 * Imports existing releases from releases.json into D1 SQLite seed file.
 * Run: node backend/scripts/import-releases.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const RELEASES_PATH = path.join(ROOT, 'releases.json');
const OUTPUT_SQL = path.join(ROOT, 'backend', 'migrations', '0002_seed_releases.sql');

function escapeSql(str) {
  if (str === null || str === undefined) return 'NULL';
  return `'${String(str).replace(/'/g, "''")}'`;
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(RELEASES_PATH, 'utf8'));
  const app = manifest.app;
  const latest = manifest.latest;
  const releases = manifest.releases;

  const sqlStatements = [
    '-- Seed initial application and historical releases imported from releases.json',
    '-- Generated automatically by backend/scripts/import-releases.mjs',
    '',
    `INSERT OR IGNORE INTO apps (id, slug, name, package_name, platform, website_url, privacy_url, created_at)
VALUES (
  'app_docmac',
  ${escapeSql(app.slug || 'docmac')},
  ${escapeSql(app.name || 'Docmac')},
  ${escapeSql(app.packageName || 'com.docmac.app')},
  ${escapeSql(app.platform || 'android')},
  ${escapeSql(app.website || 'https://jackbarisere8.github.io/DOCMAC_WEBSITE/')},
  ${escapeSql('https://jackbarisere8.github.io/DOCMAC_WEBSITE/privacy.html')},
  '2026-08-18T15:36:04Z'
);`,
    '',
    `INSERT OR IGNORE INTO signing_certs (id, app_id, sha256, subject, valid_from, valid_to, is_active, created_at)
VALUES (
  'cert_docmac_prod_1',
  'app_docmac',
  ${escapeSql(app.signingCertSha256 || latest.signatureSha256)},
  ${escapeSql(latest.certificateSubject || 'C=ng, ST=akwa ibom, L=uyo, O=docmac, OU=docmac, CN=jack barisere')},
  '2026-08-01T00:00:00Z',
  '2051-08-01T00:00:00Z',
  1,
  '2026-08-18T15:36:04Z'
);`,
    '',
  ];

  // Map version strings like '1.0.4' to integer versionCode e.g. 104
  function parseVersionCode(v, index) {
    const parts = v.split('.').map(Number);
    if (parts.length >= 3 && !parts.some(Number.isNaN)) {
      return parts[0] * 10000 + parts[1] * 100 + parts[2];
    }
    return 100 + index;
  }

  for (let i = 0; i < releases.length; i++) {
    const r = releases[i];
    const isCurrent = r.tag === latest.tag ? 1 : 0;
    const vCode = r.versionCode || parseVersionCode(r.versionName, releases.length - 1 - i);
    const relId = `rel_${r.versionName.replace(/\./g, '_')}`;
    const storageKey = `android/${r.channel || 'stable'}/${r.versionName}/${r.sha256.slice(0, 16).toLowerCase()}/docmac-${r.versionName}.apk`;
    const fileName = `docmac-${r.versionName}.apk`;

    sqlStatements.push(`INSERT OR REPLACE INTO releases (
  id, app_id, version_name, version_code, channel, status, is_current,
  force_update, min_supported, storage_key, file_name, size_bytes,
  sha256, sha512, signature_sha256, package_name, min_sdk, target_sdk, abis,
  release_notes, published_at, verification, created_by, created_at, updated_at
) VALUES (
  ${escapeSql(relId)},
  'app_docmac',
  ${escapeSql(r.versionName)},
  ${vCode},
  ${escapeSql(r.channel || 'stable')},
  'published',
  ${isCurrent},
  ${r.forceUpdate ? 1 : 0},
  ${r.versionName === '1.0.0' ? 1 : 0},
  ${escapeSql(storageKey)},
  ${escapeSql(fileName)},
  ${r.sizeBytes || 0},
  ${escapeSql(r.sha256)},
  ${escapeSql(r.sha512 || null)},
  ${escapeSql(r.signatureSha256)},
  'com.docmac.app',
  ${r.minSdk || 24},
  35,
  '["universal"]',
  ${escapeSql(r.releaseNotes)},
  ${escapeSql(r.publishedAt)},
  '{"verified":true,"verifier":"system.migration"}',
  'jackbarisere8',
  ${escapeSql(r.publishedAt)},
  ${escapeSql(r.publishedAt)}
);`);

    sqlStatements.push(`INSERT OR IGNORE INTO download_daily (release_id, day, country, count)
VALUES (${escapeSql(relId)}, '2026-10-23', 'global', ${r.downloads || 0});`);

    sqlStatements.push(`INSERT INTO audit_log (actor, action, release_id, metadata, created_at)
VALUES ('system.migration', 'release.import', ${escapeSql(relId)}, '{"version":"${r.versionName}"}', datetime('now'));`);
    sqlStatements.push('');
  }

  fs.mkdirSync(path.dirname(OUTPUT_SQL), { recursive: true });
  fs.writeFileSync(OUTPUT_SQL, sqlStatements.join('\n') + '\n', 'utf8');
  console.log(`Generated ${path.relative(ROOT, OUTPUT_SQL)} with ${releases.length} releases.`);
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});

