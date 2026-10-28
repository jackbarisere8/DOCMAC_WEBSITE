/**
 * Docmac Verifier Container HTTP Service
 * Runs inside Docker / Cloudflare Containers / Fly.io
 * Implements Section 8 of docs/BACKEND_ARCHITECTURE.md
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { verifyApk, parseApkBuffer } from '../backend/src/verifier.ts';

const PORT = Number(process.env.PORT) || 8080;
const AUTH_TOKEN = process.env.VERIFIER_SECRET || '';

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Basic health check
  if (req.method === 'GET' && url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'docmac-verifier', time: new Date().toISOString() }));
    return;
  }

  // Verification endpoint
  if (req.method === 'POST' && url.pathname === '/verify') {
    if (AUTH_TOKEN) {
      const auth = req.headers['authorization'] || '';
      if (auth !== `Bearer ${AUTH_TOKEN}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
    }

    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const bodyBuffer = Buffer.concat(chunks);
        const optionsHeader = req.headers['x-verify-options'];
        const options = optionsHeader ? JSON.parse(String(optionsHeader)) : {};

        // Execute core binary verification
        const result = verifyApk(bodyBuffer, {
          expectedVersionName: options.expectedVersionName,
          expectedVersionCode: options.expectedVersionCode,
          allowedSigningCerts: options.allowedSigningCerts || [],
          allowedPackageNames: options.allowedPackageNames,
          maxExistingVersionCode: options.maxExistingVersionCode,
          enforceMinSize: options.enforceMinSize !== false,
        });

        // If system apksigner or clamscan are available in container, run additional checks
        let clamScanClean = true;
        try {
          const clamPath = '/usr/bin/clamdscan';
          if (fs.existsSync(clamPath)) {
            // Write temp file and scan
            const tmpFile = path.join('/tmp', `apk_${Date.now()}.apk`);
            fs.writeFileSync(tmpFile, bodyBuffer);
            try {
              execFileSync(clamPath, ['--no-summary', tmpFile]);
            } catch {
              clamScanClean = false;
              result.passed = false;
              result.errors.push('ClamAV flagged suspicious signature in upload.');
            } finally {
              try { fs.unlinkSync(tmpFile); } catch {}
            }
          }
        } catch {}

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

server.listen(PORT, () => {
  console.log(`[docmac-verifier] Listening on port ${PORT}`);
});

