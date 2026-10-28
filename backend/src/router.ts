/**
 * HTTP Router for Docmac Release Service
 * Fully implements Section 7 of docs/BACKEND_ARCHITECTURE.md
 */

import crypto from 'node:crypto';
import type { Env } from './types.ts';
import { problemResponse } from './errors.ts';
import {
  getAppBySlug,
  getManifest,
  getReleases,
  getLatestRelease,
  getReleaseByVersion,
  recordDownload,
  getChecksumsText,
  getUpdateDecision,
  insertFeedback,
  createDraftRelease,
  getReleaseById,
  updateReleaseDraft,
  setReleaseVerifying,
  saveVerificationResult,
  publishReleaseTransaction,
  yankReleaseTransaction,
  deleteDraftRelease,
  listAdminReleases,
  getAuditLogs,
  verifyApiToken,
  createApiToken,
  addSigningCert,
  getAdminStats,
  listFeedback,
  updateFeedbackStatus,
} from './db.ts';
import { verifyApk } from './verifier.ts';
import { renderAdminHtml } from './admin-ui.ts';

// In-memory quarantine buffer cache (bridges uploads across serverless requests)
const quarantineStore = new Map<string, Buffer>();

function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

interface AuthResult {
  authenticated: boolean;
  actor: string;
  scopes: string[];
  error?: string;
}

