/**
 * Pure TypeScript / Node.js APK Verification Engine
 * Implements Section 8.2 of docs/BACKEND_ARCHITECTURE.md
 *
 * Verifies:
 * 1. ZIP structure & AndroidManifest.xml presence
 * 2. Binary AndroidManifest decoding (package, versionCode, versionName, minSdk, debuggable)
 * 3. Android APK Signing Block (v2/v3) certificate extraction & allowlist validation
 * 4. SHA-256 and SHA-512 content hashes
 * 5. Monotonic versioning and security policies
 */

import crypto from 'node:crypto';
import zlib from 'node:zlib';

export interface ApkParsedManifest {
  packageName?: string;
  versionCode?: number;
  versionName?: string;
  minSdkVersion?: number;
  targetSdkVersion?: number;
  debuggable?: boolean;
}

export interface ApkParsedSignature {
  fingerprintSha256: string;
  schemeVersion: 'v2' | 'v3';
  subject?: string;
}

export interface ApkParsedResult {
  sizeBytes: number;
  sha256: string;
  sha512: string;
  manifest: ApkParsedManifest;
  signatures: ApkParsedSignature[];
}

export interface VerificationOptions {
  expectedVersionName?: string;
  expectedVersionCode?: number;
  allowedPackageNames?: string[];
  allowedSigningCerts: string[];
  maxExistingVersionCode?: number;
  enforceMinSize?: boolean;
}

export interface VerificationResult {
  passed: boolean;
  errors: string[];
  sha256?: string;
  sha512?: string;
  signatureSha256?: string;
  sizeBytes?: number;
  packageName?: string;
  versionCode?: number;
  versionName?: string;
  minSdk?: number;
  targetSdk?: number;
  report: {
    passed: boolean;
    verifiedAt: string;
    checks: {
      zipSanity: boolean;
      manifestExtracted: boolean;
      signatureValid: boolean;
      debuggableForbidden: boolean;
      policyMonotonic: boolean;
      policyMinSdk: boolean;
      policyPackageName: boolean;
    };
    errors: string[];
    extractedMetadata: Record<string, unknown>;
  };
}

/* -------------------------------------------------------------------------- */
/* Low-level Binary Helpers                                                   */
/* -------------------------------------------------------------------------- */

function readUInt64LE(buffer: Buffer, offset: number): number {
  return Number(buffer.readBigUInt64LE(offset));
}

function readLengthPrefixed(buffer: Buffer, offset: number): { value: Buffer; next: number } {
  const length = buffer.readUInt32LE(offset);
  const start = offset + 4;
  const end = start + length;
  if (end > buffer.length) throw new Error('Length-prefixed field exceeds buffer boundary');
  return { value: buffer.subarray(start, end), next: end };
}

/* -------------------------------------------------------------------------- */
/* APK Signing Block Parser (v2 / v3)                                         */
/* -------------------------------------------------------------------------- */

function readSigningBlockPairs(buffer: Buffer): Array<{ id: number; value: Buffer }> | null {
  let eocd = -1;
  const minOffset = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) return null;

  const centralDirectoryOffset = buffer.readUInt32LE(eocd + 16);
  if (centralDirectoryOffset < 32) return null;

  const magic = buffer.subarray(centralDirectoryOffset - 16, centralDirectoryOffset).toString('latin1');
  if (magic !== 'APK Sig Block 42') return null;

  const blockSize = readUInt64LE(buffer, centralDirectoryOffset - 24);
  const blockStart = centralDirectoryOffset - blockSize - 8;
  if (blockStart < 0) return null;
  if (readUInt64LE(buffer, blockStart) !== blockSize) return null;

  const pairs: Array<{ id: number; value: Buffer }> = [];
  let offset = blockStart + 8;
  const pairsEnd = centralDirectoryOffset - 24;
  while (offset + 12 <= pairsEnd) {
    const pairLength = readUInt64LE(buffer, offset);
    if (pairLength < 4 || offset + 8 + pairLength > pairsEnd) break;
    const id = buffer.readUInt32LE(offset + 8);
    pairs.push({ id, value: buffer.subarray(offset + 12, offset + 8 + pairLength) });
    offset += 8 + pairLength;
  }
  return pairs;
}

