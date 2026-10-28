/**
 * Database access layer for Cloudflare D1 / SQLite
 */

import type {
  D1DatabaseLike,
  AppRecord,
  SigningCertRecord,
  ReleaseRecord,
  ManifestResponse,
} from './types.ts';

function formatBytes(bytes: number | null): string {
  if (!bytes) return '0 MB';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function getAppBySlug(
  db: D1DatabaseLike,
  slug: string
): Promise<AppRecord | null> {
  const stmt = db.prepare('SELECT * FROM apps WHERE slug = ?').bind(slug);
  const result = await stmt.all<AppRecord>();
  return result.results?.[0] || null;
}

export async function getSigningCert(
  db: D1DatabaseLike,
  appId: string
): Promise<SigningCertRecord | null> {
  const stmt = db
    .prepare('SELECT * FROM signing_certs WHERE app_id = ? AND is_active = 1 ORDER BY created_at DESC')
    .bind(appId);
  const result = await stmt.all<SigningCertRecord>();
  return result.results?.[0] || null;
}

export async function getLatestRelease(
  db: D1DatabaseLike,
  appId: string,
  channel: string = 'stable'
): Promise<ReleaseRecord | null> {
  const stmt = db
    .prepare(
      `SELECT * FROM releases
       WHERE app_id = ? AND channel = ? AND status = 'published'
       ORDER BY is_current DESC, version_code DESC
       LIMIT 1`
    )
    .bind(appId, channel);
  const result = await stmt.all<ReleaseRecord>();
  return result.results?.[0] || null;
}

export async function getReleaseByVersion(
  db: D1DatabaseLike,
  appId: string,
  version: string
): Promise<ReleaseRecord | null> {
  const cleanVersion = version.replace(/^v/i, '');
  const stmt = db
    .prepare(
      `SELECT * FROM releases
       WHERE app_id = ? AND (version_name = ? OR id = ?)
       LIMIT 1`
    )
    .bind(appId, cleanVersion, `rel_${cleanVersion.replace(/\./g, '_')}`);
  const result = await stmt.all<ReleaseRecord>();
  return result.results?.[0] || null;
}

export async function getReleases(
  db: D1DatabaseLike,
  appId: string,
  channel: string = 'stable',
  limit: number = 20,
  offset: number = 0
): Promise<{ releases: ReleaseRecord[]; total: number }> {
  const countStmt = db
    .prepare(
      `SELECT COUNT(*) as total FROM releases
       WHERE app_id = ? AND channel = ? AND status = 'published'`
    )
    .bind(appId, channel);
  const countResult = await countStmt.all<{ total: number }>();
  const total = countResult.results?.[0]?.total || 0;

  const stmt = db
    .prepare(
      `SELECT * FROM releases
       WHERE app_id = ? AND channel = ? AND status = 'published'
       ORDER BY version_code DESC
       LIMIT ? OFFSET ?`
    )
    .bind(appId, channel, limit, offset);
  const result = await stmt.all<ReleaseRecord>();
  return { releases: result.results || [], total };
}

export async function getManifest(
  db: D1DatabaseLike,
  slug: string,
  channel: string = 'stable',
  apiBaseUrl: string = 'https://api.docmac.app/v1',
  cdnBaseUrl: string = 'https://downloads.docmac.app'
): Promise<ManifestResponse | null> {
  const app = await getAppBySlug(db, slug);
  if (!app) return null;

  const cert = await getSigningCert(db, app.id);
  const latest = await getLatestRelease(db, app.id, channel);
  const { releases } = await getReleases(db, app.id, channel, 50, 0);

  return {
    app: {
      slug: app.slug,
      name: app.name,
      packageName: app.package_name,
      platform: app.platform,
      signingCertSha256: cert?.sha256 || latest?.signature_sha256 || '',
    },
    generatedAt: new Date().toISOString(),
    channel,
    latest: latest
      ? {
          versionName: latest.version_name,
          versionCode: latest.version_code,
          publishedAt: latest.published_at || latest.created_at,
          minSdk: latest.min_sdk || 24,
          targetSdk: latest.target_sdk || 35,
          sizeBytes: latest.size_bytes || 0,
          sizeLabel: formatBytes(latest.size_bytes),
          sha256: latest.sha256 || '',
          signatureSha256: latest.signature_sha256 || cert?.sha256 || '',
          downloadUrl: `${apiBaseUrl}/apps/${slug}/releases/${latest.version_name}/download`,
          cdnUrl: `${cdnBaseUrl}/${latest.storage_key}`,
          releaseNotes: latest.release_notes || '',
          forceUpdate: Boolean(latest.force_update),
          yanked: latest.status === 'yanked',
        }
      : null,
    releases: releases.map((r) => ({
      versionName: r.version_name,
      versionCode: r.version_code,
      publishedAt: r.published_at || r.created_at,
      sizeBytes: r.size_bytes || 0,
      sizeLabel: formatBytes(r.size_bytes),
      sha256: r.sha256 || '',
      minSdk: r.min_sdk || 24,
      downloadUrl: `${apiBaseUrl}/apps/${slug}/releases/${r.version_name}/download`,
      releaseNotes: r.release_notes || '',
      yanked: r.status === 'yanked',
    })),
  };
}

export async function recordDownload(
  db: D1DatabaseLike,
  releaseId: string,
  country: string = 'unknown'
): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const safeCountry = country.slice(0, 2).toLowerCase() || 'unknown';

  const stmt = db.prepare(
    `INSERT INTO download_daily (release_id, day, country, count)
     VALUES (?, ?, ?, 1)
     ON CONFLICT (release_id, day, country)
     DO UPDATE SET count = count + 1`
  ).bind(releaseId, day, safeCountry);

  await stmt.run();
}

