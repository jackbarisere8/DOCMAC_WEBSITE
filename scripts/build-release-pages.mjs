#!/usr/bin/env node
/**
 * Generates per-release HTML pages and the XML sitemap for every published
 * version in releases.json.
 *
 * Usage: node scripts/build-release-pages.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const RELEASES_PATH = path.join(ROOT, 'releases.json');
const OUTPUT_DIR = path.join(ROOT, 'releases');
const SITEMAP_PATH = path.join(ROOT, 'sitemap.xml');

const SITE_URL = 'https://jackbarisere8.github.io/DOCMAC_WEBSITE';
const SITE_UPDATED = '2026-10-26';
const ASSET_VERSION = '20261026-1';

const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character],
  );

const escapeXml = (value) => escapeHtml(value);

function safeHttpsUrl(value, fallback) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' ? url.href : fallback;
  } catch {
    return fallback;
  }
}

function formatDate(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return 'Date not published';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function dateOnly(isoDate) {
  const date = new Date(isoDate);
  return Number.isNaN(date.getTime()) ? SITE_UPDATED : date.toISOString().slice(0, 10);
}

function renderReleasePage(release, latest, allReleases) {
  const isLatest = release.tag === latest.tag;
  const version = escapeHtml(release.versionName);
  const latestVersion = escapeHtml(latest.versionName);
  const canonicalUrl = `${SITE_URL}/releases/${encodeURIComponent(release.versionName)}.html`;
  const badgeLabel = release.yanked
    ? 'Withdrawn build'
    : isLatest
      ? 'Latest release'
      : release.channel === 'beta'
        ? 'Beta release'
        : 'Historical release';
  const badgeClass = `release-badge-lg${release.yanked ? ' is-warn' : ''}`;
  const robots = release.yanked ? 'noindex,follow' : 'index,follow';
  const published = escapeHtml(formatDate(release.publishedAt));
  const size = escapeHtml(release.sizeLabel || 'Signed APK');
  const minAndroid = escapeHtml(release.minAndroid || '7.0');
  const sha = escapeHtml(release.sha256 || 'Not published');
  const cert = escapeHtml(release.signatureSha256 || 'Not published');
  const fileName = escapeHtml(release.fileName || 'app-release.apk');
  const downloadUrl = escapeHtml(
    safeHttpsUrl(release.downloadUrl, 'https://github.com/jackbarisere8/DOCMAC/releases'),
  );
  const releaseUrl = escapeHtml(
    safeHttpsUrl(release.releaseUrl, 'https://github.com/jackbarisere8/DOCMAC/releases'),
  );
  const notes = escapeHtml(release.releaseNotes || 'No release notes were published for this build.');
  const shortSha = escapeHtml(String(release.sha256 || '').slice(0, 16));

  const latestLink = !isLatest
    ? `<a href="${latestVersion}.html">View latest release (v${latestVersion})</a>`
    : '';

  const yankedNotice = release.yanked
    ? '<p class="notice-card"><strong>This release was withdrawn.</strong> It is kept for historical verification only. <a href="../index.html#download">Download the latest supported release</a>.</p>'
    : '';

  const versionLinks = allReleases
    .map((entry) => {
      const entryVersion = escapeHtml(entry.versionName);
      const current = entry.versionName === release.versionName;
      const latestEntry = entry.versionName === latest.versionName;
      const label = `v${entryVersion}${latestEntry ? ' (latest)' : ''}`;
      return `<a href="${entryVersion}.html"${current ? ' aria-current="page"' : ''}>${label}</a>`;
    })
    .join('\n          ');

  const heroAsideBadge = release.yanked
    ? 'Withdrawn build'
    : isLatest
      ? 'Latest release'
      : 'Signed archive';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light dark" />
  <meta name="theme-color" content="#07150a" />
  <meta name="description" content="Download Docmac v${version} APK for Android. SHA-256 checksum, release notes, and signing certificate verification." />
  <meta name="author" content="Docmac" />
  <meta name="robots" content="${robots}" />
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />

  <meta property="og:site_name" content="Docmac" />
  <meta property="og:title" content="Docmac v${version} — Signed Android release" />
  <meta property="og:description" content="Download the official Docmac v${version} APK. Signed build, SHA-256: ${shortSha}…" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
  <meta property="og:image" content="${SITE_URL}/assets/images/og-image.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="Docmac — Your people, close. Official Android release." />
  <meta property="og:locale" content="en_NG" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Docmac v${version} — Signed Android release" />
  <meta name="twitter:description" content="Official Docmac v${version} Android release. Download the APK and compare checksums." />
  <meta name="twitter:image" content="${SITE_URL}/assets/images/og-image.png" />

  <title>Docmac v${version} — Release details &amp; download</title>

  <link rel="icon" href="../assets/images/favicon.ico" sizes="48x48" />
  <link rel="icon" type="image/png" sizes="32x32" href="../assets/images/favicon-32.png" />
  <link rel="icon" type="image/png" sizes="16x16" href="../assets/images/favicon-16.png" />
  <link rel="apple-touch-icon" href="../assets/images/apple-touch-icon.png" />
  <link rel="manifest" href="../site.webmanifest" />

  <link rel="preload" href="../assets/fonts/plus-jakarta-sans-normal-400-800-latin.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="preload" href="../assets/fonts/plus-jakarta-sans-italic-500-700-latin.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="stylesheet" href="../assets/fonts.css?v=${ASSET_VERSION}" />
  <link rel="stylesheet" href="../assets/styles.css?v=${ASSET_VERSION}" />

  <script>
    (function () {
      document.documentElement.classList.add('js');
      try {
        var stored = localStorage.getItem('docmac-theme');
        if (stored !== 'light' && stored !== 'dark' && stored !== 'auto') {
          var legacy = localStorage.getItem('docmac-drawer-theme');
          stored = legacy === 'light' || legacy === 'dark' ? legacy : 'auto';
        }
        var dark = stored === 'dark' || (stored === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        if (dark) document.documentElement.classList.add('site-dark');
      } catch (error) {
        /* The page still works when storage is unavailable. */
      }
    })();
  </script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>

  <header class="site-header">
    <div class="shell nav-shell">
      <a class="brand" href="../index.html" aria-label="Docmac home">
        <img class="brand-mark" src="../assets/images/docmac-mark-white.webp" alt="" width="29" height="29" />
        <span class="brand-word">docmac<span class="brand-dot">.</span></span>
      </a>

      <nav id="site-navigation" class="nav-links" aria-label="Primary navigation">
        <a class="nav-link" href="../index.html#why-docmac">Why Docmac</a>
        <a class="nav-link" href="../index.html#how-it-works">Getting started</a>
        <a class="nav-link" href="../index.html#releases">Releases</a>
        <a class="nav-link" href="../index.html#download">Download</a>
        <a class="nav-link" href="../support.html">Support</a>
        <a class="nav-link" href="../feedback.html">Feedback</a>
        <div class="drawer-appearance">
          <span>Appearance</span>
          <div role="group" aria-label="Color theme">
            <button type="button" data-theme="light">Light</button>
            <button type="button" data-theme="dark">Dark</button>
            <button type="button" data-theme="auto">System</button>
          </div>
        </div>
      </nav>

      <div class="nav-tools">
        <button id="theme-toggle" class="theme-toggle" type="button" aria-label="Switch to dark theme" aria-pressed="false">
          <span data-theme-icon aria-hidden="true"><svg class="icon"><use href="../assets/icons.svg#i-moon"></use></svg></span>
        </button>
        <a class="nav-cta" href="${downloadUrl}" rel="noopener">
          <span>Download APK</span>
          <span class="btn-badge" aria-hidden="true"><svg class="icon"><use href="../assets/icons.svg#i-download"></use></svg></span>
        </a>
        <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="site-navigation" aria-label="Open navigation menu"><span></span><span></span><span></span></button>
      </div>
    </div>
  </header>

  <main id="main">
    <section class="page-hero" aria-labelledby="release-title">
      <div class="page-hero-media">
        <img src="../assets/images/editorial/phone.webp" alt="" width="1200" height="1200" fetchpriority="high" decoding="async" />
      </div>
      <div class="page-hero-shade"></div>
      <div class="page-hero-glow"></div>
      <div class="shell page-hero-inner">
        <div data-reveal>
          <nav class="breadcrumb" aria-label="Breadcrumb">
            <a href="../index.html">Home</a>
            <svg class="icon" aria-hidden="true"><use href="../assets/icons.svg#i-chevron-right"></use></svg>
            <a href="../index.html#releases">Releases</a>
            <svg class="icon" aria-hidden="true"><use href="../assets/icons.svg#i-chevron-right"></use></svg>
            <span aria-current="page">v${version}</span>
          </nav>
          <h1 class="display" id="release-title">Docmac<br /><em>v${version}.</em></h1>
          <p class="lede">${isLatest ? 'The current' : 'An archived'} Docmac build, published ${published} for Android ${minAndroid} and newer. Download the signed APK, then compare its checksum before installing.</p>
        </div>

        <aside class="page-hero-aside glass" aria-label="Release summary" data-reveal style="--reveal-delay: 90ms;">
          <span class="hud-source-icon" aria-hidden="true"><svg class="icon"><use href="../assets/icons.svg#i-shield-check"></use></svg></span>
          <strong>${heroAsideBadge}</strong>
          <p>One signing identity across the archive. The APK and its SHA-256 are published together on GitHub Releases.</p>
          <div class="pill-row">
            <span class="pill">v${version}</span>
            <span class="pill">${size}</span>
            <span class="pill">Android ${minAndroid}+</span>
          </div>
          <a class="text-link" href="#integrity">Verify this build <svg class="icon" aria-hidden="true"><use href="../assets/icons.svg#i-arrow-down"></use></svg></a>
        </aside>
      </div>
    </section>

    <div class="page-body section-paper page-body-last">
      <div class="shell legal-layout">
        <nav class="page-toc" aria-label="On this page">
          <strong>All versions</strong>
          ${versionLinks}
          <a class="toc-back" href="../index.html">Back to home</a>
        </nav>

        <article class="legal-copy release-copy" data-reveal>
          <p class="legal-meta"><strong>Published:</strong> ${published} · ${size} · Android ${minAndroid}+</p>

          <div class="release-meta-row">
            <span class="${badgeClass}">${badgeLabel}</span>
            ${latestLink}
          </div>

          ${yankedNotice}

          <section id="download">
            <h2>Download</h2>
            <p>This build is distributed directly as an official signed Android APK. Older versions stay online for compatibility and verification.</p>
            <div class="release-download-card">
              <p>
                <strong>${fileName}</strong>
                <span>Docmac v${version} · ${size} · Android ${minAndroid}+</span>
              </p>
              <a class="btn btn-primary" href="${downloadUrl}" rel="noopener" aria-label="Download Docmac v${version} APK">
                <span>Download v${version}</span>
                <span class="btn-badge" aria-hidden="true"><svg class="icon"><use href="../assets/icons.svg#i-download"></use></svg></span>
              </a>
            </div>
          </section>

          <section id="notes">
            <h2>Release notes</h2>
            <div class="release-notes-card">
              <p>${notes}</p>
            </div>
          </section>

          <section id="integrity">
            <h2>Cryptographic integrity</h2>
            <p>Compare the SHA-256 hash on your device before installing to ensure the file matches the official build. The GitHub asset is named <code>${fileName}</code>.</p>

            <div class="integrity-row">
              <span class="integrity-label">SHA-256</span>
              <code id="release-sha">${sha}</code>
              <button class="copy-button" type="button" data-copy-target="release-sha" data-copy="${sha}"${release.sha256 ? '' : ' disabled'}>Copy</button>
            </div>

            <div class="integrity-row">
              <span class="integrity-label">Signing cert</span>
              <code id="release-cert">${cert}</code>
              <button class="copy-button" type="button" data-copy-target="release-cert" data-copy="${cert}"${release.signatureSha256 ? '' : ' disabled'}>Copy</button>
            </div>

            <details class="verify-help">
              <summary>How to verify this file <span aria-hidden="true">+</span></summary>
              <p>On Windows, open PowerShell in your Downloads folder and run:</p>
              <pre><code>certutil -hashfile ${fileName} SHA256</code></pre>
              <p>On macOS or Linux:</p>
              <pre><code>sha256sum ${fileName}</code></pre>
              <p>To inspect the signing certificate on a computer with Android build tools:</p>
              <pre><code>apksigner verify --print-certs ${fileName}</code></pre>
              <p>A checksum confirms the file matches what was published; Android still performs its own install checks.</p>
            </details>

            <div class="page-actions">
              <a class="btn btn-ghost" href="../checksums.txt">
                <span>All checksums</span>
                <span class="btn-badge" aria-hidden="true"><svg class="icon"><use href="../assets/icons.svg#i-file-check-2"></use></svg></span>
              </a>
              <a class="btn btn-ghost" href="${releaseUrl}" rel="noopener">
                <span>View on GitHub</span>
                <span class="btn-badge" aria-hidden="true"><svg class="icon"><use href="../assets/icons.svg#i-external-link"></use></svg></span>
              </a>
            </div>

            <p>The checksums file names each APK as <code>docmac-${version}.apk</code>; rename your download before running <code>sha256sum -c checksums.txt</code>.</p>
          </section>
        </article>
      </div>
    </div>
  </main>

  <footer class="site-footer">
    <div class="shell">
      <div class="footer-top">
        <div class="footer-brand">
          <a class="brand" href="../index.html" aria-label="Docmac home">
            <img class="brand-mark" src="../assets/images/docmac-mark-white.webp" alt="" width="29" height="29" />
            <span class="brand-word">docmac<span class="brand-dot">.</span></span>
          </a>
          <p>A private space for the conversations, calls, and small moments that keep real friendships alive.</p>
          <a class="text-link" href="../index.html#download">Download Docmac <svg class="icon" aria-hidden="true"><use href="../assets/icons.svg#i-arrow-up-right"></use></svg></a>
        </div>
        <div class="footer-cols">
          <div class="footer-col">
            <span>Product</span>
            <a href="../index.html#why-docmac">Why Docmac</a>
            <a href="../index.html#releases">Release archive</a>
            <a href="../index.html#download">Download</a>
          </div>
          <div class="footer-col">
            <span>Help</span>
            <a href="../support.html">Support</a>
            <a href="../feedback.html">Feedback</a>
            <a href="https://github.com/jackbarisere8/DOCMAC/releases">GitHub releases</a>
          </div>
          <div class="footer-col">
            <span>Legal</span>
            <a href="../privacy.html">Privacy</a>
            <a href="../terms.html">Terms</a>
            <a href="../checksums.txt">Checksums</a>
          </div>
        </div>
      </div>
      <div class="footer-bottom">
        <span>© <span data-year>2026</span> Docmac. Private communication, built around people.</span>
        <span>Signed Android releases · GitHub Pages</span>
      </div>
    </div>
  </footer>

  <script src="../assets/script.js?v=${ASSET_VERSION}"></script>
