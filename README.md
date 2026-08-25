# Docmac Website

The static Android release site for Docmac. It is designed for GitHub Pages and contains no Firebase credentials, signing keys, or private configuration.

## Release configuration

The download link and version are maintained in `assets/script.js`:

- `downloadUrl` must point to the published GitHub release asset.
- `releaseUrl` should point to the matching GitHub release notes page.
- Update `version` and the APK size in `index.html` with each release.

The current site expects the release asset to be named `app-release.apk` in the `jackbarisere8/DOCMAC` repository.

## Publishing

Publish this repository with GitHub Pages from the `main` branch and `/root`, or deploy the directory with any static host. Verify the GitHub release exists before publishing a new download link.