export async function getChecksumsText(
  db: D1DatabaseLike,
  slug: string
): Promise<string | null> {
  const app = await getAppBySlug(db, slug);
  if (!app) return null;

  const cert = await getSigningCert(db, app.id);
  const latest = await getLatestRelease(db, app.id, 'stable');
  const { releases } = await getReleases(db, app.id, 'stable', 100, 0);

  const lines = [
    `# Docmac Official Android APK SHA-256 Checksums`,
    `# Generated: ${new Date().toISOString()}`,
    `# Signing Certificate SHA-256: ${cert?.sha256 || latest?.signature_sha256 || ''}`,
    `#`,
    `# Verification on Linux/macOS: sha256sum -c checksums.txt`,
    `# Verification on Windows: certutil -hashfile <filename> SHA256`,
    ``,
  ];

  if (latest?.sha256) {
    const lhash = latest.sha256.toLowerCase();
    lines.push(`# Latest release (v${latest.version_name}):`);
    lines.push(`${lhash}  app-release.apk`);
    lines.push(`${lhash}  docmac-${latest.version_name}.apk`);
    lines.push(``);
  }

  lines.push(`# All published releases:`);
  for (const r of releases) {
    if (r.sha256) {
      lines.push(`${r.sha256.toLowerCase()}  docmac-${r.version_name}.apk`);
    }
  }
  lines.push(``);

  return lines.join('\n');
}

