# Docmac Production Incident Runbooks

> **Target infrastructure — not deployed.** These runbooks describe the planned Cloudflare Workers/D1/R2 release service (`api.docmac.app`, `downloads.docmac.app`). Those services are not live. The current public site is static on GitHub Pages and distributes APKs through GitHub Releases.
>
> Operational procedures for the release service.  
> Aligned with Section 13.3 and Section 14 of [`BACKEND_ARCHITECTURE.md`](BACKEND_ARCHITECTURE.md).

---

## Table of Contents
1. [General Incident Response Workflow](#1-general-incident-response-workflow)
2. [Runbook 1: Bad or Malfunctioning Release Published](#runbook-1-bad-or-malfunctioning-release-published)
3. [Runbook 2: Signing Key / Certificate Compromise](#runbook-2-signing-key--certificate-compromise)
4. [Runbook 3: Cloudflare R2 / Storage Provider Outage](#runbook-3-cloudflare-r2--storage-provider-outage)
5. [Runbook 4: Database Loss / D1 Catastrophic Corruption](#runbook-4-database-loss--d1-catastrophic-corruption)
6. [Runbook 5: Traffic Spike, Abuse, or Distributed Denial of Service (DDoS)](#runbook-5-traffic-spike-abuse-or-distributed-denial-of-service-ddos)
7. [Post-Incident Review (PIR) Template](#7-post-incident-review-pir-template)

---

## 1. General Incident Response Workflow

### Severity Levels
| Severity | Description | Target Response | Target Resolution |
|---|---|---|---|
| **SEV-1 (Critical)** | Active security compromise, data breach, total service outage, or malware payload distributed | < 15 minutes | < 2 hours |
| **SEV-2 (High)** | Broken release affecting > 10% of active users, download pipeline down, database read-only | < 30 minutes | < 4 hours |
| **SEV-3 (Medium)** | Admin console degraded, telemetry ingestion failing, elevated p95 latency | < 2 hours | < 24 hours |
| **SEV-4 (Low)** | Minor cosmetic or documentation issues, non-blocking synthetic probe warnings | Next business day | Next sprint |

### Incident Roles
- **Incident Commander (IC):** Coordinates response, assigns investigators, logs timestamps, approves major state changes (yanks, key revocations).
- **Technical Lead / Operations:** Executes CLI, database mutations, and Cloudflare dashboard adjustments.
- **Communications Lead:** Updates user-facing status (`status.docmac.app` / Twitter/X / in-app notice) and internal stakeholders.

---

## Runbook 1: Bad or Malfunctioning Release Published

### Symptoms
- Crash loop reported immediately upon update.
- Regression in core functionality or critical security vulnerability identified in a published APK.
- Elevated feedback ticket influx or Sentry error spike on newly published version.

### Target SLA
- **Yank Execution:** < 5 minutes from decision.
- **Rollback / Replacement Published:** < 60 minutes.

### Step-by-Step Procedure

#### Step 1: Immediately Yank the Problematic Release
Yanking removes the release from the catalogue, sets `status = 'yanked'`, restores the previous stable release as `is_current = 1`, and forces clients on the bad release to receive an upgrade recommendation via the `/update` endpoint.

**Option A: Via Admin Console Web UI (`/admin`)**
1. Log in to `https://api.docmac.app/admin`.
2. Locate the faulty release in the catalogue table.
3. Click the red **Yank** button.
4. Enter the mandatory reason (e.g., `Crash on launch on Android 14 devices (Ticket #DOC-2026-104)`).
5. Confirm the action.

**Option B: Via Admin API (cURL)**
```bash
curl -X POST https://api.docmac.app/v1/admin/releases/docmac-1.0.4/yank \
  -H "Authorization: Bearer $DOCMAC_ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Crash on launch on Android 14 devices"}'
```

**Option C: Direct D1 SQL (Emergency)**
```bash
wrangler d1 execute docmac-releases-prod --command \
  "UPDATE releases SET status = 'yanked', is_current = 0, yank_reason = 'Critical crash loop', yanked_at = CURRENT_TIMESTAMP WHERE id = 'docmac-1.0.4';"

# Ensure previous stable release is marked as current
wrangler d1 execute docmac-releases-prod --command \
  "UPDATE releases SET is_current = 1 WHERE id = (SELECT id FROM releases WHERE status = 'published' ORDER BY version_code DESC LIMIT 1);"
```

#### Step 2: Verify Catalogue State
Query the public endpoints to verify that the previous release is now served:
```bash
# Verify latest release returns previous good version
curl -s https://api.docmac.app/v1/apps/docmac/releases/latest | jq '{version: .version_name, is_current}'

# Verify in-app update endpoint issues 410 Gone with safe upgrade for bad versionCode
curl -s -i "https://api.docmac.app/v1/apps/docmac/update?versionCode=10004"
# Response must include: HTTP/1.1 410 Gone and X-Docmac-Yanked: true
```

#### Step 3: Publish Replacement Release
1. Build a new release with fixed code and an incremented `versionCode` (e.g., `10005`, version name `v1.0.5`).
2. Run standard CI release pipeline:
   ```bash
   git tag v1.0.5
   git push origin v1.0.5
   ```
3. Once verified and published, clients on the yanked release will automatically be prompted to upgrade to `v1.0.5`.

#### Step 4: Re-generate Static Release Permalinks
Trigger site deployment to refresh static HTML files and cache:
```bash
node scripts/build-release-pages.mjs
```

---

## Runbook 2: Signing Key / Certificate Compromise

### Symptoms
- Unauthorized APK release discovered with unknown signature.
- Compromise of private keystore file or continuous integration signing secrets.
- Verification engine alerts on unknown signing certificate SHA-256 fingerprint.

### Target SLA
- **Certificate Revocation:** < 15 minutes.
- **Security Notice Published:** < 1 hour.

### Step-by-Step Procedure

#### Step 1: Revoke Compromised Certificate in D1
Immediately mark the compromised certificate fingerprint as inactive:
```bash
wrangler d1 execute docmac-releases-prod --command \
  "UPDATE signing_certs SET is_active = 0, revoked_at = CURRENT_TIMESTAMP, revoke_reason = 'Key compromise SEV-1' WHERE cert_fingerprint = 'COMPROMISED_FINGERPRINT_HEX';"
```

#### Step 2: Revoke All Active Admin API Tokens
Invalidate any API tokens that could be used by an attacker:
```bash
wrangler d1 execute docmac-releases-prod --command \
  "UPDATE api_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE revoked_at IS NULL;"
```

#### Step 3: Yank Any Releases Signed by Compromised Key
```bash
wrangler d1 execute docmac-releases-prod --command \
  "UPDATE releases SET status = 'yanked', is_current = 0, yank_reason = 'Signed with revoked certificate' WHERE cert_fingerprint = 'COMPROMISED_FINGERPRINT_HEX';"
```

#### Step 4: Generate New Keystore and Register Fingerprint
1. Generate new Android release key with strong passphrase in secure offline hardware or HSM.
2. Calculate the SHA-256 certificate fingerprint:
   ```bash
   keytool -printcert -jarfile docmac-release-new.apk | grep "SHA256:"
   ```
3. Register the new active certificate in D1:
   ```bash
   wrangler d1 execute docmac-releases-prod --command \
     "INSERT INTO signing_certs (app_id, cert_fingerprint, algorithm, subject_dn, is_active, notes) \
      VALUES ('docmac-app', 'NEW_CERT_FINGERPRINT_HEX', 'SHA256withRSA', 'CN=Docmac Team', 1, 'Emergency rotation 2026');"
   ```

#### Step 5: User Communications & Migration Path
Because Android enforces signature verification during in-app updates (`INSTALL_FAILED_UPDATE_INCOMPATIBLE` when signing keys differ):
1. Post a prominent advisory on `https://docmac.app/security/advisory-2026-01` explaining the incident.
2. Instruct users to perform a clean reinstall: uninstall the previous build and install the new build from `https://docmac.app/releases/latest`.
3. Distribute new APK build through verified GitHub releases and static mirrors.

---

## Runbook 3: Cloudflare R2 / Storage Provider Outage

### Symptoms
- APK download requests fail with 5xx errors from `downloads.docmac.app`.
- S3/R2 API returns `503 Service Unavailable` or connection timeouts.
- Synthetic health check fails on range request against storage object.

### Target SLA
- **Traffic Redirection to Mirror:** < 10 minutes.

### Step-by-Step Procedure

#### Step 1: Verify Outage Scope
Check Cloudflare status page (`cloudflarestatus.com`) and probe directly:
```bash
curl -I https://downloads.docmac.app/releases/docmac-v1.0.4.apk
```

#### Step 2: Switch Edge Download Redirects to GitHub Mirror
The Docmac API redirects download requests to immutable storage URLs. If R2 is unavailable, flip the primary redirect destination to the GitHub Releases asset mirror.

**Option A: Update Worker Environment Variable via Wrangler**
```bash
# Point download asset domain to GitHub mirror
wrangler secret put R2_DOWNLOAD_URL_OVERRIDE
# Enter: https://github.com/the-jack-cloud/DOCMAC/releases/download
```

**Option B: Enable Website Static Fallback**
The Docmac front-end website (`index.html`) contains client-side fallback detection:
1. When API checks fail or R2 is degraded, `assets/script.js` automatically downloads from the static mirror defined in `releases.json`.
2. Verify `releases.json` has healthy GitHub mirror links:
   ```bash
   curl -s https://docmac.app/releases.json | jq '.releases[0].assets[0].mirrors'
   ```

#### Step 3: Monitor Recovery
Once Cloudflare R2 recovers:
1. Remove `R2_DOWNLOAD_URL_OVERRIDE` secret or restore `downloads.docmac.app`.
2. Run synthetic health checks:
   ```bash
   node scripts/health-check.mjs
   ```

---

## Runbook 4: Database Loss / D1 Catastrophic Corruption

### Symptoms
- Cloudflare D1 returns SQLite unrecoverable corruption errors (`SQLITE_CORRUPT`).
- Accidental drop table or catastrophic data corruption during migration.
- `GET /healthz` reports `database: degraded` or `database: offline`.

### Target SLA
- **RPO (Recovery Point Objective):** < 24 hours (or < 5 minutes with D1 Time Travel).
- **RTO (Recovery Time Objective):** < 1 hour (Tested baseline: 0.03 seconds).

### Step-by-Step Procedure

#### Option A: Fast Rollback using D1 Time Travel (Point-in-Time Recovery)
If the incident occurred within the last 30 days and was caused by an erroneous transaction:
```bash
# 1. List available bookmarks / timestamps
wrangler d1 time-travel list docmac-releases-prod

# 2. Restore to timestamp prior to incident (e.g. 15 minutes ago)
wrangler d1 time-travel restore docmac-releases-prod --timestamp="2026-10-23T18:00:00Z"
```

#### Option B: Full Disaster Recovery from Daily Logical Backup
If D1 is totally lost or corrupted:

1. **Locate the latest verified backup from cold storage (`R2` / `data/backups/`):**
   ```bash
   ls -la data/backups/
   # Identify latest file, e.g., d1-backup-2026-10-23.sql and d1-backup-2026-10-23.sql.meta.json
   ```

2. **Verify Backup Checksum:**
   ```bash
   sha256sum data/backups/d1-backup-2026-10-23.sql
   cat data/backups/d1-backup-2026-10-23.sql.meta.json | jq .sha256
   ```

3. **Replay Backup into Fresh D1 Instance:**
   ```bash
   # Re-apply schema
   wrangler d1 execute docmac-releases-prod --file=backend/migrations/0001_initial_schema.sql

   # Replay logical dump
   wrangler d1 execute docmac-releases-prod --file=data/backups/d1-backup-2026-10-23.sql
   ```

4. **Verify Database Integrity via Restore Drill Script:**
   ```bash
   node backend/scripts/restore-d1.mjs --backup=data/backups/d1-backup-2026-10-23.sql
   ```

5. **Re-validate State:**
   - Confirm `apps`, `signing_certs`, `releases`, and `release_assets` row counts match expected figures.
   - Confirm exactly one release has `is_current = 1`.
   - Purge Cloudflare Edge cache for `/v1/apps/docmac/*`.

---

## Runbook 5: Traffic Spike, Abuse, or Distributed Denial of Service (DDoS)

### Symptoms
- Abnormal surge in requests to `POST /v1/feedback` or download endpoints.
- 429 Too Many Requests response rates spiking.
- Suspected automated scraper or credential stuffing attempt against `/admin` or `/v1/admin/tokens`.

### Target SLA
- **Mitigation Activated:** < 5 minutes.

### Step-by-Step Procedure

#### Step 1: Engage Cloudflare WAF Under Attack Mode
1. In the Cloudflare Dashboard for `docmac.app`, navigate to **Security** → **Overview**.
2. Toggle **Under Attack Mode** to `ON` for immediate JS challenge enforcement on suspicious traffic.

#### Step 2: Tighten Rate Limits on Sensitive Endpoints
The backend router natively enforces IP-salted rate limiting:
- Feedback API: 10 requests / minute / salted IP hash.
- Token creation: 5 attempts / 15 minutes.

To tighten at Cloudflare Edge:
1. Navigate to **Security** → **WAF** → **Rate limiting rules**.
2. Add rule:
   - Path equals `/v1/feedback`
   - Request count > 5 per 1 minute
   - Action: **Block** (Duration: 1 hour).
3. Add rule for Admin API:
   - Path starts with `/v1/admin/`
   - Request count > 20 per 1 minute
   - Action: **Managed Challenge**.

#### Step 3: Restrict Admin Access to Zero Trust / Cloudflare Access
If admin endpoints are under targeted attack:
1. Verify Cloudflare Access is active for `api.docmac.app/admin` and `api.docmac.app/v1/admin/*`.
2. Require multi-factor authentication (MFA) and corporate email domain.
3. Deny all direct traffic lacking valid `cf-access-jwt-assertion`.

#### Step 4: Review and Export WAF Logs
Inspect IP distribution and user agents to identify bot patterns:
```bash
# Check download metrics and feedback origin countries in D1
wrangler d1 execute docmac-releases-prod --command \
  "SELECT country_code, count FROM download_daily WHERE date = DATE('now') ORDER BY count DESC LIMIT 10;"
```

---

## 7. Post-Incident Review (PIR) Template

To be completed within 48 hours of any SEV-1 or SEV-2 incident closure.

```markdown
# Incident Post-Mortem: [INCIDENT-TITLE]

**Date:** YYYY-MM-DD  
**Incident Commander:** [Name]  
**Severity:** [SEV-1 / SEV-2]  
**Impact Duration:** XX minutes (Start: HH:MM UTC - Resolved: HH:MM UTC)  
**User Impact:** [E.g., 500 download attempts failed; 12 users installed crash-looping build]  

### Timeline
- **HH:MM UTC:** Anomaly detected via [Synthetic probe / user feedback / Sentry].
- **HH:MM UTC:** Incident Commander declared SEV-X.
- **HH:MM UTC:** [Action taken, e.g., Release yanked via Admin UI].
- **HH:MM UTC:** Mitigation verified; error rate returned to baseline.
- **HH:MM UTC:** Incident closed.

### Root Cause Analysis (5 Whys)
1. Why did the issue occur?
2. Why was it not caught in testing?
3. Why did the verifier/pipeline not detect it?
4. Why did monitoring respond at the observed time?
5. Why was the system configured this way?

### Preventative Action Items
| Action Item | Owner | Target Date | Ticket |
|---|---|---|---|
| E.g., Add automated smoke test for Android 14 in CI | @dev | YYYY-MM-DD | DOC-XXX |
| E.g., Add Cloudflare rate limit alert webhook | @ops | YYYY-MM-DD | DOC-XXX |
```