async function authenticateAdmin(request: Request, env: Env): Promise<AuthResult> {
  // 1. Cloudflare Access JWT / Email header
  const cfAccessEmail = request.headers.get('cf-access-authenticated-user-email');
  if (cfAccessEmail) {
    return { authenticated: true, actor: cfAccessEmail, scopes: ['release:write', 'release:publish'] };
  }

  // 2. Authorization: Bearer <token>
  const authHeader = request.headers.get('authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    const rawToken = authHeader.slice(7).trim();
    if (rawToken) {
      if (
        rawToken === 'docmac_admin_dev_secret' &&
        (env.ENVIRONMENT === 'development' || env.ENVIRONMENT === 'test')
      ) {
        return { authenticated: true, actor: 'dev-admin', scopes: ['release:write', 'release:publish'] };
      }
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const tokenInfo = await verifyApiToken(env.DB, tokenHash);
      if (tokenInfo) {
        return { authenticated: true, actor: tokenInfo.name, scopes: tokenInfo.scopes };
      }
    }
  }

  // 3. Dev / Test environment bypass
  const adminKey = request.headers.get('x-admin-key');
  if (adminKey && (env.ENVIRONMENT === 'test' || env.ENVIRONMENT === 'development')) {
    return { authenticated: true, actor: 'test-admin', scopes: ['release:write', 'release:publish'] };
  }

  return { authenticated: false, actor: '', scopes: [], error: 'Authentication required. Missing Cloudflare Access or valid Bearer token.' };
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const requestId = request.headers.get('x-request-id') || generateRequestId();
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  // Common CORS and security hardening headers (Section 11 of BACKEND_ARCHITECTURE.md)
  const origin = request.headers.get('Origin') || '*';
  const corsHeaders = {
    'Access-Control-Allow-Origin': origin === 'null' ? '*' : origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-Id, X-Admin-Key, X-Verify-Options',
    'Access-Control-Max-Age': '86400',
    'X-Request-Id': requestId,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  };

  // Handle CORS Preflight
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    /* ---------------------------------------------------------------------- */
    /* Health Check                                                           */
    /* ---------------------------------------------------------------------- */
    if (path === '/healthz' && method === 'GET') {
      return new Response(
        JSON.stringify(
          {
            status: 'ok',
            timestamp: new Date().toISOString(),
            environment: env.ENVIRONMENT || 'production',
            version: '1.0.0',
          },
          null,
          2
        ) + '\n',
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            ...corsHeaders,
          },
        }
      );
    }

    /* ---------------------------------------------------------------------- */
    /* App Manifest: GET /v1/apps/:slug/manifest.json                          */
    /* ---------------------------------------------------------------------- */
    const manifestMatch = path.match(/^\/v1\/apps\/([a-zA-Z0-9_-]+)\/manifest\.json$/);
    if (manifestMatch && method === 'GET') {
      const slug = manifestMatch[1];
      const channel = url.searchParams.get('channel') || 'stable';
      const cdnBase = env.CDN_BASE_URL || 'https://downloads.docmac.app';
      const apiBase = `${url.origin}/v1`;

      const manifest = await getManifest(env.DB, slug, channel, apiBase, cdnBase);
      if (!manifest) {
        return problemResponse(
          404,
          'APP_NOT_FOUND',
          'Application Not Found',
          `No application found with slug "${slug}".`,
          requestId,
          corsHeaders
        );
      }

      return new Response(JSON.stringify(manifest, null, 2) + '\n', {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=60',
          'ETag': `"${manifest.generatedAt.slice(0, 19)}"`,
          ...corsHeaders,
        },
      });
    }

    /* ---------------------------------------------------------------------- */
    /* Checksums: GET /v1/apps/:slug/checksums.txt                            */
    /* ---------------------------------------------------------------------- */
    const checksumsMatch = path.match(/^\/v1\/apps\/([a-zA-Z0-9_-]+)\/checksums\.txt$/);
    if (checksumsMatch && method === 'GET') {
      const slug = checksumsMatch[1];
      const txt = await getChecksumsText(env.DB, slug);
      if (!txt) {
        return problemResponse(
          404,
          'APP_NOT_FOUND',
          'Application Not Found',
          `No application found with slug "${slug}".`,
          requestId,
          corsHeaders
        );
      }

      return new Response(txt, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
          ...corsHeaders,
        },
      });
    }

    /* ---------------------------------------------------------------------- */
    /* Latest Release: GET /v1/apps/:slug/releases/latest                     */
    /* ---------------------------------------------------------------------- */
    const latestReleaseMatch = path.match(/^\/v1\/apps\/([a-zA-Z0-9_-]+)\/releases\/latest$/);
    if (latestReleaseMatch && method === 'GET') {
      const slug = latestReleaseMatch[1];
      const channel = url.searchParams.get('channel') || 'stable';
      const app = await getAppBySlug(env.DB, slug);
      if (!app) {
        return problemResponse(
          404,
          'APP_NOT_FOUND',
          'Application Not Found',
          `No application found with slug "${slug}".`,
          requestId,
          corsHeaders
        );
      }

      const release = await getLatestRelease(env.DB, app.id, channel);
      if (!release) {
        return problemResponse(
          404,
          'RELEASE_NOT_FOUND',
          'No Releases Found',
          `No published releases found for "${slug}" on channel "${channel}".`,
          requestId,
          corsHeaders
        );
      }

      const cdnBase = env.CDN_BASE_URL || 'https://downloads.docmac.app';
      return new Response(
        JSON.stringify(
          {
            versionName: release.version_name,
            versionCode: release.version_code,
            channel: release.channel,
            publishedAt: release.published_at || release.created_at,
            minSdk: release.min_sdk || 24,
            targetSdk: release.target_sdk || 35,
            sizeBytes: release.size_bytes || 0,
            sha256: release.sha256,
            signatureSha256: release.signature_sha256,
            downloadUrl: `${url.origin}/v1/apps/${slug}/releases/${release.version_name}/download`,
            cdnUrl: `${cdnBase}/${release.storage_key}`,
            releaseNotes: release.release_notes,
            forceUpdate: Boolean(release.force_update),
          },
          null,
          2
        ) + '\n',
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=30',
            ...corsHeaders,
          },
        }
      );
    }

    /* ---------------------------------------------------------------------- */
    /* Releases List: GET /v1/apps/:slug/releases                             */
    /* ---------------------------------------------------------------------- */
    const releasesListMatch = path.match(/^\/v1\/apps\/([a-zA-Z0-9_-]+)\/releases$/);
    if (releasesListMatch && method === 'GET') {
      const slug = releasesListMatch[1];
      const channel = url.searchParams.get('channel') || 'stable';
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10)));
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10));

      const app = await getAppBySlug(env.DB, slug);
      if (!app) {
        return problemResponse(
          404,
          'APP_NOT_FOUND',
          'Application Not Found',
          `No application found with slug "${slug}".`,
          requestId,
          corsHeaders
        );
      }

      const { releases, total } = await getReleases(env.DB, app.id, channel, limit, offset);
      const cdnBase = env.CDN_BASE_URL || 'https://downloads.docmac.app';

      return new Response(
        JSON.stringify(
          {
            total,
            limit,
            offset,
            releases: releases.map((r) => ({
              versionName: r.version_name,
              versionCode: r.version_code,
              channel: r.channel,
              status: r.status,
              isCurrent: Boolean(r.is_current),
              publishedAt: r.published_at || r.created_at,
              minSdk: r.min_sdk || 24,
              sizeBytes: r.size_bytes || 0,
              sha256: r.sha256,
              signatureSha256: r.signature_sha256,
              downloadUrl: `${url.origin}/v1/apps/${slug}/releases/${r.version_name}/download`,
              cdnUrl: `${cdnBase}/${r.storage_key}`,
              releaseNotes: r.release_notes,
            })),
          },
          null,
          2
        ) + '\n',
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=60',
            ...corsHeaders,
          },
        }
      );
    }

    /* ---------------------------------------------------------------------- */
    /* Single Release: GET /v1/apps/:slug/releases/:version                   */
    /* ---------------------------------------------------------------------- */
    const singleReleaseMatch = path.match(/^\/v1\/apps\/([a-zA-Z0-9_-]+)\/releases\/([a-zA-Z0-9._-]+)$/);
    if (singleReleaseMatch && method === 'GET') {
      const slug = singleReleaseMatch[1];
      const version = singleReleaseMatch[2];

      const app = await getAppBySlug(env.DB, slug);
      if (!app) {
        return problemResponse(
          404,
          'APP_NOT_FOUND',
          'Application Not Found',
          `No application found with slug "${slug}".`,
          requestId,
          corsHeaders
        );
      }

      const release = await getReleaseByVersion(env.DB, app.id, version);
      if (!release) {
        return problemResponse(
          404,
          'RELEASE_NOT_FOUND',
          'Release Not Found',
          `Release "${version}" for application "${slug}" was not found.`,
          requestId,
          corsHeaders
        );
      }

      const cdnBase = env.CDN_BASE_URL || 'https://downloads.docmac.app';
      return new Response(
        JSON.stringify(
          {
            versionName: release.version_name,
            versionCode: release.version_code,
            channel: release.channel,
            status: release.status,
            isCurrent: Boolean(release.is_current),
            publishedAt: release.published_at || release.created_at,
            minSdk: release.min_sdk || 24,
            targetSdk: release.target_sdk || 35,
            sizeBytes: release.size_bytes || 0,
            sha256: release.sha256,
            sha512: release.sha512,
            signatureSha256: release.signature_sha256,
            downloadUrl: `${url.origin}/v1/apps/${slug}/releases/${release.version_name}/download`,
            cdnUrl: `${cdnBase}/${release.storage_key}`,
            releaseNotes: release.release_notes,
            yanked: release.status === 'yanked',
            yankedReason: release.yanked_reason || null,
          },
          null,
          2
        ) + '\n',
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=300',
            ...corsHeaders,
          },
        }
      );
    }

    /* ---------------------------------------------------------------------- */
    /* Release Download: GET /v1/apps/:slug/releases/:version/download        */
    /* ---------------------------------------------------------------------- */
    const downloadMatch = path.match(/^\/v1\/apps\/([a-zA-Z0-9_-]+)\/releases\/([a-zA-Z0-9._-]+)\/download$/);
    if (downloadMatch && method === 'GET') {
      const slug = downloadMatch[1];
      const version = downloadMatch[2];

      const app = await getAppBySlug(env.DB, slug);
      if (!app) {
        return problemResponse(
          404,
          'APP_NOT_FOUND',
          'Application Not Found',
          `No application found with slug "${slug}".`,
          requestId,
          corsHeaders
        );
      }

      const release = await getReleaseByVersion(env.DB, app.id, version);
      if (!release) {
        return problemResponse(
          404,
          'RELEASE_NOT_FOUND',
          'Release Not Found',
          `Release "${version}" was not found.`,
          requestId,
          corsHeaders
        );
      }

      // Record download telemetry
      const country = request.headers.get('cf-ipcountry') || 'unknown';
      try {
        await recordDownload(env.DB, release.id, country);
      } catch (err) {
        console.error('Failed to count download:', err);
      }

      const cdnBase = env.CDN_BASE_URL || 'https://downloads.docmac.app';
      const downloadLocation = release.storage_key
        ? `${cdnBase}/${release.storage_key}`
        : `https://github.com/jackbarisere8/DOCMAC/releases/download/v${release.version_name}/app-release.apk`;

      // 302 Found redirect
      return new Response(null, {
        status: 302,
        headers: {
          Location: downloadLocation,
          'Cache-Control': 'no-store',
          'X-Checksum-Sha256': release.sha256 || '',
          ...corsHeaders,
        },
      });
    }

    /* ---------------------------------------------------------------------- */
    /* Latest Download: GET /v1/apps/:slug/download/latest                    */
    /* ---------------------------------------------------------------------- */
    const latestDownloadMatch = path.match(/^\/v1\/apps\/([a-zA-Z0-9_-]+)\/download\/latest$/);
    if (latestDownloadMatch && method === 'GET') {
      const slug = latestDownloadMatch[1];
      const channel = url.searchParams.get('channel') || 'stable';

      const app = await getAppBySlug(env.DB, slug);
      if (!app) {
        return problemResponse(
          404,
          'APP_NOT_FOUND',
          'Application Not Found',
          `No application found with slug "${slug}".`,
          requestId,
          corsHeaders
        );
      }

      const release = await getLatestRelease(env.DB, app.id, channel);
      if (!release) {
        return problemResponse(
          404,
          'RELEASE_NOT_FOUND',
          'Release Not Found',
          `No latest release found for "${slug}".`,
          requestId,
          corsHeaders
        );
      }

      const country = request.headers.get('cf-ipcountry') || 'unknown';
      try {
        await recordDownload(env.DB, release.id, country);
      } catch (err) {}

      const cdnBase = env.CDN_BASE_URL || 'https://downloads.docmac.app';
      const downloadLocation = release.storage_key
        ? `${cdnBase}/${release.storage_key}`
        : `https://github.com/jackbarisere8/DOCMAC/releases/download/v${release.version_name}/app-release.apk`;

      return new Response(null, {
        status: 302,
        headers: {
          Location: downloadLocation,
          'Cache-Control': 'no-store',
          'X-Checksum-Sha256': release.sha256 || '',
          ...corsHeaders,
        },
      });
    }

    /* ---------------------------------------------------------------------- */
    /* In-App Update Decision: GET /v1/apps/:slug/update or GET /update       */
    /* ---------------------------------------------------------------------- */
    const updateMatch = path.match(/^\/v1\/apps\/([a-zA-Z0-9_-]+)\/update$/);
    const isShortUpdate = (path === '/update' || path === '/v1/update') && method === 'GET';
    if ((updateMatch || isShortUpdate) && method === 'GET') {
      const slug = updateMatch ? updateMatch[1] : (env.APP_SLUG || 'docmac');
      const versionCode = parseInt(url.searchParams.get('versionCode') || '0', 10);
      const channel = url.searchParams.get('channel') || 'stable';
      const sdk = parseInt(url.searchParams.get('sdk') || '0', 10);

      const decision = await getUpdateDecision(env.DB, slug, versionCode, channel, sdk);
      if (!decision) {
        return problemResponse(
          404,
          'APP_NOT_FOUND',
          'Application Not Found',
          `No application found with slug "${slug}".`,
          requestId,
          corsHeaders
        );
      }

      // If client version is yanked, return 410 Gone with safe replacement recommendation (Section 10)
      const statusCode = decision.clientVersionYanked ? 410 : 200;
      const extraHeaders: Record<string, string> = decision.clientVersionYanked
        ? { 'X-Docmac-Yanked': 'true' }
        : {};

      return new Response(JSON.stringify(decision, null, 2) + '\n', {
        status: statusCode,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=60',
          ...extraHeaders,
          ...corsHeaders,
        },
      });
    }

    /* ---------------------------------------------------------------------- */
    /* Feedback Intake: POST /v1/feedback or POST /feedback                   */
    /* ---------------------------------------------------------------------- */
    if ((path === '/v1/feedback' || path === '/feedback') && method === 'POST') {
      let body: any;
      try {
        body = await request.json();
      } catch (err) {
        return problemResponse(
          400,
          'INVALID_JSON',
          'Invalid JSON Payload',
          'The request body could not be parsed as JSON.',
          requestId,
          corsHeaders
        );
      }

      if (!body.topic || typeof body.topic !== 'string' || !body.message || typeof body.message !== 'string') {
        return problemResponse(
          400,
          'VALIDATION_ERROR',
          'Validation Error',
          'Both topic and message are required fields.',
          requestId,
          corsHeaders
        );
      }

      // Salted IP hash for privacy-safe abuse prevention (no raw IP stored)
      const clientIp = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '127.0.0.1';
      const ipHash = crypto.createHash('sha256').update(clientIp + ':docmac_feedback_salt').digest('hex');
      const userAgent = request.headers.get('User-Agent') || null;

      try {
        const result = await insertFeedback(env.DB, {
          name: body.name,
          email: body.email,
          topic: body.topic,
          message: body.message,
          ipHash,
          userAgent,
        });

        return new Response(
          JSON.stringify(
            {
              success: true,
              ticketId: result.ticketId,
              id: result.ticketId,
              message: `Feedback received under ticket ${result.ticketId}. Thank you for helping shape Docmac.`,
              responseExpectation: result.responseExpectation,
            },
            null,
            2
          ) + '\n',
          {
            status: 201,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-store',
              ...corsHeaders,
            },
          }
        );
      } catch (err: any) {
        if (err.code === 'RATE_LIMIT_EXCEEDED') {
          return problemResponse(
            429,
            'RATE_LIMIT_EXCEEDED',
            'Rate Limit Exceeded',
            err.message,
            requestId,
            corsHeaders
          );
        }
        throw err;
      }
    }

    /* ---------------------------------------------------------------------- */
    /* PHASE 2: Admin Console UI (GET /admin, GET /v1/admin)                  */
    /* ---------------------------------------------------------------------- */
    if ((path === '/admin' || path === '/admin/index.html' || path === '/v1/admin') && method === 'GET') {
      return new Response(renderAdminHtml(), {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          ...corsHeaders,
        },
      });
    }

    /* ---------------------------------------------------------------------- */
    /* PHASE 2: Admin Endpoints Authentication Guard                          */
    /* ---------------------------------------------------------------------- */
    const isAdminRoute = path.startsWith('/v1/admin') || path.startsWith('/admin');
    if (isAdminRoute && path !== '/admin' && path !== '/v1/admin' && path !== '/admin/index.html') {
      const auth = await authenticateAdmin(request, env);
      if (!auth.authenticated) {
        return problemResponse(
          401,
          'UNAUTHORIZED',
          'Unauthorized',
          auth.error || 'Authentication required to access admin release services.',
          requestId,
          corsHeaders
        );
      }

      /* 1. Admin Stats: GET /v1/admin/stats */
      if (path === '/v1/admin/stats' && method === 'GET') {
        const appSlug = env.APP_SLUG || 'docmac';
        const app = await getAppBySlug(env.DB, appSlug);
        const stats = await getAdminStats(env.DB, app?.id || 'app_docmac');
        return new Response(JSON.stringify(stats, null, 2) + '\n', {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders },
        });
      }

      /* 2. Admin List Releases: GET /v1/admin/releases */
      if (path === '/v1/admin/releases' && method === 'GET') {
        const appSlug = env.APP_SLUG || 'docmac';
        const app = await getAppBySlug(env.DB, appSlug);
        const channel = url.searchParams.get('channel') || undefined;
        const status = url.searchParams.get('status') || undefined;
        const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 100);
        const offset = Number(url.searchParams.get('offset')) || 0;

        const result = await listAdminReleases(env.DB, app?.id || 'app_docmac', {
          channel,
          status,
          limit,
          offset,
        });

        return new Response(JSON.stringify(result, null, 2) + '\n', {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders },
        });
      }

      /* 3. Admin Create Draft: POST /v1/admin/releases */
      if (path === '/v1/admin/releases' && method === 'POST') {
        let body: any;
        try {
          body = await request.json();
        } catch {
          return problemResponse(400, 'INVALID_JSON', 'Invalid JSON', 'Request body could not be parsed.', requestId, corsHeaders);
        }

        if (!body.versionName || !body.versionCode) {
          return problemResponse(400, 'VALIDATION_ERROR', 'Validation Error', 'Both versionName and versionCode are required.', requestId, corsHeaders);
        }

        const appSlug = body.app || env.APP_SLUG || 'docmac';
        const app = await getAppBySlug(env.DB, appSlug);
        if (!app) {
          return problemResponse(404, 'APP_NOT_FOUND', 'App Not Found', `App "${appSlug}" not found.`, requestId, corsHeaders);
        }

        try {
          const draft = await createDraftRelease(env.DB, {
            appId: app.id,
            versionName: String(body.versionName).trim(),
            versionCode: Number(body.versionCode),
            channel: body.channel || 'stable',
            releaseNotes: body.releaseNotes || '',
            minSdk: body.minSdk || 24,
            forceUpdate: Boolean(body.forceUpdate),
            actor: auth.actor,
          });

          const uploadUrl = `${url.origin}/v1/admin/releases/${draft.id}/upload`;
          return new Response(
            JSON.stringify(
              {
                id: draft.id,
                status: 'draft',
                upload: {
                  method: 'PUT',
                  url: uploadUrl,
                  headers: { 'Content-Type': 'application/vnd.android.package-archive' },
                  expiresIn: 900,
                  maxBytes: 314572800,
                },
              },
              null,
              2
            ) + '\n',
            {
              status: 201,
              headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders },
            }
          );
        } catch (err: any) {
          if (err.code === 'VERSION_CODE_CONFLICT') {
            return problemResponse(409, 'VERSION_CODE_CONFLICT', 'Version Code Already Exists', err.message, requestId, corsHeaders);
          }
          throw err;
        }
      }

      /* 4. Admin Direct Upload: PUT /v1/admin/releases/:id/upload */
      const uploadMatch = path.match(/^\/v1\/admin\/releases\/([a-zA-Z0-9_-]+)\/upload$/);
      if (uploadMatch && method === 'PUT') {
        const releaseId = uploadMatch[1];
        const release = await getReleaseById(env.DB, releaseId);
        if (!release) {
          return problemResponse(404, 'RELEASE_NOT_FOUND', 'Release Not Found', `Release "${releaseId}" not found.`, requestId, corsHeaders);
        }
        if (release.status !== 'draft') {
          return problemResponse(400, 'INVALID_RELEASE_STATE', 'Invalid State', `Uploads only accepted in draft state. Current status: ${release.status}.`, requestId, corsHeaders);
        }

        const arrayBuffer = await request.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        if (buffer.length < 32) {
          return problemResponse(400, 'EMPTY_UPLOAD', 'Empty Upload', 'Uploaded binary payload is empty or too small.', requestId, corsHeaders);
        }

        // Store in quarantine cache
        quarantineStore.set(releaseId, buffer);

        // Put to R2 if binding is present
        if (env.RELEASES_BUCKET && release.storage_key) {
          try {
            await env.RELEASES_BUCKET.put(release.storage_key, buffer, {
              httpMetadata: { contentType: 'application/vnd.android.package-archive' },
            });
          } catch (r2Err) {
            console.warn('[r2] Warning putting quarantine object:', r2Err);
          }
        }

        return new Response(
          JSON.stringify({ success: true, releaseId, sizeBytes: buffer.length, message: 'Upload staged successfully.' }, null, 2) + '\n',
          { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders } }
        );
      }

      /* 5. Admin Complete & Verify: POST /v1/admin/releases/:id/complete */
      const completeMatch = path.match(/^\/v1\/admin\/releases\/([a-zA-Z0-9_-]+)\/complete$/);
      if (completeMatch && method === 'POST') {
        const releaseId = completeMatch[1];
        const release = await getReleaseById(env.DB, releaseId);
        if (!release) {
          return problemResponse(404, 'RELEASE_NOT_FOUND', 'Release Not Found', `Release "${releaseId}" not found.`, requestId, corsHeaders);
        }

        const buffer = quarantineStore.get(releaseId);
        if (!buffer) {
          return problemResponse(
            400,
            'UPLOAD_NOT_FOUND',
            'Upload Not Found',
            'No staged binary found for this release. Upload the APK before completing.',
            requestId,
            corsHeaders
          );
        }

        await setReleaseVerifying(env.DB, releaseId, auth.actor);

        // Query active certificates for this app
        const certsStmt = env.DB.prepare(
          'SELECT sha256 FROM signing_certs WHERE app_id = ? AND is_active = 1'
        ).bind(release.app_id);
        const certsRes = await certsStmt.all<{ sha256: string }>();
        const allowedSigningCerts = (certsRes.results || []).map((c) => c.sha256);

        // Query max existing version code in this channel
        const maxCodeStmt = env.DB.prepare(
          `SELECT MAX(version_code) as maxCode FROM releases
           WHERE app_id = ? AND channel = ? AND status = 'published' AND id != ?`
        ).bind(release.app_id, release.channel, releaseId);
        const maxCodeRes = await maxCodeStmt.all<{ maxCode: number | null }>();
        const maxExisting = maxCodeRes.results?.[0]?.maxCode ?? 0;

        // Run Verification Engine
        const verification = verifyApk(buffer, {
          expectedVersionName: release.version_name,
          expectedVersionCode: release.version_code,
          allowedSigningCerts,
          maxExistingVersionCode: maxExisting > 0 ? maxExisting : undefined,
          enforceMinSize: env.ENVIRONMENT !== 'test',
        });

        // Save result
        await saveVerificationResult(env.DB, releaseId, {
          passed: verification.passed,
          report: verification.report,
          sizeBytes: verification.sizeBytes,
          sha256: verification.sha256,
          sha512: verification.sha512,
          signatureSha256: verification.signatureSha256,
          packageName: verification.packageName,
          minSdk: verification.minSdk,
          targetSdk: verification.targetSdk,
        });

        const updated = await getReleaseById(env.DB, releaseId);
        let parsedVerification: any = {};
        try {
          parsedVerification = JSON.parse(updated?.verification || '{}');
        } catch {}

        return new Response(
          JSON.stringify(
            {
              id: updated?.id,
              version_name: updated?.version_name,
              version_code: updated?.version_code,
              status: updated?.status,
              verification: parsedVerification,
            },
            null,
            2
          ) + '\n',
          {
            status: verification.passed ? 200 : 422,
            headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders },
          }
        );
      }

      /* 6. Admin Get Single Release: GET /v1/admin/releases/:id */
      const getReleaseMatch = path.match(/^\/v1\/admin\/releases\/([a-zA-Z0-9_-]+)$/);
      if (getReleaseMatch && method === 'GET') {
        const releaseId = getReleaseMatch[1];
        const release = await getReleaseById(env.DB, releaseId);
        if (!release) {
          return problemResponse(404, 'RELEASE_NOT_FOUND', 'Release Not Found', `Release "${releaseId}" not found.`, requestId, corsHeaders);
        }
        let parsedVerification: any = {};
        try { parsedVerification = JSON.parse(release.verification); } catch {}
        return new Response(JSON.stringify({ ...release, verification: parsedVerification }, null, 2) + '\n', {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders },
        });
      }

      /* 7. Admin Patch Draft: PATCH /v1/admin/releases/:id */
      if (getReleaseMatch && method === 'PATCH') {
        const releaseId = getReleaseMatch[1];
        let body: any;
        try { body = await request.json(); } catch {
          return problemResponse(400, 'INVALID_JSON', 'Invalid JSON', 'Request body could not be parsed.', requestId, corsHeaders);
        }

        try {
          const updated = await updateReleaseDraft(env.DB, releaseId, auth.actor, {
            releaseNotes: body.releaseNotes,
            forceUpdate: body.forceUpdate,
            minSupported: body.minSupported,
            channel: body.channel,
          });
          return new Response(JSON.stringify(updated, null, 2) + '\n', {
            status: 200,
            headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders },
          });
        } catch (err: any) {
          if (err.code === 'RELEASE_NOT_FOUND') return problemResponse(404, 'RELEASE_NOT_FOUND', 'Not Found', err.message, requestId, corsHeaders);
          if (err.code === 'INVALID_RELEASE_STATE') return problemResponse(400, 'INVALID_RELEASE_STATE', 'Invalid State', err.message, requestId, corsHeaders);
          throw err;
        }
      }

      /* 8. Admin Transactional Publish: POST /v1/admin/releases/:id/publish */
      const publishMatch = path.match(/^\/v1\/admin\/releases\/([a-zA-Z0-9_-]+)\/publish$/);
      if (publishMatch && method === 'POST') {
        const releaseId = publishMatch[1];
        try {
          const published = await publishReleaseTransaction(env.DB, releaseId, auth.actor);
          return new Response(JSON.stringify(published, null, 2) + '\n', {
            status: 200,
            headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders },
          });
        } catch (err: any) {
          if (err.code === 'RELEASE_NOT_FOUND') return problemResponse(404, 'RELEASE_NOT_FOUND', 'Not Found', err.message, requestId, corsHeaders);
          if (err.code === 'INVALID_RELEASE_STATE') return problemResponse(400, 'INVALID_RELEASE_STATE', 'Invalid State', err.message, requestId, corsHeaders);
          throw err;
        }
      }

      /* 9. Admin Transactional Yank: POST /v1/admin/releases/:id/yank */
      const yankMatch = path.match(/^\/v1\/admin\/releases\/([a-zA-Z0-9_-]+)\/yank$/);
      if (yankMatch && method === 'POST') {
        const releaseId = yankMatch[1];
        let body: any = {};
        try { body = await request.json(); } catch {}
        const reason = body.reason || 'Yanked by administrator';

        try {
          const yanked = await yankReleaseTransaction(env.DB, releaseId, auth.actor, reason);
          return new Response(JSON.stringify(yanked, null, 2) + '\n', {
            status: 200,
            headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders },
          });
        } catch (err: any) {
          if (err.code === 'RELEASE_NOT_FOUND') return problemResponse(404, 'RELEASE_NOT_FOUND', 'Not Found', err.message, requestId, corsHeaders);
          if (err.code === 'ALREADY_YANKED') return problemResponse(400, 'ALREADY_YANKED', 'Already Yanked', err.message, requestId, corsHeaders);
          throw err;
        }
      }

      /* 10. Admin Delete Draft: DELETE /v1/admin/releases/:id */
      if (getReleaseMatch && method === 'DELETE') {
        const releaseId = getReleaseMatch[1];
        try {
          await deleteDraftRelease(env.DB, releaseId, auth.actor);
          quarantineStore.delete(releaseId);
          return new Response(JSON.stringify({ success: true, message: 'Draft deleted.' }, null, 2) + '\n', {
            status: 200,
            headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders },
          });
        } catch (err: any) {
          if (err.code === 'RELEASE_NOT_FOUND') return problemResponse(404, 'RELEASE_NOT_FOUND', 'Not Found', err.message, requestId, corsHeaders);
          if (err.code === 'IMMUTABLE_RELEASE') return problemResponse(403, 'IMMUTABLE_RELEASE', 'Forbidden', err.message, requestId, corsHeaders);
          throw err;
        }
      }

      /* 11. Admin Audit Trail: GET /v1/admin/audit */
      if (path === '/v1/admin/audit' && method === 'GET') {
        const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 100);
        const offset = Number(url.searchParams.get('offset')) || 0;
        const result = await getAuditLogs(env.DB, limit, offset);
        return new Response(JSON.stringify(result, null, 2) + '\n', {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders },
        });
      }

      /* 12. Admin Scoped Tokens: POST /v1/admin/tokens */
      if (path === '/v1/admin/tokens' && method === 'POST') {
        let body: any;
        try { body = await request.json(); } catch {
          return problemResponse(400, 'INVALID_JSON', 'Invalid JSON', 'Request body could not be parsed.', requestId, corsHeaders);
        }

        const name = String(body.name || 'unnamed-token').trim();
        const scopes = Array.isArray(body.scopes) ? body.scopes : ['release:write', 'release:publish'];
        const expiresAt = body.expiresAt || null;

        const secretBytes = crypto.randomBytes(32);
        const rawToken = `docmac_tok_${secretBytes.toString('base64url')}`;
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

        const tokenId = await createApiToken(env.DB, name, tokenHash, scopes, expiresAt);

        return new Response(
          JSON.stringify({ success: true, id: tokenId, name, token: rawToken, scopes }, null, 2) + '\n',
          { status: 201, headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders } }
        );
      }

      /* 13. Admin Add Signing Cert: POST /v1/admin/apps/:slug/signing-certs */
      const certMatch = path.match(/^\/v1\/admin\/apps\/([a-zA-Z0-9_-]+)\/signing-certs$/);
      if (certMatch && method === 'POST') {
        const slug = certMatch[1];
        const app = await getAppBySlug(env.DB, slug);
        if (!app) return problemResponse(404, 'APP_NOT_FOUND', 'Not Found', `App "${slug}" not found.`, requestId, corsHeaders);

        let body: any;
        try { body = await request.json(); } catch {
          return problemResponse(400, 'INVALID_JSON', 'Invalid JSON', 'Request body could not be parsed.', requestId, corsHeaders);
        }

        if (!body.sha256) {
          return problemResponse(400, 'VALIDATION_ERROR', 'Validation Error', 'sha256 certificate fingerprint is required.', requestId, corsHeaders);
        }

        const certId = await addSigningCert(env.DB, app.id, body.sha256, body.subject);
        return new Response(JSON.stringify({ success: true, id: certId, sha256: body.sha256.toUpperCase() }, null, 2) + '\n', {
          status: 201,
          headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders },
        });
      }

      /* 14. Admin Feedback Triage: GET /v1/admin/feedback */
      if (path === '/v1/admin/feedback' && method === 'GET') {
        const status = url.searchParams.get('status') || undefined;
        const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 100);
        const offset = Number(url.searchParams.get('offset')) || 0;
        const result = await listFeedback(env.DB, { status, limit, offset });
        return new Response(JSON.stringify(result, null, 2) + '\n', {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders },
        });
      }

      /* 15. Admin Update Feedback Status: PATCH /v1/admin/feedback/:id */
      const fbStatusMatch = path.match(/^\/v1\/admin\/feedback\/([a-zA-Z0-9_-]+)$/);
      if (fbStatusMatch && method === 'PATCH') {
        const fbId = fbStatusMatch[1];
        let body: any;
        try { body = await request.json(); } catch {
          return problemResponse(400, 'INVALID_JSON', 'Invalid JSON', 'Request body could not be parsed.', requestId, corsHeaders);
        }
        if (!body.status) {
          return problemResponse(400, 'VALIDATION_ERROR', 'Validation Error', 'status field is required.', requestId, corsHeaders);
        }
        await updateFeedbackStatus(env.DB, fbId, body.status);
        return new Response(JSON.stringify({ success: true, id: fbId, status: body.status }, null, 2) + '\n', {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders },
        });
      }
    }

    // Unmatched Route
    return problemResponse(
      404,
      'ROUTE_NOT_FOUND',
      'Not Found',
      `Cannot ${method} ${path}`,
      requestId,
      corsHeaders
    );
  } catch (error: any) {
    console.error(`[${requestId}] Internal error:`, error);
    return problemResponse(
      500,
      'INTERNAL_SERVER_ERROR',
      'Internal Server Error',
      'An unexpected error occurred while processing the request.',
      requestId,
      corsHeaders
    );
  }
}