export async function getUpdateDecision(
  db: D1DatabaseLike,
  slug: string,
  clientVersionCode: number,
  channel: string = 'stable',
  clientSdk?: number
): Promise<{
  updateAvailable: boolean;
  mandatory: boolean;
  clientVersionYanked?: boolean;
  yankedReason?: string | null;
  latest: {
    versionName: string;
    versionCode: number;
    sha256: string;
    sizeBytes: number;
  } | null;
  minSupportedVersionCode: number;
  downloadUrl: string | null;
  message: string | null;
} | null> {
  const app = await getAppBySlug(db, slug);
  if (!app) return null;

  const latest = await getLatestRelease(db, app.id, channel);
  if (!latest) {
    return {
      updateAvailable: false,
      mandatory: false,
      clientVersionYanked: false,
      latest: null,
      minSupportedVersionCode: 1,
      downloadUrl: null,
      message: null,
    };
  }

  // Check if client version itself is yanked
  const clientReleaseStmt = db.prepare(
    `SELECT status, yanked_reason FROM releases
     WHERE app_id = ? AND channel = ? AND version_code = ?
     LIMIT 1`
  ).bind(app.id, channel, clientVersionCode);
  const clientReleaseRes = await clientReleaseStmt.all<{ status: string; yanked_reason: string | null }>();
  const clientRelease = clientReleaseRes.results?.[0];
  const isClientYanked = clientRelease?.status === 'yanked';

  // Find min_supported floor in channel (defaults to 1 if not set)
  const floorStmt = db.prepare(
    `SELECT MAX(version_code) as floor FROM releases
     WHERE app_id = ? AND channel = ? AND min_supported = 1`
  ).bind(app.id, channel);
  const floorRes = await floorStmt.all<{ floor: number | null }>();
  const minSupportedVersionCode = floorRes.results?.[0]?.floor ?? 1;

  // Check if any security yank exists at or below client's version
  const securityYankStmt = db.prepare(
    `SELECT COUNT(*) as yankCount FROM releases
     WHERE app_id = ? AND channel = ? AND status = 'yanked' AND version_code <= ?`
  ).bind(app.id, channel, clientVersionCode);
  const securityYankRes = await securityYankStmt.all<{ yankCount: number }>();
  const hasSecurityYank = (securityYankRes.results?.[0]?.yankCount || 0) > 0;

  const isNewer = latest.version_code > clientVersionCode;
  const isBelowFloor = clientVersionCode < minSupportedVersionCode;
  const mandatory = isClientYanked || isBelowFloor || Boolean(latest.force_update) || hasSecurityYank;

  let message = isNewer ? latest.release_notes : null;
  if (isClientYanked) {
    message = `Your installed version (build ${clientVersionCode}) has been withdrawn: ${clientRelease?.yanked_reason || 'Security or stability issue'}. Please update to v${latest.version_name}.`;
  }

  const shouldUpdate = isNewer || isClientYanked;
  const downloadUrl = shouldUpdate
    ? `https://api.docmac.app/v1/apps/${slug}/releases/${latest.version_name}/download`
    : null;

  return {
    updateAvailable: shouldUpdate,
    mandatory: shouldUpdate && mandatory,
    clientVersionYanked: isClientYanked,
    yankedReason: isClientYanked ? (clientRelease?.yanked_reason || 'Withdrawn by publisher') : null,
    latest: shouldUpdate
      ? {
          versionName: latest.version_name,
          versionCode: latest.version_code,
          sha256: latest.sha256 || '',
          sizeBytes: latest.size_bytes || 0,
        }
      : null,
    minSupportedVersionCode,
    downloadUrl,
    message,
  };
}

export async function insertFeedback(
  db: D1DatabaseLike,
  data: {
    name?: string | null;
    email?: string | null;
    topic: string;
    message: string;
    ipHash?: string | null;
    userAgent?: string | null;
  }
): Promise<{ ticketId: string; responseExpectation: string }> {
  // Check rate limit if ipHash provided (max 10 submissions per minute)
  if (data.ipHash) {
    const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
    const rateStmt = db.prepare(
      `SELECT COUNT(*) as cnt FROM feedback
       WHERE ip_hash = ? AND created_at >= ?`
    ).bind(data.ipHash, oneMinAgo);
    const rateRes = await rateStmt.all<{ cnt: number }>();
    if ((rateRes.results?.[0]?.cnt || 0) >= 10) {
      const err = new Error('Feedback submission rate limit exceeded. Please wait a moment before sending another message.');
      (err as unknown as { code: string }).code = 'RATE_LIMIT_EXCEEDED';
      throw err;
    }
  }

  const year = new Date().getFullYear();
  const randomSuffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  const ticketId = `DOC-${year}-${randomSuffix}`;
  const now = new Date().toISOString();

  const stmt = db.prepare(
    `INSERT INTO feedback (id, name, email, topic, message, status, ip_hash, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, 'new', ?, ?, ?)`
  ).bind(
    ticketId,
    data.name || null,
    data.email || null,
    data.topic,
    data.message,
    data.ipHash || null,
    data.userAgent || null,
    now
  );

  await stmt.run();
  return {
    ticketId,
    responseExpectation: 'Our team reviews all reports within 24–48 hours.',
  };
}

