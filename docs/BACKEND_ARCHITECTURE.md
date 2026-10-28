# Docmac Release Platform
## Website Audit and Backend Architecture

**Prepared:** 23 October 2026  
**Scope:** `DOCMAC_WEBSITE` (static marketing site) and a release service for hosting, verifying, and distributing every Android APK version.  
**Status:** Target infrastructure. Backend code is implemented and tested locally, but not deployed.

> **Not live:** `api.docmac.app`, `downloads.docmac.app`, Cloudflare Workers/D1/R2, and the feedback/update APIs are design targets. The public website currently uses GitHub Pages and GitHub Releases only. Do not treat any endpoint or URL in this document as an available service until deployment is verified.

---

## 1. Executive summary

The current website is a well-built **static marketing and download page**. It has no backend. APK files live on GitHub Releases and the page hard-codes the four most recent versions. That works while there is one publisher and a handful of releases, but it has already drifted: GitHub has five releases (`v1.0.0` through `v1.0.4`) and the website lists only four.

The target system should keep the public site static and fast, and add a small, dedicated **release service**:

- **Object storage** for immutable APK files (Cloudflare R2 recommended).
- **Metadata database** for apps, releases, channels, checksums, signatures, and audit history.
- **Edge API** for the website and the Android app's update check.
- **Admin console + upload pipeline** so a new APK can be uploaded, verified, and published without editing HTML.
- **Immutable CDN download URLs** so any historical version remains downloadable.

This gives users a true version catalogue, gives the publisher a repeatable release process, and adds the trust signals that sideloaded APKs require: SHA-256 checksums, signing-certificate fingerprint, release notes, and tamper-evident audit records.

> **Recommended delivery order:** ship the zero-backend manifest fix first (days), then the release service (weeks). Section 18 describes both.

---

## 2. What is already implemented

| Area | Implemented | Quality |
|---|---|---|
| Marketing page | Hero, feature grid, 3-step onboarding, FAQ, footer | Strong visual design, clear product story |
| Responsive layout | Breakpoints at 980, 900, 800, 620 px | Works, with a few drawer issues |
| Mobile navigation | Slide-in drawer, scrim, Escape to close, resize reset | Good foundation, missing focus trap |
| Theming | Light/dark, persisted in `localStorage` | Only reachable from the mobile drawer |
| Release downloads | Latest + four previous versions, direct GitHub asset URLs | Links verified reachable, correct APK MIME type, `PK` ZIP magic |
| Release history UI | Expand/collapse disclosure | Clean, accessible button state |
| APK safety notice | Explains Android sideload warning | Honest and useful |
| Support | Email, WhatsApp, install guide, FAQ | Functional but manual |
| Feedback | Prefilled `mailto:` form | No persistence, no delivery guarantee |
| Legal | Privacy, terms, 404 | Good baseline, contains internal notes |
| Accessibility | Skip link, focus-visible styles, reduced-motion, labels | Above average for a static site |
| Documentation | `README.md` with release steps | Accurate until the release date step, which has no matching UI |
| Deployment | GitHub Pages + `.nojekyll` | Simple, no build step, no CI |

**Verified externally:** all five GitHub release assets return HTTP 200, are served as `application/vnd.android.package-archive`, and begin with the ZIP magic bytes `PK`. Download counts at audit time: v1.0.4 = 16, v1.0.3 = 9, v1.0.2 = 4, v1.0.1 = 5, v1.0.0 = 2.

---

## 3. Findings

### 3.1 Critical

**C1. No integrity or authenticity evidence for executable downloads.**
The card says "Signed APK" and shows a green check, but publishes no SHA-256 checksum and no signing-certificate SHA-256 fingerprint. Users cannot verify that a downloaded file is the file the publisher built. For sideloaded APKs this is the single largest trust gap.

**C2. Release data has three sources of truth and has already drifted.**
`index.html:33` (hero version), `index.html:62` (release card and list), and `assets/script.js:1-6` (config) each hard-code a version and URL. GitHub contains `v1.0.0`, but the site does not list it. The "Size" value is hard-coded at 60.5 MB, and no release date is displayed even though `README.md:35` instructs the maintainer to update one.

**C3. Publishing a release requires manual edits in multiple files.**
A new version requires changing the hero, the card, the list, `script.js`, the CSS/JS cache-busting query strings, and the README, then committing. This is error-prone and already produced an incomplete catalogue.

**C4. Mobile drawer forces full page navigation and breaks expected link behaviour.**
`assets/script.js:90-96` calls `preventDefault()` on every navigation link and assigns `window.location.href`. Consequences: same-page anchors reload the page instead of smooth-scrolling; Ctrl/Cmd-click and middle-click cannot open a new tab; modified clicks are swallowed.

**C5. Feedback form can leak message contents into the URL when JavaScript is unavailable.**
`feedback.html:4` has no `action` or `method`, so the browser default is `GET` to the current page. Any message typed before a script failure would be placed in the query string and browser history. The form also has no success state, no delivery confirmation, and no fallback when no mail client is configured.

### 3.2 High

| ID | Finding | Evidence |
|---|---|---|
| H1 | No release notes, dates, per-version size, or minimum Android version. Users cannot make an informed choice when downgrading. | `index.html:62` |
| H2 | No backend, admin UI, or upload API. Distribution depends entirely on GitHub Releases. | repository |
| H3 | No automated release or deploy pipeline, no HTML validation, no link checking, no tests. | no `.github/workflows` |
| H4 | No security headers (CSP, HSTS, nosniff, frame-ancestors, permissions policy). GitHub Pages cannot set them. | hosting |
| H5 | Weak discoverability and sharing: no canonical URLs, `sitemap.xml`, `robots.txt`, `og:image`, `og:url`, Twitter card, or `SoftwareApplication` JSON-LD. | all pages |
| H6 | Fonts load through a render-blocking `@import` from Google Fonts; the 216 KB PNG logo is displayed at 34 px. | `assets/styles.css:1`, `assets/images/docmac-logo.png` |
| H7 | Dark mode is only available inside the mobile drawer. Desktop users cannot switch, and OS `prefers-color-scheme` is ignored. The storage key is `docmac-drawer-theme` although it themes the whole site. | `script.js:31-60`, `styles.css:22` |
| H8 | No download analytics or funnel measurement; no QR code for desktop visitors; no Android detection. | site |
| H9 | Public legal pages expose internal review notes ("should be reviewed with qualified legal counsel"). This undermines trust in a page that is supposed to be authoritative. | `privacy.html:4`, `terms.html:4` |
| H10 | Support runs through a personal Gmail address and a personal WhatsApp number, with no ticket ID or response target. | all pages |
| H11 | Drawer has no focus trap, no `inert` on background content, and no focus restore. | `script.js:62-104` |
| H12 | Several small labels use `#98a2b3` on white, roughly 2.7:1 contrast, below WCAG AA. | `styles.css:10`, `:18` |
| H13 | No privacy disclosure for CDN or download logs, because no backend exists yet. Adding one requires a policy update. | `privacy.html` |