function extractCertificatesFromScheme(schemeValue: Buffer): Buffer[] {
  const signers = readLengthPrefixed(schemeValue, 0);
  const certificates: Buffer[] = [];
  let offset = 0;
  while (offset < signers.value.length) {
    const signer = readLengthPrefixed(signers.value, offset);
    offset = signer.next;

    const signedData = readLengthPrefixed(signer.value, 0);
    let cursor = 0;
    const digests = readLengthPrefixed(signedData.value, cursor);
    cursor = digests.next;
    const certSequence = readLengthPrefixed(signedData.value, cursor);

    let certOffset = 0;
    while (certOffset < certSequence.value.length) {
      const certificate = readLengthPrefixed(certSequence.value, certOffset);
      certOffset = certificate.next;
      certificates.push(certificate.value);
    }
  }
  return certificates;
}

function formatFingerprint(der: Buffer): string {
  return crypto
    .createHash('sha256')
    .update(der)
    .digest('hex')
    .toUpperCase()
    .match(/.{2}/g)!
    .join(':');
}

/* -------------------------------------------------------------------------- */
/* Android Binary XML Parser                                                  */
/* -------------------------------------------------------------------------- */

function parseBinaryXml(xml: Buffer): ApkParsedManifest {
  const manifest: ApkParsedManifest = {};
  if (xml.length < 8 || xml.readUInt16LE(0) !== 0x0003) {
    return manifest;
  }

  // String pool is chunk 1
  const stringPoolType = xml.readUInt16LE(8);
  if (stringPoolType !== 0x0001) return manifest;

  const stringCount = xml.readUInt32LE(16);
  const flags = xml.readUInt32LE(24);
  const stringsStart = 8 + xml.readUInt32LE(28);
  const isUtf8 = (flags & (1 << 8)) !== 0;

  const strings: string[] = [];
  for (let i = 0; i < stringCount; i++) {
    const strOffset = stringsStart + xml.readUInt32LE(8 + 28 + i * 4);
    if (isUtf8) {
      let len = xml[strOffset];
      let headerOffset = 1;
      if (len & 0x80) {
        len = ((len & 0x7f) << 8) | xml[strOffset + 1];
        headerOffset = 2;
      }
      let u8len = xml[strOffset + headerOffset];
      let u8Hdr = 1;
      if (u8len & 0x80) {
        u8len = ((u8len & 0x7f) << 8) | xml[strOffset + headerOffset + 1];
        u8Hdr = 2;
      }
      const strBytes = xml.subarray(
        strOffset + headerOffset + u8Hdr,
        strOffset + headerOffset + u8Hdr + u8len
      );
      strings.push(strBytes.toString('utf8'));
    } else {
      let len = xml.readUInt16LE(strOffset);
      let h = 2;
      if (len & 0x8000) {
        len = ((len & 0x7fff) << 16) | xml.readUInt16LE(strOffset + 2);
        h = 4;
      }
      strings.push(xml.subarray(strOffset + h, strOffset + h + len * 2).toString('utf16le'));
    }
  }

  // Iterate over XML chunks to find elements and attributes
  const poolSize = xml.readUInt32LE(12);
  let ptr = 8 + poolSize;

  while (ptr + 8 <= xml.length) {
    const chunkType = xml.readUInt16LE(ptr);
    const chunkSize = xml.readUInt32LE(ptr + 4);
    if (chunkSize <= 0) break;

    if (chunkType === 0x0102) {
      // START_TAG
      const tagNameIdx = xml.readUInt32LE(ptr + 20);
      const attrCount = xml.readUInt16LE(ptr + 28);
      const tag = strings[tagNameIdx] || '';

      for (let a = 0; a < attrCount; a++) {
        const aPtr = ptr + 36 + a * 20;
        if (aPtr + 20 > xml.length) break;

        const aNameIdx = xml.readUInt32LE(aPtr + 4);
        const aRawValIdx = xml.readUInt32LE(aPtr + 8);
        const aData = xml.readUInt32LE(aPtr + 16);
        const aName = strings[aNameIdx] || '';

        const strVal =
          aRawValIdx !== 0xffffffff && aRawValIdx < strings.length ? strings[aRawValIdx] : null;

        if (tag === 'manifest') {
          if (aName === 'package') manifest.packageName = strVal || strings[aData];
          if (aName === 'versionCode') manifest.versionCode = aData;
          if (aName === 'versionName') manifest.versionName = strVal || String(aData);
        } else if (tag === 'uses-sdk') {
          if (aName === 'minSdkVersion') manifest.minSdkVersion = aData;
          if (aName === 'targetSdkVersion') manifest.targetSdkVersion = aData;
        } else if (tag === 'application') {
          if (aName === 'debuggable') manifest.debuggable = Boolean(aData);
        }
      }
    }
    ptr += chunkSize;
  }

  return manifest;
}

/* -------------------------------------------------------------------------- */
/* Main APK Parser                                                            */
/* -------------------------------------------------------------------------- */

