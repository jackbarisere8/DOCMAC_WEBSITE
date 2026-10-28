# DOCMAC Website & Release Platform

The official landing page, release catalogue, and download-verification site for **Docmac**, a private, people-first Android communication app.

- **Live static site:** https://jackbarisere8.github.io/DOCMAC_WEBSITE/
- **APK distribution:** https://github.com/jackbarisere8/DOCMAC/releases
- **Support:** jackbarisere8@gmail.com

## Current status

| Area | Status | Notes |
|---|---|---|
| Phase 0 — static website and release catalogue | **Implemented and deployable** | `releases.json` drives the download card, release history, checksums, and generated release pages. |
| Phase 1 — release API and database | Implemented and tested locally | Not deployed. No public API or database is live. |
| Phase 2 — admin upload, verifier, and audit trail | Implemented and tested locally | Not deployed. APKs are currently published through GitHub Releases. |
| Phase 3 — update checks, feedback API, and telemetry | Implemented and tested locally | Not deployed. The public feedback form uses `mailto:` only. |
| Phase 4 — hardening, backups, monitoring, and runbooks | Implemented and tested locally | Operational documents describe the target Cloudflare deployment. |

> `api.docmac.app`, `downloads.docmac.app`, Cloudflare D1/R2, and the feedback/update APIs are **target infrastructure, not live services**. The public website does not call them.

## What the static site includes

- **Single source of truth:** every published GitHub release is synced into `releases.json`, including `v1.0.0` through the current version.
- **Downloads:** direct links to official signed APK assets on GitHub Releases.
- **Integrity:** SHA-256 and SHA-512 hashes, the APK signing-certificate SHA-256 fingerprint, and a `sha256sum`-compatible `checksums.txt`.
- **Release history:** dates, sizes, minimum Android version, curated notes, and permanent pages such as `releases/1.0.4.html`.
- **Accessibility and theming:** mobile drawer with focus trap, Escape handling, skip link, reduced-motion support, and persistent light/dark/system themes.
- **Assets:** self-hosted WOFF2 fonts, responsive WebP/PNG logos, favicons, PWA icons, and an Open Graph image.
- **SEO:** canonical URLs, Open Graph/Twitter cards, `SoftwareApplication` JSON-LD, `sitemap.xml`, and `robots.txt`.
- **Legal and support:** privacy, terms, support, feedback, and a styled 404 page.
- **Security contact:** `/.well-known/security.txt` plus a root `security.txt` compatibility copy.

## Project structure

```text
.
├── .github/workflows/
│   ├── deploy-site.yml        Build _site/ and deploy it to GitHub Pages
│   ├── validate.yml           Build, link/checksum validation, and test suite
│   ├── sync-releases.yml      Sync GitHub Releases and trigger deployment
│   └── release-apk.yml        Phase 0 Flutter build → GitHub Release pipeline
├── .well-known/security.txt   Security disclosure contact
├── assets/
│   ├── fonts/                 Self-hosted subset WOFF2 fonts
│   ├── images/                Logo variants, favicons, QR code, OG image
│   ├── fonts.css              Font-face declarations
│   ├── script.js              Theme, drawer, manifest rendering, copy, feedback
│   └── styles.css             Responsive light/dark styles
├── backend/                   Target Cloudflare Worker, D1, R2, and tests
├── data/
│   ├── apk-integrity.json     Cached hashes, sizes, and signing certificates
│   └── release-meta.json      Curated notes, channels, and app metadata
├── docs/
│   ├── BACKEND_ARCHITECTURE.md Target architecture and audit
│   └── RUNBOOKS.md            Target incident-response procedures
├── releases/                  Generated per-version pages
├── scripts/
│   ├── build-images.py        Responsive logo and favicon generator
│   ├── build-release-pages.mjs Generated release pages and sitemap
│   ├── build-site.mjs         Stages only public files into _site/
│   ├── fetch-fonts.mjs        Downloads and self-hosts fonts
│   ├── generate-qr.py         Verifiable SVG QR generator (V4/V5-M)
│   ├── health-check.mjs       Target API/edge synthetic probe
│   ├── sync-releases.mjs      Syncs, hashes, and verifies APK assets
│   └── validate.mjs           Links, anchors, manifest, checksum validation
├── verifier/                  Target containerized APK verifier
├── _headers                   Cloudflare Pages headers (ignored by GitHub Pages)
├── _redirects                 Cloudflare Pages redirects (ignored by GitHub Pages)
├── checksums.txt              Canonical SHA-256 checksums for all APKs
├── index.html                 Dynamic release and download page
├── releases.json              Generated public release manifest
├── site.webmanifest           PWA manifest
├── sitemap.xml                Generated XML sitemap
└── *.html                     Support, feedback, privacy, terms, and 404 pages
```

## Local development

Node.js 24 or newer is required. The site itself has no runtime dependencies.

```bash
# Regenerate release pages and the deployable _site/ directory
npm run build

# Build only the release pages and sitemap
npm run build:pages

# Stage only public files for deployment
npm run build:site

# Validate links, anchors, fonts, manifest, checksums, and generated pages
npm run validate

# Run all backend/release-service tests
npm test
```

Preview the exact deployment artifact locally:

```bash
python -m http.server 8080 --directory _site
```

`npm run build` writes `_site/`; that directory is gitignored. The deployment artifact excludes `backend/`, `verifier/`, `scripts/`, `docs/`, `data/`, `.cache/`, `.git/`, and the Cloudflare-only `_headers`/`_redirects` files.