### 3.3 Medium

- `aria-label` is used on plain `div` elements in `index.html` (`.release-list`, `.hero-meta`, `.phone-scene`) without a role, so it is ignored by assistive technology. The phone mockup is decorative and should be `aria-hidden="true"`.
- No `aria-current="page"` in navigation.
- `404.html` has no header, footer, description, theme support, or navigation, so it feels like a different site.
- Every release asset is named `app-release.apk`; multiple downloads collide in the user's Downloads folder. Prefer `docmac-1.0.4.apk`.
- Old releases are presented as equally valid. There is no "yanked", "security issue", or "minimum supported" state.
- `.checksum-link` exists in `styles.css:10` but no checksum UI exists. This is an unfinished feature.
- Cache-busting query strings (`?v=20260825-4`) are edited by hand and easy to forget.
- No per-release permalink or changelog page, so a specific version cannot be linked or shared.
- No PWA manifest, `apple-touch-icon`, or SVG favicon.
- No `security.txt` or dedicated security contact.
- No localization, despite an audience that contacts support through WhatsApp in Nigeria.
- No `loading`/`decoding` strategy for the logo and no responsive image variants.
- The claim "Android 7.0 and newer" is hard-coded, not derived from the APK manifest.
- No Telegram or Play Store presence, if those are planned.

### 3.4 What is genuinely good

- The visual system is coherent and distinctive; it does not look like a template.
- The APK installation warning is unusually honest and well written.
- Focus-visible, skip-link, reduced-motion, and semantic FAQ elements show real care.
- Direct asset URLs (not release-page links) are the correct choice for a download button.
- The `.nojekyll` file and manual deploy are appropriate for the current scale.

---

## 4. Immediate fixes (before any backend work)

These are low-risk and remove the worst drift and trust problems.

1. **Create one release manifest** (`releases.json`) as the only source of truth. Generate it from the GitHub API in CI. Render the hero version, release card, and list from it.
2. **Add the missing `v1.0.0`** and every future version automatically.
3. **Publish SHA-256 for every APK** and the signing-certificate SHA-256 fingerprint. Add copy-to-clipboard and verification instructions (`sha256sum`, `certutil -hashfile`, `apksigner verify --print-certs`).
4. **Add release notes and dates** per version. Mark the recommended version and flag yanked builds.
5. **Rename assets** to `docmac-<version>.apk` for new releases (keep old URLs alive).
6. **Fix the drawer link handler**: only intercept when the target is same-page and the click is unmodified; otherwise let the browser navigate.
7. **Fix the feedback form**: explicit `method="post"` and `action`, or keep `mailto:` but add `onsubmit` with a visible confirmation and a non-JS fallback that does not put the message in the URL.
8. **Add a desktop theme control** and honor `prefers-color-scheme` by default. Rename the storage key to `docmac-theme`.
9. **Remove the internal legal review notes** from the public pages.
10. **Self-host the fonts**, subset them, and replace the 216 KB PNG with a 68/136 px WebP/AVIF plus a small PNG favicon.
11. **Add SEO essentials**: canonical, `og:image` (1200x630), `og:url`, Twitter card, `sitemap.xml`, `robots.txt`, and `SoftwareApplication` JSON-LD.
12. **Add a security contact** and `/.well-known/security.txt`.
13. **Move support to `support@docmac.app`** using Cloudflare Email Routing (free forwarding) while keeping the Gmail mailbox behind it.
14. **Add a QR code** for desktop visitors and a clear "you are on Android / not on Android" hint.

---

## 5. Target architecture

### 5.1 Design principles

1. **Static site, dynamic catalogue.** The marketing site stays static. Only the release list is fetched.
2. **Objects are immutable.** A published version is never overwritten. A key contains the version and content hash.
3. **The database is metadata, not storage.** APKs live in object storage; the database stores pointers, hashes, and policy.
4. **Trust is published, not claimed.** Every release carries a checksum and a verified signing fingerprint.
5. **The signing key never touches the server.** The backend verifies signatures; it never signs APKs.
6. **Publish is a transaction with an audit trail.** Draft → verify → ready → published, with the ability to yank instantly.
7. **Downloads are CDN-served and cacheable forever.** Counting happens at the edge, not in the hot path.
8. **Everything is reproducible from CI.** Manual edits are an exception, not the process.

### 5.2 Recommended stack

| Layer | Choice | Why |
|---|---|---|
| Public site | Cloudflare Pages (migrate from GitHub Pages) | Custom headers, redirects, preview deploys, global CDN, free |
| API | Cloudflare Workers + TypeScript + Hono | Edge latency, cheap, same platform as storage |
| Database | Cloudflare D1 (SQLite) + Drizzle ORM | Enough for release metadata, zero operations; Postgres if the app backend will share it |
| Object storage | Cloudflare R2 | S3-compatible, no egress fees, custom domain, presigned uploads |
| CDN downloads | R2 custom domain `downloads.docmac.app` | Immutable, range requests, long cache |
| Admin auth | Cloudflare Access (SSO + MFA) | No custom auth to build or secure |
| Admin UI | React/Remix app on Pages, behind Access | Drag-and-drop upload, release list, publish/yank |
| Verification | Container service (Fly.io or Cloud Run) with JDK + Android build-tools + ClamAV | `apksigner` needs a JVM; keeps Workers simple |
| Queue | Cloudflare Queues | Decouples upload completion from verification |
| Analytics | Cloudflare Analytics Engine + Web Analytics | Privacy-friendly, no cookie banner |
| Email | Cloudflare Email Routing + Resend/Postmark | Domain support address, transactional feedback notifications |
| Monitoring | Workers Logs/Logpush + Sentry + Better Stack | Errors, uptime, alerts |
| IaC | Wrangler + GitHub Actions | Reproducible environments |

**Why not a monolithic VPS?** A single VPS with NestJS/Postgres/Nginx is a valid alternative and is described in §5.6, but it adds patching, backups, TLS renewal, and a single point of failure for a workload that is mostly static files and a few thousand metadata reads per day. The edge stack costs less and has less operational surface. Choose the VPS only if the Docmac app backend will live on the same infrastructure.

**Why not Supabase Storage alone?** It is fast to start, but egress is metered after the free allowance and signed URLs complicate CDN caching. R2 is a better fit for large, public, repeatedly downloaded binaries.

### 5.3 Topology