/* -------------------------------------------------------------------------- */
/* Phase 2: Admin, Verification, Publishing, and Yank Transactions            */
/* -------------------------------------------------------------------------- */

export async function insertAuditLog(
  db: D1DatabaseLike,
  actor: string,
  action: string,
  releaseId: string | null = null,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO audit_log (actor, action, release_id, metadata, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(actor, action, releaseId, JSON.stringify(metadata), now);
  await stmt.run();
}

export async function getReleaseById(
  db: D1DatabaseLike,
  releaseId: string
): Promise<ReleaseRecord | null> {
  const stmt = db.prepare('SELECT * FROM releases WHERE id = ? LIMIT 1').bind(releaseId);
  const result = await stmt.all<ReleaseRecord>();
  return result.results?.[0] || null;
}

export async function createDraftRelease(
  db: D1DatabaseLike,
  params: {
    appId: string;
    versionName: string;
    versionCode: number;
    channel?: 'stable' | 'beta' | 'internal';
    releaseNotes?: string;
    minSdk?: number;
    forceUpdate?: boolean;
    actor: string;
  }
): Promise<ReleaseRecord> {
  const channel = params.channel || 'stable';

  // Check version_code uniqueness within app and channel
  const existingStmt = db.prepare(
    `SELECT id, version_name, status FROM releases
     WHERE app_id = ? AND channel = ? AND version_code = ?
     LIMIT 1`
  ).bind(params.appId, channel, params.versionCode);
  const existingRes = await existingStmt.all<{ id: string; version_name: string; status: string }>();
  if (existingRes.results && existingRes.results.length > 0) {
    const existing = existingRes.results[0];
    const err = new Error(`versionCode ${params.versionCode} already exists in channel ${channel} (release ${existing.version_name}, status: ${existing.status}).`);
    (err as unknown as { code: string }).code = 'VERSION_CODE_CONFLICT';
    throw err;
  }

  const id = `rel_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();
  const quarantineKey = `quarantine/${id}/docmac-${params.versionName}.apk`;
  const fileName = `docmac-${params.versionName}.apk`;

  const stmt = db.prepare(
    `INSERT INTO releases (
       id, app_id, version_name, version_code, channel, status,
       is_current, force_update, min_supported, storage_key, file_name,
       min_sdk, release_notes, verification, created_by, created_at, updated_at
     ) VALUES (
       ?, ?, ?, ?, ?, 'draft',
       0, ?, 0, ?, ?,
       ?, ?, '{}', ?, ?, ?
     )`
  ).bind(
    id,
    params.appId,
    params.versionName,
    params.versionCode,
    channel,
    params.forceUpdate ? 1 : 0,
    quarantineKey,
    fileName,
    params.minSdk || 24,
    params.releaseNotes || '',
    params.actor,
    now,
    now
  );

  await stmt.run();

  await insertAuditLog(db, params.actor, 'release.draft_created', id, {
    versionName: params.versionName,
    versionCode: params.versionCode,
    channel,
  });

  const created = await getReleaseById(db, id);
  if (!created) throw new Error('Failed to retrieve newly created draft release');
  return created;
}

export async function updateReleaseDraft(
  db: D1DatabaseLike,
  releaseId: string,
  actor: string,
  updates: {
    releaseNotes?: string;
    forceUpdate?: boolean;
    minSupported?: boolean;
    channel?: 'stable' | 'beta' | 'internal';
  }
): Promise<ReleaseRecord> {
  const current = await getReleaseById(db, releaseId);
  if (!current) {
    const err = new Error(`Release "${releaseId}" not found.`);
    (err as unknown as { code: string }).code = 'RELEASE_NOT_FOUND';
    throw err;
  }
  if (current.status !== 'draft') {
    const err = new Error(`Only draft releases can be modified. Current status: ${current.status}.`);
    (err as unknown as { code: string }).code = 'INVALID_RELEASE_STATE';
    throw err;
  }

  const notes = updates.releaseNotes !== undefined ? updates.releaseNotes : current.release_notes;
  const force = updates.forceUpdate !== undefined ? (updates.forceUpdate ? 1 : 0) : current.force_update;
  const minSupp = updates.minSupported !== undefined ? (updates.minSupported ? 1 : 0) : current.min_supported;
  const channel = updates.channel || current.channel;
  const now = new Date().toISOString();

  const stmt = db.prepare(
    `UPDATE releases
     SET release_notes = ?, force_update = ?, min_supported = ?, channel = ?, updated_at = ?
     WHERE id = ?`
  ).bind(notes, force, minSupp, channel, now, releaseId);

  await stmt.run();

  await insertAuditLog(db, actor, 'release.draft_updated', releaseId, { updates });

  const updated = await getReleaseById(db, releaseId);
  if (!updated) throw new Error('Failed to retrieve updated release');
  return updated;
}

export async function setReleaseVerifying(
  db: D1DatabaseLike,
  releaseId: string,
  actor: string
): Promise<void> {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `UPDATE releases
     SET status = 'verifying', updated_at = ?
     WHERE id = ?`
  ).bind(now, releaseId);
  await stmt.run();
  await insertAuditLog(db, actor, 'release.verification_started', releaseId);
}

export async function saveVerificationResult(
  db: D1DatabaseLike,
  releaseId: string,
  result: {
    passed: boolean;
    report: Record<string, unknown>;
    sizeBytes?: number;
    sha256?: string;
    sha512?: string;
    signatureSha256?: string;
    packageName?: string;
    minSdk?: number;
    targetSdk?: number;
  }
): Promise<void> {
  const now = new Date().toISOString();
  const current = await getReleaseById(db, releaseId);
  if (!current) throw new Error(`Release "${releaseId}" not found.`);

  if (result.passed) {
    const prodStorageKey = `android/${current.channel}/${current.version_name}/${result.sha256}/docmac-${current.version_name}.apk`;
    const stmt = db.prepare(
      `UPDATE releases
       SET status = 'ready',
           storage_key = ?,
           size_bytes = ?,
           sha256 = ?,
           sha512 = ?,
           signature_sha256 = ?,
           package_name = ?,
           min_sdk = COALESCE(?, min_sdk),
           target_sdk = ?,
           verification = ?,
           updated_at = ?
       WHERE id = ?`
    ).bind(
      prodStorageKey,
      result.sizeBytes || null,
      result.sha256 || null,
      result.sha512 || null,
      result.signatureSha256 || null,
      result.packageName || null,
      result.minSdk || null,
      result.targetSdk || null,
      JSON.stringify(result.report),
      now,
      releaseId
    );
    await stmt.run();
    await insertAuditLog(db, 'verifier-system', 'release.verification_passed', releaseId, {
      sha256: result.sha256,
      signatureSha256: result.signatureSha256,
    });
  } else {
    const stmt = db.prepare(
      `UPDATE releases
       SET status = 'failed',
           verification = ?,
           updated_at = ?
       WHERE id = ?`
    ).bind(JSON.stringify(result.report), now, releaseId);
    await stmt.run();
    await insertAuditLog(db, 'verifier-system', 'release.verification_failed', releaseId, {
      errors: result.report.errors,
    });
  }
}

export async function publishReleaseTransaction(
  db: D1DatabaseLike,
  releaseId: string,
  actor: string
): Promise<ReleaseRecord> {
  const release = await getReleaseById(db, releaseId);
  if (!release) {
    const err = new Error(`Release "${releaseId}" not found.`);
    (err as unknown as { code: string }).code = 'RELEASE_NOT_FOUND';
    throw err;
  }
  if (release.status !== 'ready') {
    const err = new Error(`Only releases with status "ready" can be published. Current status: ${release.status}.`);
    (err as unknown as { code: string }).code = 'INVALID_RELEASE_STATE';
    throw err;
  }

  const now = new Date().toISOString();

  // Clear is_current on all other published releases in this app & channel
  const clearCurrentStmt = db.prepare(
    `UPDATE releases
     SET is_current = 0, updated_at = ?
     WHERE app_id = ? AND channel = ? AND is_current = 1`
  ).bind(now, release.app_id, release.channel);
  await clearCurrentStmt.run();

  // Set this release to published and current
  const publishStmt = db.prepare(
    `UPDATE releases
     SET status = 'published',
         is_current = 1,
         published_at = ?,
         updated_at = ?
     WHERE id = ?`
  ).bind(now, now, releaseId);
  await publishStmt.run();

  await insertAuditLog(db, actor, 'release.publish', releaseId, {
    versionName: release.version_name,
    versionCode: release.version_code,
    channel: release.channel,
    sha256: release.sha256,
  });

  const published = await getReleaseById(db, releaseId);
  if (!published) throw new Error('Failed to retrieve published release');
  return published;
}

export async function yankReleaseTransaction(
  db: D1DatabaseLike,
  releaseId: string,
  actor: string,
  reason: string
): Promise<ReleaseRecord> {
  const release = await getReleaseById(db, releaseId);
  if (!release) {
    const err = new Error(`Release "${releaseId}" not found.`);
    (err as unknown as { code: string }).code = 'RELEASE_NOT_FOUND';
    throw err;
  }
  if (release.status === 'yanked') {
    const err = new Error(`Release "${release.version_name}" is already yanked.`);
    (err as unknown as { code: string }).code = 'ALREADY_YANKED';
    throw err;
  }

  const now = new Date().toISOString();
  const wasCurrent = release.is_current === 1;

  // Mark release as yanked
  const yankStmt = db.prepare(
    `UPDATE releases
     SET status = 'yanked',
         is_current = 0,
         yanked_at = ?,
         yanked_reason = ?,
         updated_at = ?
     WHERE id = ?`
  ).bind(now, reason, now, releaseId);
  await yankStmt.run();

  // If this release was current, promote highest non-yanked published release
  if (wasCurrent) {
    const highestPublishedStmt = db.prepare(
      `SELECT id FROM releases
       WHERE app_id = ? AND channel = ? AND status = 'published' AND id != ?
       ORDER BY version_code DESC
       LIMIT 1`
    ).bind(release.app_id, release.channel, releaseId);
    const highestRes = await highestPublishedStmt.all<{ id: string }>();
    if (highestRes.results && highestRes.results.length > 0) {
      const nextCurrentId = highestRes.results[0].id;
      const promoteStmt = db.prepare(
        `UPDATE releases
         SET is_current = 1, updated_at = ?
         WHERE id = ?`
      ).bind(now, nextCurrentId);
      await promoteStmt.run();
    }
  }

  await insertAuditLog(db, actor, 'release.yank', releaseId, {
    reason,
    versionName: release.version_name,
    versionCode: release.version_code,
    wasCurrent,
  });

  const yanked = await getReleaseById(db, releaseId);
  if (!yanked) throw new Error('Failed to retrieve yanked release');
  return yanked;
}

export async function deleteDraftRelease(
  db: D1DatabaseLike,
  releaseId: string,
  actor: string
): Promise<void> {
  const release = await getReleaseById(db, releaseId);
  if (!release) {
    const err = new Error(`Release "${releaseId}" not found.`);
    (err as unknown as { code: string }).code = 'RELEASE_NOT_FOUND';
    throw err;
  }
  if (release.status !== 'draft') {
    const err = new Error(`Only draft releases can be deleted. Published and historical releases are immutable. Current status: ${release.status}.`);
    (err as unknown as { code: string }).code = 'IMMUTABLE_RELEASE';
    throw err;
  }

  const stmt = db.prepare('DELETE FROM releases WHERE id = ?').bind(releaseId);
  await stmt.run();

  await insertAuditLog(db, actor, 'release.draft_deleted', releaseId, {
    versionName: release.version_name,
    versionCode: release.version_code,
  });
}

export async function listAdminReleases(
  db: D1DatabaseLike,
  appId: string,
  options: {
    channel?: string;
    status?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ releases: ReleaseRecord[]; total: number }> {
  const limit = options.limit || 50;
  const offset = options.offset || 0;

  let query = 'SELECT * FROM releases WHERE app_id = ?';
  let countQuery = 'SELECT COUNT(*) as total FROM releases WHERE app_id = ?';
  const params: unknown[] = [appId];
  const countParams: unknown[] = [appId];

  if (options.channel) {
    query += ' AND channel = ?';
    countQuery += ' AND channel = ?';
    params.push(options.channel);
    countParams.push(options.channel);
  }
  if (options.status) {
    query += ' AND status = ?';
    countQuery += ' AND status = ?';
    params.push(options.status);
    countParams.push(options.status);
  }

  query += ' ORDER BY version_code DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const countStmt = db.prepare(countQuery).bind(...countParams);
  const countRes = await countStmt.all<{ total: number }>();
  const total = countRes.results?.[0]?.total || 0;

  const stmt = db.prepare(query).bind(...params);
  const res = await stmt.all<ReleaseRecord>();

  return { releases: res.results || [], total };
}

export async function getAuditLogs(
  db: D1DatabaseLike,
  limit: number = 50,
  offset: number = 0
): Promise<{ logs: unknown[]; total: number }> {
  const countStmt = db.prepare('SELECT COUNT(*) as total FROM audit_log');
  const countRes = await countStmt.all<{ total: number }>();
  const total = countRes.results?.[0]?.total || 0;

  const stmt = db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?').bind(limit, offset);
  const res = await stmt.all<unknown>();
  return { logs: res.results || [], total };
}

export async function verifyApiToken(
  db: D1DatabaseLike,
  tokenHash: string
): Promise<{ id: string; name: string; scopes: string[] } | null> {
  const stmt = db.prepare(
    `SELECT id, name, scopes, expires_at FROM api_tokens
     WHERE token_hash = ?
     LIMIT 1`
  ).bind(tokenHash);
  const res = await stmt.all<{ id: string; name: string; scopes: string; expires_at: string | null }>();
  const token = res.results?.[0];
  if (!token) return null;

  if (token.expires_at && new Date(token.expires_at).getTime() < Date.now()) {
    return null; // Expired
  }

  // Update last_used_at
  const updateStmt = db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), token.id);
  await updateStmt.run();

  let scopes: string[] = [];
  try {
    scopes = token.scopes.startsWith('[') ? JSON.parse(token.scopes) : token.scopes.split(',').map((s) => s.trim());
  } catch {
    scopes = token.scopes.split(',').map((s) => s.trim());
  }

  return { id: token.id, name: token.name, scopes };
}

export async function createApiToken(
  db: D1DatabaseLike,
  name: string,
  tokenHash: string,
  scopes: string[],
  expiresAt: string | null = null
): Promise<string> {
  const id = `tok_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO api_tokens (id, name, token_hash, scopes, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, name, tokenHash, JSON.stringify(scopes), expiresAt, now);
  await stmt.run();
  return id;
}

export async function addSigningCert(
  db: D1DatabaseLike,
  appId: string,
  sha256: string,
  subject: string = 'CN=Docmac Official'
): Promise<string> {
  const id = `cert_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO signing_certs (id, app_id, sha256, subject, is_active, created_at)
     VALUES (?, ?, ?, ?, 1, ?)`
  ).bind(id, appId, sha256.toUpperCase(), subject, now);
  await stmt.run();
  return id;
}