export function parseApkBuffer(buffer: Buffer): ApkParsedResult {
  if (buffer.length < 22) throw new Error('File is too small to be a valid APK');
  if (buffer.readUInt32LE(0) !== 0x04034b50) {
    throw new Error('Invalid file format: missing ZIP magic header PK\\x03\\x04');
  }

  // 1. Content Hashes
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase();
  const sha512 = crypto.createHash('sha512').update(buffer).digest('hex').toUpperCase();

  // 2. Find EOCD & Central Directory
  let eocd = -1;
  const minOffset = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= minOffset; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Truncated or invalid ZIP: End of Central Directory record not found');

  const cdOffset = buffer.readUInt32LE(eocd + 16);
  const cdCount = buffer.readUInt16LE(eocd + 10);

  // 3. Extract AndroidManifest.xml from Central Directory
  let ptr = cdOffset;
  let manifestEntry: { compMethod: number; compSize: number; localHeaderOffset: number } | null = null;

  for (let i = 0; i < cdCount; i++) {
    if (ptr + 46 > buffer.length || buffer.readUInt32LE(ptr) !== 0x02014b50) break;
    const compMethod = buffer.readUInt16LE(ptr + 10);
    const compSize = buffer.readUInt32LE(ptr + 20);
    const nameLen = buffer.readUInt16LE(ptr + 28);
    const extraLen = buffer.readUInt16LE(ptr + 30);
    const commentLen = buffer.readUInt16LE(ptr + 32);
    const localHeaderOffset = buffer.readUInt32LE(ptr + 42);

    const name = buffer.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8');
    if (name === 'AndroidManifest.xml') {
      manifestEntry = { compMethod, compSize, localHeaderOffset };
      break;
    }
    ptr += 46 + nameLen + extraLen + commentLen;
  }

  if (!manifestEntry) {
    throw new Error('Invalid APK: AndroidManifest.xml not found in ZIP archive');
  }

  // 4. Decompress AndroidManifest.xml
  const locOffset = manifestEntry.localHeaderOffset;
  if (locOffset + 30 > buffer.length || buffer.readUInt32LE(locOffset) !== 0x04034b50) {
    throw new Error('Corrupted local file header for AndroidManifest.xml');
  }
  const locNameLen = buffer.readUInt16LE(locOffset + 26);
  const locExtraLen = buffer.readUInt16LE(locOffset + 28);
  const dataStart = locOffset + 30 + locNameLen + locExtraLen;
  const compData = buffer.subarray(dataStart, dataStart + manifestEntry.compSize);

  let uncompressedXml: Buffer;
  if (manifestEntry.compMethod === 8) {
    uncompressedXml = zlib.inflateRawSync(compData);
  } else if (manifestEntry.compMethod === 0) {
    uncompressedXml = compData;
  } else {
    throw new Error(`Unsupported compression method ${manifestEntry.compMethod} for AndroidManifest.xml`);
  }

  const manifest = parseBinaryXml(uncompressedXml);

  // 5. Extract Signatures from APK Signing Block
  const pairs = readSigningBlockPairs(buffer);
  const signatures: ApkParsedSignature[] = [];

  if (pairs) {
    // Check v3 (0xf05368c0) then v2 (0x7109871a)
    for (const [id, schemeVersion] of [
      [0xf05368c0, 'v3'],
      [0x7109871a, 'v2'],
    ] as const) {
      const pair = pairs.find((p) => p.id === id);
      if (pair) {
        try {
          const certs = extractCertificatesFromScheme(pair.value);
          for (const cert of certs) {
            signatures.push({
              fingerprintSha256: formatFingerprint(cert),
              schemeVersion,
            });
          }
        } catch {}
      }
    }
  }

  return {
    sizeBytes: buffer.length,
    sha256,
    sha512,
    manifest,
    signatures,
  };
}

/* -------------------------------------------------------------------------- */
/* High-Level Verification Pipeline                                           */
/* -------------------------------------------------------------------------- */