```
                         ┌────────────────────────────────────┐
                         │  Public website (static)           │
                         │  docmac.app  •  Cloudflare Pages    │
                         └───────────────┬────────────────────┘
                                         │ GET /v1/apps/docmac/...
                                         │ (JSON manifest, short cache)
                         ┌───────────────▼────────────────────┐
                         │  Edge API                           │
                         │  api.docmac.app  •  Workers + Hono  │
                         │  read: 60 s cache                   │
                         └──┬──────────────┬──────────────┬────┘
                            │              │              │
                  ┌─────────▼──────┐ ┌─────▼──────┐ ┌─────▼──────────┐
                  │ D1 / Postgres  │ │ KV cache   │ │ Analytics      │
                  │ apps, releases │ │ manifests  │ │ Engine         │
                  │ audit, policy  │ │            │ │ download counts│
                  └─────────┬──────┘ └────────────┘ └────────────────┘
                            │
                  ┌─────────▼──────────────────────────────────────┐
                  │  Cloudflare R2 — docmac-releases               │
                  │  quarantine/... (private, 7-day lifecycle)     │
                  │  android/{channel}/{version}/{sha}/...apk      │
                  │  Object versioning + immutable keys            │
                  └─────────┬──────────────────────────────────────┘
                            │ custom domain, public read
                  ┌─────────▼──────────────────────────────────────┐
                  │  downloads.docmac.app (CDN)                    │
                  │  Cache-Control: immutable, Range supported     │
                  └────────────────────────────────────────────────┘

  Admin path:
  ┌──────────────┐   presigned PUT    ┌──────────────────┐
  │ Admin UI     │───────────────────▶│ R2 quarantine    │
  │ admin.docmac │                    └────────┬─────────┘
  │ .app + Access│                             │
  └──────┬───────┘                             │ queue
         │ POST /complete                      ▼
         │                          ┌──────────────────────────┐
         └─────────────────────────▶│ Verifier container       │
                                    │ apksigner, aapt2, hash,  │
                                    │ ClamAV, policy checks    │
                                    └────────────┬─────────────┘
                                                 │ result callback
                                                 ▼
                                    publish transaction + audit

  CI path:
  GitHub Actions (build + sign) ──▶ same admin API ──▶ same pipeline
```

### 5.4 Component responsibilities

| Component | Responsibility | Must not do |
|---|---|---|
| Static site | Marketing, catalogue rendering, QR, install help | Hold release truth in HTML |
| Edge API | Read manifests, redirect downloads, update checks, feedback intake, admin mutations | Stream APK bytes through the worker |
| R2 | Store quarantine and production objects | Serve directory listings |
| Verifier | Parse APK, verify signature, hash, malware scan, policy checks | Hold the signing keystore |
| Admin UI | Upload, edit notes, publish, yank, view audit | Be reachable without SSO + MFA |
| D1/Postgres | Metadata, policy, audit, aggregates | Store APK blobs |
| Analytics Engine | Count downloads and update checks without PII | Store raw IP addresses |

### 5.5 Environments

| Environment | Site | API | Bucket | Database | Signing |
|---|---|---|---|---|---|
| Local | `localhost` static server | `wrangler dev` | MinIO or R2 dev bucket | local D1 | debug key only |
| Staging | `staging.docmac.app` | `api-staging.docmac.app` | `docmac-releases-staging` | `docmac-staging` | staging key |
| Production | `docmac.app` | `api.docmac.app` | `docmac-releases-prod` | `docmac-prod` | production key, offline |

Promote the **same verified artifact** from staging to production. Never rebuild a release for promotion.

### 5.6 Alternative: single-VPS deployment

If the team prefers one server:

- **Runtime:** Docker Compose with `nginx`, `api` (NestJS/Fastify), `postgres:16`, `redis`, `minio` (or external S3/R2), `clamav`, `verifier`.
- **TLS:** Caddy or Nginx + Let's Encrypt.
- **Uploads:** presigned S3 URLs to MinIO/R2, not through Node.
- **Jobs:** BullMQ on Redis for verification and email.
- **Admin:** same API with session auth, TOTP MFA, Argon2id password hashing.
- **Backups:** `pg_dump` to object storage nightly, MinIO versioning, off-site copy.
- **Monitoring:** Prometheus + Grafana or a hosted agent.
- **Trade-off:** roughly $20–40/month and ongoing maintenance versus $0–5/month for the edge stack.

The API contract and data model below are identical in both deployments.

---

## 6. Data model

Canonical schema is PostgreSQL. For D1, replace `uuid` with `text`, `timestamptz` with `text` (ISO-8601), `jsonb` with `text`, and `gen_random_uuid()` with application-generated IDs.

```sql
-- Applications (one row today, ready for more products later)
create table apps (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique,              -- 'docmac'
  name                text not null,                     -- 'Docmac'
  package_name        text not null,                     -- 'com.docmac.app'
  platform            text not null default 'android',
  website_url         text,
  privacy_url         text,
  created_at          timestamptz not null default now()
);

-- Signing certificates allowed to sign this app.
-- Rotation is an explicit, audited operation.
create table signing_certs (
  id                  uuid primary key default gen_random_uuid(),
  app_id              uuid not null references apps(id) on delete cascade,
  sha256              text not null,                     -- apksigner --print-certs
  subject             text,
  valid_from          timestamptz,
  valid_to            timestamptz,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  unique (app_id, sha256)
);

-- One row per published or draft build.
create table releases (
  id                  uuid primary key default gen_random_uuid(),
  app_id              uuid not null references apps(id) on delete cascade,
  version_name        text not null,                     -- '1.0.4'
  version_code        bigint not null,                   -- 104 (must increase)
  channel             text not null default 'stable'
                      check (channel in ('stable','beta','internal')),
  status              text not null default 'draft'
                      check (status in ('draft','uploading','verifying','ready',
                                        'published','yanked','failed')),
  is_current          boolean not null default false,    -- latest for channel
  force_update        boolean not null default false,
  min_supported       boolean not null default false,    -- update policy floor

  storage_key         text,                              -- immutable production key
  file_name           text,                              -- docmac-1.0.4.apk
  size_bytes          bigint,
  sha256              text,
  sha512              text,
  signature_sha256    text,
  package_name        text,
  min_sdk             int,
  target_sdk          int,
  abis                text[],

  release_notes       text,                              -- Markdown
  published_at        timestamptz,
  yanked_at           timestamptz,
  yanked_reason       text,
  verification        jsonb not null default '{}'::jsonb,
  created_by          text not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (app_id, channel, version_code)
);

-- Only one current release per app/channel.
create unique index releases_one_current
  on releases (app_id, channel)
  where is_current;

create index releases_catalogue
  on releases (app_id, channel, status, version_code desc);

-- Optional: split APKs or ABI-specific assets. Usually one universal APK.
create table release_assets (
  id                  uuid primary key default gen_random_uuid(),
  release_id          uuid not null references releases(id) on delete cascade,
  abi                 text,                              -- arm64-v8a, armeabi-v7a, universal
  storage_key         text not null,
  size_bytes          bigint not null,
  sha256              text not null
);

-- Aggregated downloads. No raw IP addresses.
create table download_daily (
  release_id          uuid not null references releases(id) on delete cascade,
  day                 date not null,
  country             text,                              -- ISO-3166 alpha-2 or 'unknown'
  count               bigint not null default 0,
  primary key (release_id, day, country)
);

-- Every mutation by an admin or CI.
create table audit_log (
  id                  bigserial primary key,
  actor               text not null,                     -- email or token ID
  action              text not null,                     -- release.publish, release.yank, ...
  release_id          uuid references releases(id) on delete set null,
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

-- Scoped machine tokens for CI. Store only a hash.
create table api_tokens (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  token_hash          text not null unique,              -- SHA-256 of random 32 bytes
  scopes              text[] not null,                   -- release:write, release:publish
  last_used_at        timestamptz,
  expires_at          timestamptz,
  created_at          timestamptz not null default now()
);

-- Feedback, if the mailto flow is replaced by a server endpoint.
create table feedback (
  id                  uuid primary key default gen_random_uuid(),
  name                text,
  email               text,
  topic               text not null,
  message             text not null,
  status              text not null default 'new'
                      check (status in ('new','read','replied','closed','spam')),
  ip_hash             text,                              -- salted, for abuse only
  user_agent          text,
  created_at          timestamptz not null default now()
);
```

