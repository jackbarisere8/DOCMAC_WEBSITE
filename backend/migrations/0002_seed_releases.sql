-- Seed initial application and historical releases imported from releases.json
-- Generated automatically by backend/scripts/import-releases.mjs

INSERT OR IGNORE INTO apps (id, slug, name, package_name, platform, website_url, privacy_url, created_at)
VALUES (
  'app_docmac',
  'docmac',
  'Docmac',
  'com.docmac.app',
  'android',
  'https://jackbarisere8.github.io/DOCMAC_WEBSITE/',
  'https://jackbarisere8.github.io/DOCMAC_WEBSITE/privacy.html',
  '2026-08-18T15:36:04Z'
);

INSERT OR IGNORE INTO signing_certs (id, app_id, sha256, subject, valid_from, valid_to, is_active, created_at)
VALUES (
  'cert_docmac_prod_1',
  'app_docmac',
  '40:48:E0:03:BA:37:E9:03:A3:3F:24:0A:68:4F:6F:A3:83:F3:F1:6E:EE:28:B5:2B:E9:4B:47:18:D3:13:93:C6',
  'C=ng, ST=akwa ibom, L=uyo, O=docmac, OU=docmac, CN=jack barisere',
  '2026-08-01T00:00:00Z',
  '2051-08-01T00:00:00Z',
  1,
  '2026-08-18T15:36:04Z'
);

INSERT OR REPLACE INTO releases (
  id, app_id, version_name, version_code, channel, status, is_current,
  force_update, min_supported, storage_key, file_name, size_bytes,
  sha256, sha512, signature_sha256, package_name, min_sdk, target_sdk, abis,
  release_notes, published_at, verification, created_by, created_at, updated_at
) VALUES (
  'rel_1_0_4',
  'app_docmac',
  '1.0.4',
  10004,
  'stable',
  'published',
  1,
  0,
  0,
  'android/stable/1.0.4/1d4edc3c546e0818/docmac-1.0.4.apk',
  'docmac-1.0.4.apk',
  63418179,
  '1D4EDC3C546E0818884EAFEB6BBDE3CB911668109871912C7809818AC1DA2E6C',
  'E08416FF2244C48F245E36ECFC75763BD0D8A60F3D905E8555C2DF43E78B6B4CDC2A9FE33CA99E9EB88F4B929ECF21C23C8D9F1D495ABC1F9D7755BCC8BE2E04',
  '40:48:E0:03:BA:37:E9:03:A3:3F:24:0A:68:4F:6F:A3:83:F3:F1:6E:EE:28:B5:2B:E9:4B:47:18:D3:13:93:C6',
  'com.docmac.app',
  24,
  35,
  '["universal"]',
  '- Redesigned the Talk inbox and conversation experience.
- Added in-conversation message sending.
- Updated Talk interaction coverage and removed the obsolete archive route.
- Bumped the app to version 1.0.4 (build 5).',
  '2026-08-25T19:38:35Z',
  '{"verified":true,"verifier":"system.migration"}',
  'jackbarisere8',
  '2026-08-25T19:38:35Z',
  '2026-08-25T19:38:35Z'
);
INSERT OR IGNORE INTO download_daily (release_id, day, country, count)
VALUES ('rel_1_0_4', '2026-10-23', 'global', 18);
INSERT INTO audit_log (actor, action, release_id, metadata, created_at)
VALUES ('system.migration', 'release.import', 'rel_1_0_4', '{"version":"1.0.4"}', datetime('now'));

INSERT OR REPLACE INTO releases (
  id, app_id, version_name, version_code, channel, status, is_current,
  force_update, min_supported, storage_key, file_name, size_bytes,
  sha256, sha512, signature_sha256, package_name, min_sdk, target_sdk, abis,
  release_notes, published_at, verification, created_by, created_at, updated_at
) VALUES (
  'rel_1_0_3',
  'app_docmac',
  '1.0.3',
  10003,
  'stable',
  'published',
  0,
  0,
  0,
  'android/stable/1.0.3/aeb2f1cee5a2bf20/docmac-1.0.3.apk',
  'docmac-1.0.3.apk',
  61945509,
  'AEB2F1CEE5A2BF20E4E925A118C047F3D4ABB558E19B64123AF499A4DD7C9661',
  'A0FFA71CF4CA581A0D8F99DB7D0B260C5B21BBBBD2F4171CACA93A4B551E4D139E4EA976611F69232415BE282E4A0CBA244B13625FAD96B02A6E2FD05C53F63A',
  '40:48:E0:03:BA:37:E9:03:A3:3F:24:0A:68:4F:6F:A3:83:F3:F1:6E:EE:28:B5:2B:E9:4B:47:18:D3:13:93:C6',
  'com.docmac.app',
  24,
  35,
  '["universal"]',
  '- Refined the OTP signup and onboarding flow.
- Updated Docmac branding, including the white link logo.
- Updated analyzer exclusions and dependencies.',
  '2026-08-22T20:35:38Z',
  '{"verified":true,"verifier":"system.migration"}',
  'jackbarisere8',
  '2026-08-22T20:35:38Z',
  '2026-08-22T20:35:38Z'
);
INSERT OR IGNORE INTO download_daily (release_id, day, country, count)
VALUES ('rel_1_0_3', '2026-10-23', 'global', 11);
INSERT INTO audit_log (actor, action, release_id, metadata, created_at)
VALUES ('system.migration', 'release.import', 'rel_1_0_3', '{"version":"1.0.3"}', datetime('now'));