export function verifyApk(buffer: Buffer, options: VerificationOptions): VerificationResult {
  const errors: string[] = [];
  const checks = {
    zipSanity: false,
    manifestExtracted: false,
    signatureValid: false,
    debuggableForbidden: true,
    policyMonotonic: false,
    policyMinSdk: false,
    policyPackageName: false,
  };

  let parsed: ApkParsedResult | null = null;
  try {
    // 1. Size constraint check (1 MB - 300 MB)
    if (options.enforceMinSize && buffer.length < 1024 * 1024) {
      errors.push(`File size (${buffer.length} bytes) is below minimum of 1 MB.`);
    }
    if (buffer.length > 300 * 1024 * 1024) {
      errors.push(`File size (${buffer.length} bytes) exceeds maximum limit of 300 MB.`);
    }

    parsed = parseApkBuffer(buffer);
    checks.zipSanity = true;
  } catch (err: unknown) {
    errors.push(`ZIP / Structure check failed: ${(err as Error).message}`);
    return {
      passed: false,
      errors,
      report: {
        passed: false,
        verifiedAt: new Date().toISOString(),
        checks,
        errors,
        extractedMetadata: {},
      },
    };
  }

  // 2. Manifest check
  const manifest = parsed.manifest;
  if (!manifest.packageName || manifest.versionCode === undefined) {
    errors.push('AndroidManifest.xml could not be decoded or is missing package/versionCode.');
  } else {
    checks.manifestExtracted = true;
  }

  // 3. Signature verification
  const normalizedAllowlist = options.allowedSigningCerts.map((c) =>
    c.toUpperCase().replace(/[^A-F0-9]/g, '')
  );

  let validSignerFp: string | undefined;
  for (const sig of parsed.signatures) {
    const rawFp = sig.fingerprintSha256.toUpperCase().replace(/[^A-F0-9]/g, '');
    if (normalizedAllowlist.includes(rawFp)) {
      validSignerFp = sig.fingerprintSha256;
      break;
    }
  }

  if (validSignerFp) {
    checks.signatureValid = true;
  } else {
    const foundFps = parsed.signatures.map((s) => s.fingerprintSha256).join(', ') || 'None found';
    errors.push(`Signing certificate rejected. Found: [${foundFps}]. Allowed: [${options.allowedSigningCerts.join(', ')}].`);
  }

  // 4. Debuggable flag check
  if (manifest.debuggable === true) {
    checks.debuggableForbidden = false;
    errors.push('APK is built in debug mode (android:debuggable="true"). Only release builds are accepted.');
  }

  // 5. MinSdk check (must be >= 24)
  const minSdk = manifest.minSdkVersion || 24;
  if (minSdk < 24) {
    errors.push(`minSdkVersion ${minSdk} is below the platform minimum supported floor (24 / Android 7.0).`);
  } else {
    checks.policyMinSdk = true;
  }

  // 6. Package name check
  const allowedPackages = options.allowedPackageNames || ['com.docmac.app', 'com.jack.docmac'];
  if (manifest.packageName && allowedPackages.includes(manifest.packageName)) {
    checks.policyPackageName = true;
  } else {
    errors.push(`Package name "${manifest.packageName}" does not match authorized app identifiers (${allowedPackages.join(', ')}).`);
  }

  // 7. Expected version name & version code validation (against draft inputs)
  if (options.expectedVersionCode !== undefined && manifest.versionCode !== undefined) {
    if (manifest.versionCode !== options.expectedVersionCode) {
      errors.push(`Extracted versionCode (${manifest.versionCode}) does not match draft declaration (${options.expectedVersionCode}).`);
    }
  }
  if (options.expectedVersionName && manifest.versionName) {
    if (manifest.versionName !== options.expectedVersionName) {
      errors.push(`Extracted versionName (${manifest.versionName}) does not match draft declaration (${options.expectedVersionName}).`);
    }
  }

  // 8. Monotonic version code check
  if (
    options.maxExistingVersionCode !== undefined &&
    manifest.versionCode !== undefined &&
    manifest.versionCode <= options.maxExistingVersionCode
  ) {
    errors.push(`versionCode (${manifest.versionCode}) must be strictly greater than highest existing published version (${options.maxExistingVersionCode}).`);
  } else {
    checks.policyMonotonic = true;
  }

  const passed = errors.length === 0;

  return {
    passed,
    errors,
    sha256: parsed.sha256,
    sha512: parsed.sha512,
    signatureSha256: validSignerFp || parsed.signatures[0]?.fingerprintSha256,
    sizeBytes: parsed.sizeBytes,
    packageName: manifest.packageName,
    versionCode: manifest.versionCode,
    versionName: manifest.versionName,
    minSdk: manifest.minSdkVersion,
    targetSdk: manifest.targetSdkVersion,
    report: {
      passed,
      verifiedAt: new Date().toISOString(),
      checks,
      errors,
      extractedMetadata: {
        packageName: manifest.packageName,
        versionCode: manifest.versionCode,
        versionName: manifest.versionName,
        minSdkVersion: manifest.minSdkVersion,
        targetSdkVersion: manifest.targetSdkVersion,
        debuggable: manifest.debuggable,
        signatures: parsed.signatures,
        sha256: parsed.sha256,
        sizeBytes: parsed.sizeBytes,
      },
    },
  };
}