### 6.1 Release state machine

```
draft ──upload complete──▶ verifying ──pass──▶ ready ──publish──▶ published
  │                           │                                     │
  │                           └──fail──▶ failed                    └──yank──▶ yanked
  └──abandon / delete (draft only)
```

Rules:

- `draft` is the only deletable state.
- `published` metadata is immutable except notes and `yanked` state. A correction ships as a new `versionCode`.
- `yanked` disappears from the public catalogue but its direct URL remains reachable so users are not stranded. The API returns a warning and recommends a safe replacement.
- `is_current` is changed in a transaction: clear the old flag, set the new one, write the audit row.
- `versionCode` must be strictly greater than every non-yanked build in the same channel. Reject duplicates even if `versionName` differs.

---

## 7. API design

Base URL: `https://api.docmac.app/v1`  
Content type: `application/json; charset=utf-8`  
Errors: RFC 9457 problem details, with a stable `code`.

### 7.1 Public endpoints

| Method | Path | Cache | Purpose |
|---|---|---|---|
| GET | `/apps/{slug}/manifest.json` | 60 s | Full catalogue for the website |
| GET | `/apps/{slug}/releases?channel=stable&limit=20&cursor=...` | 60 s | Paginated releases |
| GET | `/apps/{slug}/releases/latest?channel=stable` | 30 s | Latest published release |
| GET | `/apps/{slug}/releases/{version}` | 300 s | One release, including notes |
| GET | `/apps/{slug}/releases/{version}/download` | no-store | 302 to immutable CDN URL, counts download |
| GET | `/apps/{slug}/download/latest?channel=stable` | no-store | 302 to latest APK |
| GET | `/apps/{slug}/update?versionCode=103&channel=stable&sdk=34` | 60 s | In-app update decision |
| GET | `/apps/{slug}/checksums.txt` | 300 s | `sha256sum`-compatible file |
| POST | `/feedback` | no-store | Rate-limited feedback intake |
| GET | `/healthz` | no-store | Liveness and dependency check |

`GET /apps/docmac/manifest.json`:

```json
{
  "app": {
    "slug": "docmac",
    "name": "Docmac",
    "packageName": "com.docmac.app",
    "platform": "android",
    "signingCertSha256": "AB:CD:EF:..."
  },
  "generatedAt": "2026-10-23T12:00:00Z",
  "channel": "stable",
  "latest": {
    "versionName": "1.0.4",
    "versionCode": 104,
    "publishedAt": "2026-08-25T19:38:35Z",
    "minSdk": 24,
    "targetSdk": 35,
    "sizeBytes": 63438848,
    "sha256": "9f2c...e1",
    "signatureSha256": "AB:CD:EF:...",
    "downloadUrl": "https://api.docmac.app/v1/apps/docmac/releases/1.0.4/download",
    "cdnUrl": "https://downloads.docmac.app/android/stable/1.0.4/9f2c.../docmac-1.0.4.apk",
    "releaseNotes": "Fixed call reconnection issues. Improved photo upload reliability.",
    "forceUpdate": false,
    "yanked": false
  },
  "releases": [
    {
      "versionName": "1.0.3",
      "versionCode": 103,
      "publishedAt": "2026-08-22T20:35:38Z",
      "sizeBytes": 61970842,
      "sha256": "...",
      "minSdk": 24,
      "releaseNotes": "...",
      "yanked": false
    }
  ]
}
```

`GET /apps/docmac/releases/1.0.4/download` returns:

```
HTTP/1.1 302 Found
Location: https://downloads.docmac.app/android/stable/1.0.4/9f2c.../docmac-1.0.4.apk
Cache-Control: no-store
```

The CDN object then returns:

```
Content-Type: application/vnd.android.package-archive
Content-Disposition: attachment; filename="docmac-1.0.4.apk"
Cache-Control: public, max-age=31536000, immutable
ETag: "9f2c..."
Accept-Ranges: bytes
X-Checksum-Sha256: 9f2c...
```

`GET /apps/docmac/update?versionCode=103&channel=stable&sdk=34`:

```json
{
  "updateAvailable": true,
  "mandatory": false,
  "latest": { "versionName": "1.0.4", "versionCode": 104, "sha256": "...", "sizeBytes": 63438848 },
  "minSupportedVersionCode": 100,
  "downloadUrl": "https://api.docmac.app/v1/apps/docmac/releases/1.0.4/download",
  "message": null
}
```

Rules for `mandatory`:

- `true` when the client's `versionCode` is below the channel's `min_supported` floor.
- `true` when any release at or below the client's version is marked as a security yank.
- Otherwise `false`, and the app may show a dismissible prompt.

### 7.2 Admin endpoints

All require a valid Cloudflare Access JWT or a scoped CI token, plus an audit entry.

| Method | Path | Purpose |
|---|---|---|
| POST | `/admin/releases` | Create draft; return presigned upload instructions |
| POST | `/admin/releases/{id}/complete` | Declare upload finished; enqueue verification |
| GET | `/admin/releases/{id}` | Poll status and verification result |
| PATCH | `/admin/releases/{id}` | Edit notes, force flag, channel (draft only) |
| POST | `/admin/releases/{id}/publish` | Transactional publish |
| POST | `/admin/releases/{id}/yank` | Remove from catalogue with reason |
| DELETE | `/admin/releases/{id}` | Delete a draft and its quarantine object |
| GET | `/admin/releases` | Filter by app, channel, status |
| GET | `/admin/audit` | Paginated audit trail |
| POST | `/admin/apps/{slug}/signing-certs` | Add an allowlisted certificate |
| POST | `/admin/import/github` | One-time import of GitHub releases |
| GET | `/admin/stats` | Downloads by version and day |

`POST /admin/releases` request:

```json
{
  "app": "docmac",
  "versionName": "1.0.5",
  "versionCode": 105,
  "channel": "stable",
  "releaseNotes": "Improved call quality.\nFixed notification delay on Android 14."
}
```

Response:

```json
{
  "id": "rel_01J...",
  "status": "draft",
  "upload": {
    "method": "PUT",
    "url": "https://...r2.cloudflarestorage.com/docmac-releases/quarantine/rel_01J.../upload?X-Amz-...",
    "headers": { "Content-Type": "application/vnd.android.package-archive" },
    "expiresIn": 900,
    "maxBytes": 314572800
  }
}
```

The upload is a single presigned PUT for files under 100 MB; use S3 multipart for larger files or future split APKs.

### 7.3 Error format

```json
{
  "type": "https://api.docmac.app/problems/version-conflict",
  "title": "Version code already exists",
  "status": 409,
  "code": "VERSION_CODE_CONFLICT",
  "detail": "versionCode 105 already exists in channel stable.",
  "requestId": "req_01J..."
}
```

---

## 8. Upload and verification pipeline

### 8.1 Sequence

```
Admin/CI        API                 R2              Queue        Verifier         DB
   │             │                  │                 │             │             │
   │ POST draft  │                  │                 │             │             │
   ├────────────▶│ create draft     │                 │             │             │
   │             ├─────────────────▶│                 │             │             │
   │  presigned  │                  │                 │             │             │
   │◀────────────┤                  │                 │             │             │
   │ PUT APK     │                  │                 │             │             │
   ├───────────────────────────────▶│                 │             │             │
   │ POST complete                  │                 │             │             │
   ├────────────▶│ status=verifying │                 │             │             │
   │             ├─────────────────▶│ enqueue         │             │             │
   │             │                  ├────────────────▶│             │             │
   │             │                  │                 │ verify job  │             │
   │             │                  │                 ├────────────▶│             │
   │             │                  │                 │             │ fetch object│
   │             │                  │◀────────────────┼─────────────┤             │
   │             │                  │                 │             │ apksigner   │
   │             │                  │                 │             │ aapt2       │
   │             │                  │                 │             │ sha256      │
   │             │                  │                 │             │ ClamAV      │
   │             │                  │                 │ result      │             │
   │             │◀─────────────────┼─────────────────┼─────────────┤             │
   │             │ validate policy  │                 │             │             │
   │             │ copy to prod key │                 │             │             │
   │             ├─────────────────▶│                 │             │             │
   │             │ status=ready     │                 │             │             │
   │             ├──────────────────┼─────────────────┼─────────────┼────────────▶│
   │ POST publish│                  │                 │             │             │
   ├────────────▶│ transaction      │                 │             │             │
   │             ├──────────────────┼─────────────────┼─────────────┼────────────▶│
   │             │ purge cache      │                 │             │             │
   │  200        │                  │                 │             │             │
   │◀────────────┤                  │                 │             │             │
```

### 8.2 Verification steps (authoritative)

1. **Object sanity**
   - Size within 1 MB–300 MB.
   - ZIP magic `PK\x03\x04`, contains `AndroidManifest.xml`.
   - Reject if the object is encrypted or truncated.

2. **Manifest extraction** (`aapt2 dump badging`)
   - `package: name`, `versionCode`, `versionName`.
   - `sdkVersion`, `targetSdkVersion`.
   - Native ABIs, if any.
   - The extracted values must equal the values submitted in the draft. Any mismatch fails the release.

3. **Signature verification** (`apksigner verify --print-certs --verbose`)
   - At least one valid v2/v3 signature.
   - No signer errors.
   - Signing certificate SHA-256 must be in `signing_certs` for this app and active.
   - Reject debug certificates (`CN=Android Debug`).
   - Reject `android:debuggable="true"` and `android:testOnly="true"`.

4. **Content hash**
   - SHA-256 and SHA-512 computed server-side. Client-supplied hashes are ignored.
   - The SHA-256 becomes part of the object key and the published checksum.

5. **Malware scan**
   - ClamAV with an up-to-date signature database. This is a baseline, not a guarantee.
   - Optional VirusTotal **hash lookup only**. Do not upload a proprietary APK to VirusTotal without understanding that samples may be shared with security vendors.

6. **Policy checks**
   - `versionCode` monotonic within channel.
   - `packageName` matches the app.
   - `minSdk` not below the supported floor (currently 24 / Android 7.0).
   - Release notes present.
   - No yanked release is still marked current.

7. **Promotion**
   - Copy from `quarantine/{releaseId}/...` to
     `android/{channel}/{versionName}/{sha256}/docmac-{versionName}.apk`.
   - Set `Content-Type`, `Content-Disposition`, `Cache-Control: immutable`.
   - Enable object versioning. Never overwrite an existing key.
   - Delete the quarantine object after 7 days via lifecycle rule.

### 8.3 Failure handling

- Verification failure sets `status=failed`, stores the reason in `verification`, and notifies the uploader.
- The draft can be retried with a new upload; the failed object is deleted after 7 days.
- Publishing is blocked until every check passes.
- A failed publish transaction leaves the previous `is_current` release untouched.

---

## 9. Download pipeline

### 9.1 Public path

1. Website or app calls `/v1/apps/docmac/releases/{version}/download`.
2. Worker reads the release from KV/D1 (60-second cache).
3. If the release is not published or has been deleted, return `404` with a link to the catalogue.
4. If the release is yanked, return `410` with `X-Docmac-Yanked: true` and a replacement version, but keep the file accessible for users who already have links.
5. Return `302` to the immutable CDN URL.
6. Write an Analytics Engine data point: release ID, version, channel, country, timestamp. No IP, no user agent.
7. CDN serves the APK with range support and a one-year immutable cache.

### 9.2 Why redirect instead of streaming

- Workers have request duration and memory limits; a 60 MB stream is wasteful.
- CDN caching absorbs repeated downloads and supports resume.
- Counting remains possible because the redirect endpoint is hit first.
- Direct CDN links can be shared and will continue to work even if the API is down.

### 9.3 Download naming

New assets should be named `docmac-1.0.4.apk`, not `app-release.apk`. The object key is content-addressed, but the `Content-Disposition` filename is human-readable. Keep old GitHub URLs and old CDN keys indefinitely; disk is negligible (about 60 MB per version).

### 9.4 Rate limiting and abuse

- Cloudflare rate limit: 120 download redirects per minute per IP; 10 per minute for feedback.
- Bot Fight Mode and WAF managed rules in front of the API.
- Block obvious scraping user agents only if it does not harm real users. Downloads are public; do not over-engineer.
- If bandwidth abuse becomes a problem, issue short-lived signed CDN URLs instead of permanent public objects. This breaks long-term sharing, so treat it as a last resort.

---

## 10. In-app update protocol

The Android app should call the update endpoint on launch (or once per day) with its current `versionCode`, channel, and SDK level.