</body>
</html>`;
}

function renderSitemap(latest, releases) {
  const entries = [
    {
      loc: `${SITE_URL}/`,
      lastmod: dateOnly(latest.publishedAt),
      changefreq: 'weekly',
      priority: '1.0',
    },
    ...releases
      .filter((release) => !release.yanked)
      .map((release) => ({
        loc: `${SITE_URL}/releases/${encodeURIComponent(release.versionName)}.html`,
        lastmod: dateOnly(release.publishedAt),
        changefreq: 'never',
        priority: release.tag === latest.tag ? '0.8' : '0.5',
      })),
    {
      loc: `${SITE_URL}/support.html`,
      lastmod: SITE_UPDATED,
      changefreq: 'monthly',
      priority: '0.8',
    },
    {
      loc: `${SITE_URL}/feedback.html`,
      lastmod: SITE_UPDATED,
      changefreq: 'monthly',
      priority: '0.7',
    },
    {
      loc: `${SITE_URL}/privacy.html`,
      lastmod: SITE_UPDATED,
      changefreq: 'monthly',
      priority: '0.6',
    },
    {
      loc: `${SITE_URL}/terms.html`,
      lastmod: SITE_UPDATED,
      changefreq: 'monthly',
      priority: '0.6',
    },
  ];

  const body = entries
    .map(
      (entry) => `  <url>
    <loc>${escapeXml(entry.loc)}</loc>
    <lastmod>${entry.lastmod}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(RELEASES_PATH, 'utf8'));
  const latest = manifest.latest;
  const releases = manifest.releases;

  if (!latest || !Array.isArray(releases) || !releases.length) {
    throw new Error('releases.json does not contain a latest release and release list.');
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Remove stale generated pages, but never touch unrelated files.
  const generatedPage = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.html$/;
  for (const file of fs.readdirSync(OUTPUT_DIR)) {
    if (generatedPage.test(file)) fs.rmSync(path.join(OUTPUT_DIR, file), { force: true });
  }

  for (const release of releases) {
    const html = renderReleasePage(release, latest, releases).replace(/[ \t]+$/gm, '');
    const fileName = `${release.versionName}.html`;
    const filePath = path.join(OUTPUT_DIR, fileName);
    fs.writeFileSync(filePath, html, 'utf8');

    // Keep the v-prefixed aliases used by older links.
    const vAlias = path.join(OUTPUT_DIR, `v${release.versionName}.html`);
    fs.writeFileSync(vAlias, html, 'utf8');

    console.log(`Wrote ${path.relative(ROOT, filePath)} and ${path.relative(ROOT, vAlias)}`);
  }

  fs.writeFileSync(SITEMAP_PATH, renderSitemap(latest, releases), 'utf8');
  console.log(`Wrote ${path.relative(ROOT, SITEMAP_PATH)} with ${releases.filter((release) => !release.yanked).length + 5} URLs.`);
}

main();