## Publishing a new APK

1. Copy `.github/workflows/release-apk.yml` into the Flutter app repository (`jackbarisere8/DOCMAC`) and run **Release APK** from its Actions tab. The workflow builds a signed APK using the `KEYSTORE_*` secrets and publishes it as GitHub Release `v<versionName>`. Publishing the GitHub Release manually with an `app-release.apk` asset also works.

   Run the workflow from the app repository, not this website repository. Add `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, and `KEY_PASSWORD` to the app repository's `production` environment. `KEYSTORE_BASE64` is the single-line base64 encoding of `android/keystore/docmac-upload.jks`; the other values are the entries in `android/key.properties`. Add `WEBSITE_SYNC_TOKEN` there too if the release should trigger the website sync immediately.
2. Optionally add curated notes and channel metadata for the version in `data/release-meta.json`.
3. Run the sync:

   ```bash
   node scripts/sync-releases.mjs
   ```

   The sync downloads any missing APK, computes SHA-256/SHA-512 and the signing-certificate fingerprint, prunes stale integrity entries, updates `releases.json`, and rewrites `checksums.txt`.
4. Rebuild generated pages and validate:

   ```bash
   npm run build
   npm run validate
   npm test
   ```

5. Commit and push `releases.json`, `checksums.txt`, `data/apk-integrity.json`, `releases/`, and `sitemap.xml`.

The **Sync Releases** workflow performs steps 3–5 every six hours, or on demand. After committing a catalogue change it dispatches **Deploy Site** explicitly, because commits pushed with `GITHUB_TOKEN` do not trigger other workflows.

The release workflow can dispatch that sync immediately when `WEBSITE_SYNC_TOKEN` is configured in the app repository's `production` environment. The token needs Actions write access to `jackbarisere8/DOCMAC_WEBSITE`; without it, the next scheduled sync updates the site within six hours. The future API/verifier pipeline remains documented in `docs/BACKEND_ARCHITECTURE.md` and is not deployed.

## Verifying downloads

`checksums.txt` uses the canonical filename pattern `docmac-<version>.apk`. GitHub serves every asset as `app-release.apk`, so rename the downloaded file before verifying:

```bash
mv app-release.apk docmac-1.0.4.apk
sha256sum -c checksums.txt
```

Or verify a single file:

```bash
# Linux / macOS
sha256sum docmac-1.0.4.apk

# Windows PowerShell / Command Prompt
certutil -hashfile docmac-1.0.4.apk SHA256

# Android signing certificate
apksigner verify --print-certs docmac-1.0.4.apk
```

Compare the certificate SHA-256 with the fingerprint published in `releases.json` and on the homepage.

## Backend target architecture (not deployed)

The release service is a Cloudflare Workers application with D1 metadata, R2 object storage, a containerized APK verifier, and an admin console. Its tests run locally with Node's built-in test runner and an in-memory D1-compatible database.

```bash
npm test
npm run test:api
npm run test:admin
npm run test:phase3
npm run test:phase4

# Local/target operational scripts
npm run backup
npm run restore:drill
npm run health:local
npm run load:test
```

### Target API design

These routes are **not live**. They document the implemented Worker and its tests.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/healthz` | Liveness and service status |
| `GET` | `/v1/apps/docmac/manifest.json` | Release catalogue |
| `GET` | `/v1/apps/docmac/releases` | Paginated catalogue |
| `GET` | `/v1/apps/docmac/releases/latest` | Latest published release |
| `GET` | `/v1/apps/docmac/releases/:version` | Single release details |
| `GET` | `/v1/apps/docmac/releases/:version/download` | Redirect to the APK asset |
| `GET` | `/v1/apps/docmac/update` | In-app update check |
| `GET` | `/v1/apps/docmac/checksums.txt` | Checksums file |
| `POST` | `/v1/feedback` | Feedback intake |
| `GET` | `/admin` | Admin console |
| `POST` | `/v1/admin/releases` | Create draft and presigned upload |
| `PUT` | `/v1/admin/releases/:id/upload` | Upload APK to quarantine |
| `POST` | `/v1/admin/releases/:id/complete` | Verify uploaded APK |
| `POST` | `/v1/admin/releases/:id/publish` | Publish atomically |
| `POST` | `/v1/admin/releases/:id/yank` | Yank with fallback |
| `GET` | `/v1/admin/audit` | Audit trail |

To deploy the Worker later:

```bash
cd backend
npx wrangler d1 migrations apply DB --remote
npx wrangler deploy
```

See [`docs/BACKEND_ARCHITECTURE.md`](docs/BACKEND_ARCHITECTURE.md) and [`docs/RUNBOOKS.md`](docs/RUNBOOKS.md). Both documents describe target infrastructure.

## Hosting notes

- **GitHub Pages (current):** `deploy-site.yml` uploads only `_site/`. GitHub Pages cannot apply custom response headers.
- **Cloudflare Pages (optional future host):** `_headers` and `_redirects` are provided and now point only at working GitHub release assets. They have no effect on GitHub Pages.
- The custom domains `docmac.app`, `api.docmac.app`, and `downloads.docmac.app` are **not verified or live**. Do not add public links or form actions that depend on them until DNS, TLS, and the services are actually deployed.

## Security

Do not commit keystores, signing passwords, API tokens, database dumps, or other secrets. Report vulnerabilities to **jackbarisere8@gmail.com**; see [`/.well-known/security.txt`](.well-known/security.txt).