Recommended behaviour:

| Server response | App behaviour |
|---|---|
| `updateAvailable=false` | Continue silently |
| `updateAvailable=true, mandatory=false` | Dismissible bottom sheet with notes, size, and "Update" |
| `mandatory=true` | Blocking screen with a single "Update" action and support link |
| `410` / yanked | Recommend the nearest safe version; explain why |
| Network error | Never block the app; retry later |

Client-side safeguards:

1. Download the APK to app-private storage.
2. Verify SHA-256 against the update response **before** handing it to `PackageInstaller`.
3. Use `PackageInstaller.Session` with `setRequireUserAction` for a standard Android install prompt.
4. Handle `STATUS_PENDING_USER_ACTION` and `STATUS_FAILURE_*` explicitly.
5. Do not attempt silent installs; Android does not permit them for sideloaded apps.
6. Android enforces signature continuity, so never rotate the signing key without a migration plan.

The website should document the same checksum verification for manual downloads.

---

## 11. Security and supply chain

### 11.1 Release integrity

- Signing keystore stays offline. Two encrypted backups in separate physical locations.
- Publish the certificate SHA-256 on the website and in the manifest.
- Publish a `SHA256SUMS` file per release and a combined `checksums.txt`.
- Optional: sign the release manifest with `minisign` or `cosign`; publish the public key at `/.well-known/docmac-release.pub`.
- Use GitHub Environments with required reviewers for the production release workflow.
- Build reproducibility: record the Git commit SHA, Gradle version, and dependency lock hash in the release metadata.

### 11.2 API and admin

- Cloudflare Access for humans, with MFA enforced.
- Scoped, expiring CI tokens; store only SHA-256 hashes. Rotate after every compromise or staff change.
- CSRF protection on cookie-based admin mutations; prefer same-site cookies plus an origin check.
- Strict CORS: only `https://docmac.app`, `https://www.docmac.app`, and localhost in development.
- Request size limits and JSON schema validation on every endpoint.
- Idempotency keys on create/complete/publish.
- Audit log is append-only; export to R2 monthly.
- Admin UI must never expose a "delete published release" action.
- Separate production credentials from staging; no shared bucket tokens.

### 11.3 Site headers (Cloudflare Pages `_headers`)

```
/*
  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), microphone=(), camera=()
  Cross-Origin-Opener-Policy: same-origin
  Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self'; font-src 'self'; script-src 'self'; connect-src 'self' https://api.docmac.app; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

If fonts remain on Google Fonts, add `https://fonts.googleapis.com` to `style-src` and `https://fonts.gstatic.com` to `font-src`. Self-hosting is preferable.

### 11.4 Download surface

- R2 bucket has no public listing and no write access from the public domain.
- Public read is limited to the `android/` prefix; `quarantine/` is private.
- Presigned upload URLs expire in 15 minutes; enforce `content-length-range`.
- Object versioning on; lifecycle rules for quarantine cleanup.
- Cloudflare WAF in front of `downloads.docmac.app`.
- Monitor for unexpected objects and for signing-certificate changes.

### 11.5 Secrets

- Cloudflare API tokens scoped to R2 + Workers + D1, rotated every 90 days.
- GitHub secrets for keystore, keystore password, and API token.
- Prefer a hardware-backed keystore or an offline signing machine over a GitHub secret for long-term key safety.
- Never put credentials in `assets/`, `README.md`, or client-side JavaScript. The current config is safe (public URLs only); keep it that way.

---

## 12. Privacy and compliance

The site serves Nigerian users and may serve EU/UK users. Relevant frameworks include the Nigeria Data Protection Act 2023 and, where applicable, GDPR/UK GDPR.

Add to the privacy policy once the backend exists:

- What download data is collected: release ID, version, country, timestamp. IP addresses are not stored in raw form.
- Why: security, abuse prevention, aggregate download counts.
- Retention: raw events 30 days; aggregates 24 months; audit logs 24 months.
- Processors: Cloudflare (hosting, CDN, storage), email provider, error monitoring.
- No advertising cookies; no cross-site tracking. Theme preference stays in `localStorage`.
- How to request deletion of feedback data and how to contact the data controller.
- Legal entity name, registered address, and jurisdiction.
- Children's minimum age.
- International transfer safeguards if data leaves Nigeria.

Use cookie-free analytics (Cloudflare Web Analytics or Analytics Engine) to avoid a consent banner. If analytics changes to cookies or fingerprinting, add a consent mechanism before enabling it.

**Remove the internal "should be reviewed by counsel" notes** from public legal pages (`privacy.html`, `terms.html`). Keep those notes in an internal document.

Other compliance items:

- `/.well-known/security.txt` with a security contact and disclosure policy.
- Trademark/impersonation takedown contact for fake APK sites.
- Export-control and sanctions language if distributing broadly.
- A clear "no warranty" and "verify checksum" statement in the terms.
- APK distribution policy: no modified builds, no redistribution under the Docmac name.

---

## 13. Observability and operations

### 13.1 Metrics

| Metric | Target |
|---|---|
| API p95 latency | < 150 ms |
| API 5xx rate | < 0.5% |
| Download redirect success | > 99.9% |
| Verification success rate | > 98% (excluding bad uploads) |
| Time from upload to ready | < 3 minutes |
| CDN cache hit ratio | > 95% |
| Storage growth | < 5 GB per 100 releases |

### 13.2 Logs and alerts

- Structured JSON logs with `requestId`, route, status, latency, and release ID. Never log tokens or full IPs.
- Sentry for API and admin UI exceptions.
- Better Stack or UptimeRobot synthetic checks:
  - `GET /healthz`
  - `GET /v1/apps/docmac/releases/latest`
  - a range request (`bytes=0-1023`) against the latest CDN object, verifying `206` and `X-Checksum-Sha256`.
- Alerts: 5xx spike, verification failure spike, certificate expiring in 30 days, storage at 80%, unusual download volume, failed backup.

### 13.3 Runbooks

- **Bad release published:** yank it, publish a fixed higher `versionCode`, update the catalogue banner, notify users through the app.
- **Signing key compromised:** rotate the allowlist, publish a security notice, coordinate a reinstall path with users, revoke CI tokens, audit downloads.
- **R2 outage:** API returns `503` with a maintenance message; the website falls back to the static `/releases.json` snapshot and GitHub mirror URLs.
- **Database loss:** restore latest PITR snapshot, replay audit log, verify `is_current` pointers, purge caches.
- **Abuse spike:** enable stricter rate limits, require signed URLs temporarily, review WAF logs.

---

## 14. Backup and disaster recovery

| Asset | Mechanism | Frequency | Retention |
|---|---|---|---|
| APK objects | R2 versioning + cross-region copy | On write | Forever |
| APK mirror | GitHub Releases (existing) | On publish | Forever |
| Database | D1 Time Travel or Postgres PITR | Continuous | 30 days |
| Database dump | Nightly logical dump to R2 | Daily | 90 days |
| Audit log | Monthly export to R2 | Monthly | 7 years |
| Keystore | Offline encrypted backups, two locations | On rotation | Forever |
| Site source | Git | On commit | Forever |