INSERT OR REPLACE INTO releases (
  id, app_id, version_name, version_code, channel, status, is_current,
  force_update, min_supported, storage_key, file_name, size_bytes,
  sha256, sha512, signature_sha256, package_name, min_sdk, target_sdk, abis,
  release_notes, published_at, verification, created_by, created_at, updated_at
) VALUES (
  'rel_1_0_2',
  'app_docmac',
  '1.0.2',
  10002,
  'stable',
  'published',
  0,
  0,
  0,
  'android/stable/1.0.2/4feb0b2b903b285d/docmac-1.0.2.apk',
  'docmac-1.0.2.apk',
  61256029,
  '4FEB0B2B903B285DC3FA7281C3FF3A7B63FCC0F21D034D5859FC65CAD1E081C8',
  '199A879C0A794206885AB72834C0CF465F0A07A766FCFA4F5DD9DEA4D66BE2DAC2B0717F866785322FACD7D3EBE2861791F66BFB59A6BB7546822FC088A43269',
  '40:48:E0:03:BA:37:E9:03:A3:3F:24:0A:68:4F:6F:A3:83:F3:F1:6E:EE:28:B5:2B:E9:4B:47:18:D3:13:93:C6',
  'com.docmac.app',
  24,
  35,
  '["universal"]',
  '- Refreshed app navigation.
- Improved contact dialing.',
  '2026-08-21T14:19:14Z',
  '{"verified":true,"verifier":"system.migration"}',
  'jackbarisere8',
  '2026-08-21T14:19:14Z',
  '2026-08-21T14:19:14Z'
);
INSERT OR IGNORE INTO download_daily (release_id, day, country, count)
VALUES ('rel_1_0_2', '2026-10-23', 'global', 6);
INSERT INTO audit_log (actor, action, release_id, metadata, created_at)
VALUES ('system.migration', 'release.import', 'rel_1_0_2', '{"version":"1.0.2"}', datetime('now'));

INSERT OR REPLACE INTO releases (
  id, app_id, version_name, version_code, channel, status, is_current,
  force_update, min_supported, storage_key, file_name, size_bytes,
  sha256, sha512, signature_sha256, package_name, min_sdk, target_sdk, abis,
  release_notes, published_at, verification, created_by, created_at, updated_at
) VALUES (
  'rel_1_0_1',
  'app_docmac',
  '1.0.1',
  10001,
  'stable',
  'published',
  0,
  0,
  0,
  'android/stable/1.0.1/0e818533b49d739e/docmac-1.0.1.apk',
  'docmac-1.0.1.apk',
  61004347,
  '0E818533B49D739E31BC3C83716E026F032E2FFC5F6ED4BC772A13B1CFDE1359',
  'D976461C0EADC0EB8A741EC8D859BC9FD836109C2775CA981DDA0B79AAE5CAB08E308BF4D8F78B56A3F2C9DDF1B6B53DF132069DA79FD1D8ED899D97A671512D',
  '40:48:E0:03:BA:37:E9:03:A3:3F:24:0A:68:4F:6F:A3:83:F3:F1:6E:EE:28:B5:2B:E9:4B:47:18:D3:13:93:C6',
  'com.docmac.app',
  24,
  35,
  '["universal"]',
  '- Production build of Docmac 1.0.1.
- Enabled debug phone-auth testing support.',
  '2026-08-18T20:50:24Z',
  '{"verified":true,"verifier":"system.migration"}',
  'jackbarisere8',
  '2026-08-18T20:50:24Z',
  '2026-08-18T20:50:24Z'
);
INSERT OR IGNORE INTO download_daily (release_id, day, country, count)
VALUES ('rel_1_0_1', '2026-10-23', 'global', 7);
INSERT INTO audit_log (actor, action, release_id, metadata, created_at)
VALUES ('system.migration', 'release.import', 'rel_1_0_1', '{"version":"1.0.1"}', datetime('now'));

INSERT OR REPLACE INTO releases (
  id, app_id, version_name, version_code, channel, status, is_current,
  force_update, min_supported, storage_key, file_name, size_bytes,
  sha256, sha512, signature_sha256, package_name, min_sdk, target_sdk, abis,
  release_notes, published_at, verification, created_by, created_at, updated_at
) VALUES (
  'rel_1_0_0',
  'app_docmac',
  '1.0.0',
  10000,
  'stable',
  'published',
  0,
  0,
  1,
  'android/stable/1.0.0/26459b9675dbc0b6/docmac-1.0.0.apk',
  'docmac-1.0.0.apk',
  61004343,
  '26459B9675DBC0B6420BEE1031500A70E27B994AF6ADEA911FF6B41A4E656767',
  '96753420AE413D846FF3F7D5ECF22AC8801A87D0A6FC87644A03A47CFD89EC5BF94F9328D5BC72D5368203288B95168B96809B4FA8E4C9F0E444F53AC06EA4A9',
  '40:48:E0:03:BA:37:E9:03:A3:3F:24:0A:68:4F:6F:A3:83:F3:F1:6E:EE:28:B5:2B:E9:4B:47:18:D3:13:93:C6',
  'com.docmac.app',
  24,
  35,
  '["universal"]',
  '- First public Android release of Docmac.
- Direct APK distribution begins.',
  '2026-08-18T15:36:04Z',
  '{"verified":true,"verifier":"system.migration"}',
  'jackbarisere8',
  '2026-08-18T15:36:04Z',
  '2026-08-18T15:36:04Z'
);
INSERT OR IGNORE INTO download_daily (release_id, day, country, count)
VALUES ('rel_1_0_0', '2026-10-23', 'global', 4);
INSERT INTO audit_log (actor, action, release_id, metadata, created_at)
VALUES ('system.migration', 'release.import', 'rel_1_0_0', '{"version":"1.0.0"}', datetime('now'));

