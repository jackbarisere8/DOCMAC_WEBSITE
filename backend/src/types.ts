/**
 * Type definitions for Docmac Release Service
 * Conforms to API contracts in Section 7 of docs/BACKEND_ARCHITECTURE.md
 */

export interface Env {
  DB: D1DatabaseLike;
  RELEASES_BUCKET?: R2BucketLike;
  ENVIRONMENT?: string;
  APP_SLUG?: string;
  CDN_BASE_URL?: string;
  DOWNLOAD_DOMAIN?: string;
  FEEDBACK_EMAIL?: string;
  ALLOWED_ORIGINS?: string;
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  all<T = unknown>(): Promise<{ results?: T[]; success: boolean; error?: string }>;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run(): Promise<{ success: boolean; meta?: unknown; error?: string }>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch?(statements: D1PreparedStatementLike[]): Promise<unknown[]>;
  exec?(query: string): Promise<unknown>;
}

export interface R2BucketLike {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown, options?: unknown): Promise<unknown>;
}

export interface AppRecord {
  id: string;
  slug: string;
  name: string;
  package_name: string;
  platform: string;
  website_url: string | null;
  privacy_url: string | null;
  created_at: string;
}

export interface SigningCertRecord {
  id: string;
  app_id: string;
  sha256: string;
  subject: string | null;
  valid_from: string | null;
  valid_to: string | null;
  is_active: number;
  created_at: string;
}

export interface ReleaseRecord {
  id: string;
  app_id: string;
  version_name: string;
  version_code: number;
  channel: 'stable' | 'beta' | 'internal';
  status: 'draft' | 'uploading' | 'verifying' | 'ready' | 'published' | 'yanked' | 'failed';
  is_current: number;
  force_update: number;
  min_supported: number;
  storage_key: string | null;
  file_name: string | null;
  size_bytes: number | null;
  sha256: string | null;
  sha512: string | null;
  signature_sha256: string | null;
  package_name: string | null;
  min_sdk: number | null;
  target_sdk: number | null;
  abis: string | null;
  release_notes: string | null;
  published_at: string | null;
  yanked_at: string | null;
  yanked_reason: string | null;
  verification: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ManifestLatest {
  versionName: string;
  versionCode: number;
  publishedAt: string;
  minSdk: number;
  targetSdk: number;
  sizeBytes: number;
  sizeLabel?: string;
  sha256: string;
  signatureSha256: string;
  downloadUrl: string;
  cdnUrl: string;
  releaseNotes: string;
  forceUpdate: boolean;
  yanked: boolean;
}

export interface ManifestReleaseSummary {
  versionName: string;
  versionCode: number;
  publishedAt: string;
  sizeBytes: number;
  sizeLabel?: string;
  sha256: string;
  minSdk: number;
  downloadUrl: string;
  releaseNotes: string;
  yanked: boolean;
}

export interface ManifestResponse {
  app: {
    slug: string;
    name: string;
    packageName: string;
    platform: string;
    signingCertSha256: string;
  };
  generatedAt: string;
  channel: string;
  latest: ManifestLatest | null;
  releases: ManifestReleaseSummary[];
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  requestId: string;
}

export interface AuditLogRecord {
  id: number;
  actor: string;
  action: string;
  release_id: string | null;
  metadata: string;
  created_at: string;
}

export interface ApiTokenRecord {
  id: string;
  name: string;
  token_hash: string;
  scopes: string; // Comma or JSON array string
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface VerificationCheckDetails {
  manifestValid: boolean;
  signatureValid: boolean;
  signerSha256?: string;
  hashComputed: boolean;
  sha256?: string;
  sha512?: string;
  policyValid: boolean;
  minSdkValid: boolean;
  packageNameValid: boolean;
  monotonicVersionValid: boolean;
}

export interface VerificationReport {
  passed: boolean;
  verifiedAt: string;
  checks: VerificationCheckDetails;
  errors?: string[];
  metadata?: {
    packageName?: string;
    versionCode?: number;
    versionName?: string;
    minSdk?: number;
    targetSdk?: number;
    sizeBytes?: number;
  };
}

export interface AdminCreateReleaseRequest {
  app?: string;
  versionName: string;
  versionCode: number;
  channel?: 'stable' | 'beta' | 'internal';
  releaseNotes?: string;
  minSdk?: number;
  forceUpdate?: boolean;
}

export interface AdminCreateReleaseResponse {
  id: string;
  status: 'draft';
  upload: {
    method: 'PUT';
    url: string;
    headers: Record<string, string>;
    expiresIn: number;
    maxBytes: number;
  };
}

export interface AdminStatsResponse {
  totalPublished: number;
  totalDrafts: number;
  totalYanked: number;
  totalDownloads: number;
  recentDownloads: Array<{
    day: string;
    country: string;
    count: number;
  }>;
}