Targets: **RPO 24 hours** (5 minutes with PITR), **RTO 1 hour**. Test a restore quarterly and record the result.

---

## 15. CI/CD

### 15.1 Site deployment

```yaml
# .github/workflows/deploy-site.yml
name: Deploy site
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Validate HTML and links
        run: npx --yes html-validate "*.html"
      - name: Build release snapshot
        run: node scripts/build-releases.mjs   # writes releases.json
      - uses: actions/upload-pages-artifact@v3
        with:
          path: .
      - uses: actions/deploy-pages@v4
```

Add a scheduled job that rebuilds `releases.json` from the API every 15 minutes, so the static fallback never goes stale. If hosting moves to Cloudflare Pages, use `wrangler pages deploy` and preview deployments per pull request.

### 15.2 APK release workflow

The active **Phase 0** workflow is `.github/workflows/release-apk.yml`. It builds the Flutter app with `flutter build apk`, signs it with the `KEYSTORE_*` secrets, and publishes a GitHub Release. The website's **Sync Releases** workflow then adds the release to `releases.json`. This path does not require the API or verifier to be deployed.

The target API flow below replaces the GitHub Release step after the backend is deployed:

```yaml
# Target flow: copy into the Flutter app repository after the API is live.
name: Release APK via API
on:
  workflow_dispatch:
    inputs:
      versionName:
        type: string
        required: true
      versionCode:
        type: string
        required: true
      channel:
        type: choice
        options: [stable, beta]
        default: stable
      notes:
        type: string
        required: true
permissions:
  contents: read
jobs:
  release:
    runs-on: ubuntu-latest
    environment: production   # requires manual approval
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: 17 }
      - uses: subosito/flutter-action@v2
        with: { channel: stable, cache: true }
      - name: Build signed APK
        run: |
          flutter build apk --release \
            --build-name="$VERSION_NAME" \
            --build-number="$VERSION_CODE"
        env:
          VERSION_NAME: ${{ inputs.versionName }}
          VERSION_CODE: ${{ inputs.versionCode }}
          KEYSTORE_BASE64: ${{ secrets.KEYSTORE_BASE64 }}
          KEYSTORE_PASSWORD: ${{ secrets.KEYSTORE_PASSWORD }}
          KEY_ALIAS: ${{ secrets.KEY_ALIAS }}
          KEY_PASSWORD: ${{ secrets.KEY_PASSWORD }}
      - name: Init release
        id: init
        run: node scripts/ci-init-release.mjs
        env:
          DOCMAC_API_TOKEN: ${{ secrets.DOCMAC_API_TOKEN }}
          DOCMAC_API_URL: ${{ secrets.DOCMAC_API_URL }}
          VERSION_NAME: ${{ inputs.versionName }}
          VERSION_CODE: ${{ inputs.versionCode }}
          CHANNEL: ${{ inputs.channel }}
          NOTES: ${{ inputs.notes }}
      - name: Upload APK
        run: |
          curl --fail --upload-file build/app/outputs/flutter-apk/app-release.apk \
            -H "Authorization: Bearer $DOCMAC_API_TOKEN" \
            "$UPLOAD_URL"
        env:
          UPLOAD_URL: ${{ steps.init.outputs.uploadUrl }}
          DOCMAC_API_TOKEN: ${{ secrets.DOCMAC_API_TOKEN }}
      - name: Complete and publish
        run: node scripts/ci-complete-release.mjs
        env:
          DOCMAC_API_TOKEN: ${{ secrets.DOCMAC_API_TOKEN }}
          DOCMAC_API_URL: ${{ secrets.DOCMAC_API_URL }}
          RELEASE_ID: ${{ steps.init.outputs.releaseId }}
          AUTO_PUBLISH: 'true'
```

Notes:

- Do not build production releases on a developer laptop. CI is the only path to production.
- Keep the keystore in the protected `production` environment, not in the repository.
- The API still re-verifies the APK; CI is trusted for building, not for truth.
- Publish only after the verification job returns `ready`. Either poll or receive a webhook.

### 15.3 Quality gates

- HTML validation and a broken-link check on every pull request.
- Lighthouse budget: performance ≥ 95, accessibility ≥ 95, best practices ≥ 95, SEO ≥ 95.
- API unit tests (Vitest) and integration tests against a MinIO/R2 test bucket.
- A fixture APK (debug-signed and release-signed) to test the verifier’s accept/reject paths.
- Contract tests for the manifest schema, so the site and API cannot drift.
- A pre-deploy check that `releases.json` contains the latest published version.

---

## 16. Front-end changes to consume the backend

1. **Replace hard-coded release markup** with a `<template>` rendered from `manifest.json`. Keep a `<noscript>` block with the latest version.
2. **Fetch strategy:** `fetch('/releases.json')` (static snapshot, same-origin, CDN-cached) in preference to the API. Update the snapshot every 15 minutes. This makes the site resilient to API outages and avoids CORS.
3. **Release card fields:** version, release date, size, minimum Android, SHA-256 (truncated, copy button), signing fingerprint, release notes, channel, yanked badge.
4. **Version list:** newest first, "Recommended" badge on the current release, filter by channel, and a "verify this download" disclosure.
5. **Per-release pages:** `/releases/1.0.4` with stable canonical metadata, notes, checksum, and a direct download. This is useful for support and sharing.
6. **QR code:** generate client-side (for example with a small local library) pointing at `https://docmac.app/download/latest`. Show it on desktop, hide it on Android.
7. **Android detection:** if the user agent is Android, prioritize the direct APK button. If not, show the QR and a short "open this page on your phone" note. Never block desktop downloads.
8. **Download feedback:** after the redirect, show "Your download has started" and the checksum, with a copy action.
9. **Offline fallback:** if the manifest fetch fails, keep the last known catalogue in `localStorage` and show a non-blocking notice.
10. **Remove duplicated version strings** from the hero, card, and `script.js`. One render function, one source.
11. **Cache busting:** use a content hash in the asset filename at build time instead of manual `?v=` values.
12. **Favicon and social image:** a 1200x630 `og:image` showing the app icon and version, plus a 180x180 `apple-touch-icon`.
13. **Retire the `mailto:`-only feedback flow** once `POST /feedback` exists. Show a ticket ID and a response expectation.

---

## 17. Migration from GitHub Releases

