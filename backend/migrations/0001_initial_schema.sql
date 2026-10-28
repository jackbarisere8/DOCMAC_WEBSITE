-- Docmac Release Platform — D1 (SQLite) Initial Schema
-- Migration: 0001_initial_schema.sql
-- Based on Section 6 of docs/BACKEND_ARCHITECTURE.md

-- 1. Applications
CREATE TABLE IF NOT EXISTS apps (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  package_name  TEXT NOT NULL,
  platform      TEXT NOT NULL DEFAULT 'android',
  website_url   TEXT,
  privacy_url   TEXT,
  created_at    TEXT NOT NULL
);

-- 2. Signing Certificates
CREATE TABLE IF NOT EXISTS signing_certs (
  id          TEXT PRIMARY KEY,
  app_id      TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  sha256      TEXT NOT NULL,
  subject     TEXT,
  valid_from  TEXT,
  valid_to    TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  UNIQUE(app_id, sha256)
);

-- 3. Releases
CREATE TABLE IF NOT EXISTS releases (
  id                TEXT PRIMARY KEY,
  app_id            TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  version_name      TEXT NOT NULL,
  version_code      INTEGER NOT NULL,
  channel           TEXT NOT NULL DEFAULT 'stable' CHECK (channel IN ('stable','beta','internal')),
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','uploading','verifying','ready','published','yanked','failed')),
  is_current        INTEGER NOT NULL DEFAULT 0,
  force_update      INTEGER NOT NULL DEFAULT 0,
  min_supported     INTEGER NOT NULL DEFAULT 0,

  storage_key       TEXT,
  file_name         TEXT,
  size_bytes        INTEGER,
  sha256            TEXT,
  sha512            TEXT,
  signature_sha256  TEXT,
  package_name      TEXT,
  min_sdk           INTEGER,
  target_sdk        INTEGER,
  abis              TEXT DEFAULT '["universal"]',

  release_notes     TEXT,
  published_at      TEXT,
  yanked_at         TEXT,
  yanked_reason     TEXT,
  verification      TEXT NOT NULL DEFAULT '{}',
  created_by        TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,

  UNIQUE(app_id, channel, version_code)
);

CREATE UNIQUE INDEX IF NOT EXISTS releases_one_current
  ON releases (app_id, channel)
  WHERE is_current = 1;

CREATE INDEX IF NOT EXISTS releases_catalogue
  ON releases (app_id, channel, status, version_code DESC);

-- 4. Release Assets (ABI-specific APKs if ever needed)
CREATE TABLE IF NOT EXISTS release_assets (
  id          TEXT PRIMARY KEY,
  release_id  TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  abi         TEXT,
  storage_key TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  sha256      TEXT NOT NULL
);

-- 5. Aggregated Daily Downloads (No raw IP addresses)
CREATE TABLE IF NOT EXISTS download_daily (
  release_id  TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  day         TEXT NOT NULL,
  country     TEXT NOT NULL DEFAULT 'unknown',
  count       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (release_id, day, country)
);

-- 6. Audit Log
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  release_id  TEXT REFERENCES releases(id) ON DELETE SET NULL,
  metadata    TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL
);

-- 7. Scoped Machine Tokens for CI
CREATE TABLE IF NOT EXISTS api_tokens (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  scopes        TEXT NOT NULL,
  last_used_at  TEXT,
  expires_at    TEXT,
  created_at    TEXT NOT NULL
);

-- 8. Feedback Intake
CREATE TABLE IF NOT EXISTS feedback (
  id          TEXT PRIMARY KEY,
  name        TEXT,
  email       TEXT,
  topic       TEXT NOT NULL,
  message     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','read','replied','closed','spam')),
  ip_hash     TEXT,
  user_agent  TEXT,
  created_at  TEXT NOT NULL
);