export async function getAdminStats(
  db: D1DatabaseLike,
  appId: string
): Promise<{
  totalPublished: number;
  totalDrafts: number;
  totalYanked: number;
  totalDownloads: number;
  recentDownloads: Array<{ day: string; country: string; count: number }>;
}> {
  const countsStmt = db.prepare(
    `SELECT
       SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) as totalPublished,
       SUM(CASE WHEN status IN ('draft', 'uploading', 'verifying', 'ready') THEN 1 ELSE 0 END) as totalDrafts,
       SUM(CASE WHEN status = 'yanked' THEN 1 ELSE 0 END) as totalYanked
     FROM releases WHERE app_id = ?`
  ).bind(appId);
  const countsRes = await countsStmt.all<{ totalPublished: number; totalDrafts: number; totalYanked: number }>();
  const counts = countsRes.results?.[0] || { totalPublished: 0, totalDrafts: 0, totalYanked: 0 };

  const dlStmt = db.prepare(
    `SELECT COALESCE(SUM(count), 0) as totalDownloads FROM download_daily
     WHERE release_id IN (SELECT id FROM releases WHERE app_id = ?)`
  ).bind(appId);
  const dlRes = await dlStmt.all<{ totalDownloads: number }>();
  const totalDownloads = dlRes.results?.[0]?.totalDownloads || 0;

  const recentStmt = db.prepare(
    `SELECT day, country, SUM(count) as count FROM download_daily
     WHERE release_id IN (SELECT id FROM releases WHERE app_id = ?)
     GROUP BY day, country
     ORDER BY day DESC
     LIMIT 30`
  ).bind(appId);
  const recentRes = await recentStmt.all<{ day: string; country: string; count: number }>();

  const byVersionStmt = db.prepare(
    `SELECT r.version_name, r.version_code, r.channel, COALESCE(SUM(d.count), 0) as downloads
     FROM releases r
     LEFT JOIN download_daily d ON r.id = d.release_id
     WHERE r.app_id = ?
     GROUP BY r.id
     ORDER BY r.version_code DESC`
  ).bind(appId);
  const byVersionRes = await byVersionStmt.all<{ version_name: string; version_code: number; channel: string; downloads: number }>();

  return {
    totalPublished: counts.totalPublished || 0,
    totalDrafts: counts.totalDrafts || 0,
    totalYanked: counts.totalYanked || 0,
    totalDownloads,
    recentDownloads: recentRes.results || [],
    downloadsByVersion: byVersionRes.results || [],
  };
}

export async function listFeedback(
  db: D1DatabaseLike,
  options: { status?: string; limit?: number; offset?: number } = {}
): Promise<{ feedback: unknown[]; total: number }> {
  const limit = options.limit || 50;
  const offset = options.offset || 0;

  let query = 'SELECT * FROM feedback';
  let countQuery = 'SELECT COUNT(*) as total FROM feedback';
  const params: unknown[] = [];
  const countParams: unknown[] = [];

  if (options.status) {
    query += ' WHERE status = ?';
    countQuery += ' WHERE status = ?';
    params.push(options.status);
    countParams.push(options.status);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const countStmt = db.prepare(countQuery).bind(...countParams);
  const countRes = await countStmt.all<{ total: number }>();
  const total = countRes.results?.[0]?.total || 0;

  const stmt = db.prepare(query).bind(...params);
  const res = await stmt.all<unknown>();

  return { feedback: res.results || [], total };
}

export async function updateFeedbackStatus(
  db: D1DatabaseLike,
  id: string,
  status: 'new' | 'read' | 'replied' | 'closed' | 'spam'
): Promise<void> {
  const stmt = db.prepare('UPDATE feedback SET status = ? WHERE id = ?').bind(status, id);
  await stmt.run();
}