1. **Inventory.** Use the GitHub API to list every release, tag, asset, size, publication date, and download count.
2. **Backfill.** Download each APK once to a trusted machine. Compute SHA-256 and signature fingerprint; extract `versionCode`, `versionName`, `minSdk`, and ABIs.
3. **Import.** Create `apps` and `signing_certs` rows, then insert each release as `ready` with its production object key. Preserve `published_at` from GitHub.
4. **Verify.** Compare file sizes and hashes across GitHub and R2. Download one file from each environment and compare the SHA-256.
5. **Switch read path.** Point the website at `/releases.json` generated from the API. Keep GitHub URLs in the manifest as `mirrorUrl` for one release cycle.
6. **Freeze GitHub.** New releases go only through the API. Existing GitHub releases stay online as a mirror and are never deleted.
7. **Update the README** to describe the new release process and remove the manual HTML steps.

Do not delete any GitHub release until the new catalogue has been stable for at least 90 days and backups have been verified.

---

## 18. Delivery roadmap

### Phase 0 — Stop the drift (1–2 days)

- Generate `releases.json` from the GitHub API with a small script and a scheduled workflow.
- Render the site from it; add `v1.0.0`.
- Add per-version date, size, checksum, and notes (notes can start from the GitHub release body).
- Publish the signing certificate fingerprint for v1.0.4.
- Fix the drawer navigation, feedback form, desktop theme toggle, legal notes, and logo/font weight.
- Add canonical, sitemap, robots, OG image, and JSON-LD.

**Outcome:** every existing version is listed and verifiable, with zero backend.

### Phase 1 — Read-only release service (3–5 days)

- Create R2 buckets and a D1 database.
- Import all five releases with verified hashes.
- Deploy a read-only Worker: manifest, releases, latest, download redirect.
- Move the site to Cloudflare Pages (or keep GitHub Pages and fetch the API directly).
- Add `checksums.txt` and per-release pages.

**Outcome:** downloads are served from your own domain, independent of GitHub, and the catalogue is dynamic.

### Phase 2 — Publishing pipeline (1–2 weeks)

- Admin console behind Cloudflare Access.
- Draft → presigned upload → complete flow.
- Verifier container with `apksigner`, `aapt2`, SHA-256, ClamAV.
- Publish and yank transactions with audit log.
- CI release workflow.

**Outcome:** upload an APK in a browser, watch it verify, publish it. No HTML edits.

### Phase 3 — Update channel and feedback (1 week)

- `GET /update` endpoint and app-side integration.
- `POST /feedback` with Turnstile, rate limits, email notification, ticket ID.
- Analytics Engine counters and an admin stats view.
- Privacy policy update.

**Outcome:** in-app updates and a support loop that does not depend on the user's mail client.

### Phase 4 — Hardening (1 week)

- Security headers, WAF, rate limits, security.txt.
- Backups, restore drill, monitoring, alerts.
- Load test the redirect path.
- Documentation and runbooks.

**Estimated total:** 4–6 weeks for one developer, or 2–3 weeks for two, excluding app-side update work.

---

## 19. Cost estimate

Assumptions: 10 versions retained, 60 MB each (600 MB), 5,000 downloads per month, 50,000 API requests per month.

| Item | Monthly |
|---|---|
| Cloudflare Pages | $0 |
| Workers (100k requests/day free) | $0 |
| D1 (5 GB free) | $0 |
| R2 storage (600 MB, 10 GB free) | $0 |
| R2 operations (well within free tier) | $0 |
| R2 egress | $0 (no egress fee) |
| Cloudflare Access (≤50 users) | $0 |
| Analytics Engine / Web Analytics | $0 |
| Verifier container (scale to zero) | $0–5 |
| Email (Resend/Postmark free tier) | $0 |
| Domain | ~$1 |
| **Total** | **~$1–6/month** |

At 1 TB of downloads per month, R2 egress remains $0, which is the main economic reason to choose it over S3 or Supabase Storage.

---

## 20. Acceptance criteria

The release platform is complete when all of the following are true:

- [ ] Every GitHub release, including `v1.0.0`, appears on the site automatically.
- [ ] The site has a single source of truth for versions; no version string is hard-coded in HTML.
- [ ] Each release shows version, date, size, minimum Android, SHA-256, and signing fingerprint.
- [ ] A user can download any historical version from a stable, permanent URL.
- [ ] A published APK cannot be overwritten; a correction requires a new `versionCode`.
- [ ] An APK with the wrong package name, wrong signing certificate, debug flag, or a lower `versionCode` is rejected.
- [ ] Publishing is possible without editing HTML or JavaScript.
- [ ] A release can be yanked in under one minute, and the catalogue reflects it immediately.
- [ ] `checksums.txt` verifies with `sha256sum -c` and `certutil -hashfile`.
- [ ] The API returns the latest version in under 150 ms at p95.
- [ ] The site works with JavaScript disabled for the latest download and degrades gracefully for the catalogue.
- [ ] Mobile drawer links support normal click, Ctrl/Cmd-click, and middle-click.
- [ ] The feedback form cannot leak its contents into a URL.
- [ ] Lighthouse scores are ≥ 95 for performance, accessibility, best practices, and SEO.
- [ ] Security headers score A on a header scanner.
- [ ] A restore from backup has been performed and documented.
- [ ] The privacy policy describes download logs, retention, and processors.

---

## 21. Open decisions

1. **Domain:** is `docmac.app` (or another domain) owned and available for `api.` and `downloads.` subdomains?
2. **Hosting:** stay on GitHub Pages (no custom headers) or move the site to Cloudflare Pages?
3. **Database:** D1 for a self-contained edge stack, or Postgres because the app backend will use it too?
4. **Admin surface:** web console, CLI, or CI-only publishing? A console is recommended for non-engineers.
5. **Channels:** is a beta channel needed at launch, or only stable?
6. **Google Play:** will Docmac also ship on Play? If so, the distributed APK and the Play-signed build must share a signing identity or be documented as separate install paths.
7. **Support identity:** move to `support@docmac.app`, or keep the personal Gmail address publicly?
8. **Feedback:** keep `mailto:` or add server-side intake with email notification?
9. **Analytics:** cookie-free aggregate counting only, or full product analytics?
10. **Retention:** how long should feedback and download logs be kept?

---

## 22. References

- Android APK signature scheme: <https://source.android.com/docs/security/features/apksigning>
- `apksigner`: <https://developer.android.com/tools/apksigner>
- `PackageInstaller`: <https://developer.android.com/reference/android/content/pm/PackageInstaller>
- Cloudflare R2: <https://developers.cloudflare.com/r2/>
- Cloudflare Workers: <https://developers.cloudflare.com/workers/>
- Cloudflare D1: <https://developers.cloudflare.com/d1/>
- Cloudflare Access: <https://developers.cloudflare.com/cloudflare-one/policies/access/>
- RFC 9457 problem details: <https://www.rfc-editor.org/rfc/rfc9457>
- Nigeria Data Protection Act 2023: <https://ndpc.gov.ng/>
- security.txt: <https://securitytxt.org/>

---

*This document is an engineering proposal, not legal advice. Have the privacy policy and terms reviewed by qualified counsel before public launch.*
