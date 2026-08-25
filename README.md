# DOCMAC Website

The official landing page and Android download site for **Docmac** — a private, people-first communication app.

## What is included

- A responsive product and APK release page
- Direct Android APK download from the official DOCMAC GitHub release
- Installation guidance and frequently asked questions
- Email and WhatsApp support links
- A feedback page that creates a prefilled email to the Docmac team
- Privacy policy, terms, support, and 404 pages

## Project structure

```text
.
├── index.html          Main release and download page
├── support.html        Installation help and direct support
├── feedback.html       Product-feedback form
├── privacy.html        Privacy information
├── terms.html          Terms of use
├── 404.html             Fallback page for GitHub Pages
└── assets/
    ├── images/         DOCMAC logo
    ├── script.js       Release and feedback configuration
    └── styles.css      Shared responsive styles
```

## Update for a new Android release

1. Create a GitHub Release in [`jackbarisere8/DOCMAC`](https://github.com/jackbarisere8/DOCMAC).
2. Upload the signed APK using the expected asset name: `app-release.apk`.
3. In `assets/script.js`, update `version` and confirm `downloadUrl` and `releaseUrl` point to that release.
4. In `index.html`, update the APK size and release date shown in the release card.
5. Commit and push this repository. GitHub Pages will publish the new site version.

## Support configuration

Support currently routes to:

- Email: [jackbarisere8@gmail.com](mailto:jackbarisere8@gmail.com)
- WhatsApp: `+234 904 787 6270`

The feedback form does not store submissions on the website. It opens the visitor's email application with a prepared message, so users remain in control before sending.

## Publish with GitHub Pages

In GitHub, open **Settings → Pages** for this repository. Under **Build and deployment**, choose **Deploy from a branch**, select `main`, then select `/ (root)` and save. The `.nojekyll` file ensures GitHub Pages serves the static site as-is.

## Local preview

This is a static website. Open `index.html` in a browser for a quick visual check, or serve the folder using any local static-file server.

## Security note

Do not add Firebase credentials, signing keys, keystores, or private environment files to this repository.
