# Docmac Verifier Container Service

The Verifier Container is an authoritative validation environment that inspects sideloaded Android APKs before they are promoted to production CDN keys and published in the release catalogue.

## Architecture

Following **Section 8 of `docs/BACKEND_ARCHITECTURE.md`**:

```
Upload (Quarantine) ──▶ Verifier ──[Pass]──▶ Promotion to CDN Key (Ready) ──▶ Published
                                ──[Fail]──▶ Status: Failed (Quarantine purged)
```

### Verification Pipeline Checks

1. **Object Sanity:** Validates file size (1 MB – 300 MB) and ZIP integrity (`PK\x03\x04`).
2. **Manifest Extraction:** Decodes `AndroidManifest.xml` binary structure to verify `packageName`, `versionCode`, `versionName`, `minSdkVersion`, and `targetSdkVersion`.
3. **Signature Verification:** Parses the APK Signing Block (Scheme v2/v3), extracts the X.509 certificate, computes its SHA-256 fingerprint, and verifies against active certificates in `signing_certs`.
4. **Debug Flag Enforcement:** Confirms `android:debuggable` and `android:testOnly` are strictly absent.
5. **Malware Scan:** Runs ClamAV antivirus inspection.
6. **Policy Validation:** Asserts monotonic `versionCode` strictly greater than any existing published release.

## Running Locally

```bash
docker build -f verifier/Dockerfile -t docmac-verifier .
docker run -p 8080:8080 docmac-verifier
```

## API

- `GET /healthz` - Liveness health check
- `POST /verify` - Inspects APK payload and returns verification JSON report

