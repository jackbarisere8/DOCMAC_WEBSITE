/**
 * Admin Console Single-Page Interface
 * Embedded in the release worker for zero-dependency administration
 * Implements Section 7.2 and Section 18 Phase 2 of docs/BACKEND_ARCHITECTURE.md
 */

export function renderAdminHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#0a3d91" />
  <title>Docmac Release Admin Console</title>
  <link rel="icon" type="image/png" href="assets/images/favicon-32.png" />
  <style>
    :root {
      --bg: #f8fafc;
      --surface: #ffffff;
      --surface-border: #e2e8f0;
      --text-main: #0f172a;
      --text-muted: #64748b;
      --primary: #0a3d91;
      --primary-hover: #082d6b;
      --primary-focus: rgba(10, 61, 145, 0.15);
      --success: #16a34a;
      --success-bg: #dcfce7;
      --warn: #d97706;
      --warn-bg: #fef3c7;
      --danger: #dc2626;
      --danger-bg: #fee2e2;
      --badge-ready: #2563eb;
      --badge-ready-bg: #dbeafe;
      --font: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --radius: 8px;
      --shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
    }

    [data-theme="dark"] {
      --bg: #0b0f19;
      --surface: #131c2e;
      --surface-border: #1e293b;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --primary-focus: rgba(59, 130, 246, 0.2);
      --success-bg: #052e16;
      --warn-bg: #451a03;
      --danger-bg: #450a0a;
      --badge-ready-bg: #172554;
      --shadow: 0 4px 6px -1px rgb(0 0 0 / 0.3);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--font); background: var(--bg); color: var(--text-main); line-height: 1.5; }
    
    header { background: var(--surface); border-bottom: 1px solid var(--surface-border); padding: 14px 24px; position: sticky; top: 0; z-index: 10; }
    .nav-container { max-width: 1200px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; }
    .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 1.15rem; color: var(--text-main); text-decoration: none; }
    .brand-badge { font-size: 0.75rem; background: var(--primary-focus); color: var(--primary); padding: 2px 8px; border-radius: 999px; font-weight: 600; text-transform: uppercase; }
    
    .nav-tools { display: flex; align-items: center; gap: 12px; }
    button, .btn { font-family: inherit; font-size: 0.875rem; font-weight: 600; border-radius: var(--radius); cursor: pointer; padding: 8px 16px; border: 1px solid transparent; transition: all 0.15s ease; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
    .btn-primary { background: var(--primary); color: #fff; }
    .btn-primary:hover { background: var(--primary-hover); }
    .btn-secondary { background: var(--surface); border-color: var(--surface-border); color: var(--text-main); }
    .btn-secondary:hover { background: var(--surface-border); }
    .btn-danger { background: var(--danger); color: #fff; }
    .btn-danger:hover { opacity: 0.9; }
    .btn-sm { padding: 4px 10px; font-size: 0.775rem; }

    main { max-width: 1200px; margin: 24px auto; padding: 0 24px; }
    
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .stat-card { background: var(--surface); border: 1px solid var(--surface-border); border-radius: var(--radius); padding: 18px 20px; box-shadow: var(--shadow); }
    .stat-label { font-size: 0.8125rem; color: var(--text-muted); font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; }
    .stat-val { font-size: 1.75rem; font-weight: 700; margin-top: 6px; color: var(--text-main); }

    .tabs { display: flex; gap: 8px; border-bottom: 1px solid var(--surface-border); margin-bottom: 20px; overflow-x: auto; }
    .tab-btn { background: none; border: none; padding: 10px 16px; font-size: 0.9375rem; font-weight: 600; color: var(--text-muted); border-bottom: 2px solid transparent; border-radius: 0; cursor: pointer; }
    .tab-btn.active { color: var(--primary); border-bottom-color: var(--primary); }

    .card { background: var(--surface); border: 1px solid var(--surface-border); border-radius: var(--radius); box-shadow: var(--shadow); margin-bottom: 24px; overflow: hidden; }
    .card-header { padding: 16px 20px; border-bottom: 1px solid var(--surface-border); display: flex; align-items: center; justify-content: space-between; }
    .card-title { font-size: 1.05rem; font-weight: 700; }

    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 0.875rem; }
    th { padding: 12px 18px; background: var(--bg); color: var(--text-muted); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--surface-border); }
    td { padding: 14px 18px; border-bottom: 1px solid var(--surface-border); vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: var(--primary-focus); }

    .badge { font-size: 0.75rem; font-weight: 600; padding: 2px 8px; border-radius: 999px; display: inline-flex; align-items: center; text-transform: uppercase; }
    .badge-published { background: var(--success-bg); color: var(--success); }
    .badge-ready { background: var(--badge-ready-bg); color: var(--badge-ready); }
    .badge-draft { background: var(--surface-border); color: var(--text-muted); }
    .badge-verifying { background: var(--warn-bg); color: var(--warn); }
    .badge-yanked { background: var(--danger-bg); color: var(--danger); }
    .badge-failed { background: var(--danger-bg); color: var(--danger); }

    .mono { font-family: var(--mono); font-size: 0.8125rem; }
    .truncate { max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* Modal */
    .modal-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); display: none; align-items: center; justify-content: center; z-index: 50; padding: 16px; }
    .modal-backdrop.open { display: flex; }
    .modal { background: var(--surface); border: 1px solid var(--surface-border); border-radius: var(--radius); width: 100%; max-width: 580px; box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.2); overflow: hidden; }
    .modal-header { padding: 18px 24px; border-bottom: 1px solid var(--surface-border); display: flex; align-items: center; justify-content: space-between; }
    .modal-body { padding: 24px; max-height: calc(85vh - 120px); overflow-y: auto; }
    .modal-footer { padding: 16px 24px; border-top: 1px solid var(--surface-border); display: flex; justify-content: flex-end; gap: 10px; background: var(--bg); }

    .form-group { margin-bottom: 18px; }
    .form-group label { display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 6px; }
    .form-group input, .form-group textarea, .form-group select { width: 100%; padding: 10px 12px; font-family: inherit; font-size: 0.875rem; border: 1px solid var(--surface-border); border-radius: var(--radius); background: var(--surface); color: var(--text-main); }
    .form-group input:focus, .form-group textarea:focus, .form-group select:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-focus); }
    
    .drop-zone { border: 2px dashed var(--surface-border); border-radius: var(--radius); padding: 32px 20px; text-align: center; cursor: pointer; transition: all 0.2s; }
    .drop-zone:hover, .drop-zone.dragover { border-color: var(--primary); background: var(--primary-focus); }
    .progress-bar-container { height: 8px; width: 100%; background: var(--surface-border); border-radius: 999px; overflow: hidden; margin-top: 12px; display: none; }
    .progress-bar { height: 100%; width: 0%; background: var(--primary); transition: width 0.2s ease; }

    .log-box { background: var(--bg); border: 1px solid var(--surface-border); border-radius: var(--radius); padding: 14px; font-family: var(--mono); font-size: 0.8125rem; max-height: 220px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; }
  </style>
</head>
<body>
  <header>
    <div class="nav-container">
      <a class="brand" href="./">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
        <span>docmac</span>
        <span class="brand-badge">Console</span>
      </a>
      <div class="nav-tools">
        <button id="themeToggleBtn" class="btn btn-secondary btn-sm" type="button" aria-label="Toggle dark/light theme">☾</button>
        <button id="authBtn" class="btn btn-secondary btn-sm" type="button">API Key</button>
        <button id="btnOpenNewRelease" class="btn btn-primary" type="button">+ New Release</button>
      </div>
    </div>
  </header>

  <main>
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Published Releases</div>
        <div id="statPublished" class="stat-val">-</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Downloads</div>
        <div id="statDownloads" class="stat-val">-</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Active Channel</div>
        <div id="statChannel" class="stat-val">stable</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Drafts / Pipeline</div>
        <div id="statDrafts" class="stat-val">-</div>
      </div>
    </div>

    <div class="tabs">
      <button class="tab-btn active" data-tab="releasesTab">Releases</button>
      <button class="tab-btn" data-tab="analyticsTab">Analytics &amp; Telemetry</button>
      <button class="tab-btn" data-tab="feedbackTab">Feedback Inbox</button>
      <button class="tab-btn" data-tab="auditTab">Audit Trail</button>
      <button class="tab-btn" data-tab="tokensTab">API Tokens &amp; Security</button>
    </div>

    <!-- Releases Tab -->
    <section id="releasesTab" class="tab-content">
      <div class="card">
        <div class="card-header">
          <div class="card-title">Release Catalogue</div>
          <div style="display: flex; gap: 8px;">
            <select id="channelFilter" style="padding: 6px 12px; border-radius: var(--radius); border: 1px solid var(--surface-border); background: var(--surface); color: var(--text-main);">
              <option value="">All Channels</option>
              <option value="stable" selected>Stable</option>
              <option value="beta">Beta</option>
            </select>
            <button id="btnRefreshReleases" class="btn btn-secondary btn-sm">Refresh</button>
          </div>
        </div>
        <div style="overflow-x: auto;">
          <table>
            <thead>
              <tr>
                <th>Version</th>
                <th>Code</th>
                <th>Status</th>
                <th>SHA-256</th>
                <th>Size</th>
                <th>Published</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="releasesTableBody">
              <tr><td colspan="7" style="text-align: center; padding: 24px; color: var(--text-muted);">Loading releases...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- Analytics Tab -->
    <section id="analyticsTab" class="tab-content" style="display: none;">
      <div class="card">
        <div class="card-header">
          <div class="card-title">Download Distribution by Version</div>
          <button id="btnRefreshAnalytics" class="btn btn-secondary btn-sm">Refresh</button>
        </div>
        <div style="overflow-x: auto;">
          <table>
            <thead>
              <tr>
                <th>Version</th>
                <th>Channel</th>
                <th>Version Code</th>
                <th>Total Downloads</th>
              </tr>
            </thead>
            <tbody id="analyticsVersionTableBody">
              <tr><td colspan="4" style="text-align: center; padding: 24px; color: var(--text-muted);">Loading version statistics...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">Geographic Download Activity (Past 30 Days)</div>
        </div>
        <div style="overflow-x: auto;">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Country</th>
                <th>Downloads</th>
              </tr>
            </thead>
            <tbody id="analyticsGeoTableBody">
              <tr><td colspan="3" style="text-align: center; padding: 24px; color: var(--text-muted);">Loading geographic data...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- Feedback Tab -->
    <section id="feedbackTab" class="tab-content" style="display: none;">
      <div class="card">
        <div class="card-header">
          <div class="card-title">Feedback &amp; Support Inbox</div>
          <div style="display: flex; gap: 8px;">
            <select id="feedbackStatusFilter" style="padding: 6px 12px; border-radius: var(--radius); border: 1px solid var(--surface-border); background: var(--surface); color: var(--text-main);">
              <option value="">All Statuses</option>
              <option value="new" selected>New</option>
              <option value="read">Read</option>
              <option value="replied">Replied</option>
              <option value="closed">Closed</option>
            </select>
            <button id="btnRefreshFeedback" class="btn btn-secondary btn-sm">Refresh</button>
          </div>
        </div>
        <div style="overflow-x: auto;">
          <table>
            <thead>
              <tr>
                <th>Ticket ID</th>
                <th>Date</th>
                <th>Topic</th>
                <th>Sender</th>
                <th>Message</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody id="feedbackTableBody">
              <tr><td colspan="7" style="text-align: center; padding: 24px; color: var(--text-muted);">Loading feedback submissions...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- Audit Tab -->
    <section id="auditTab" class="tab-content" style="display: none;">
      <div class="card">
        <div class="card-header">
          <div class="card-title">Security &amp; Mutation Audit Trail</div>
          <button id="btnRefreshAudit" class="btn btn-secondary btn-sm">Refresh</button>
        </div>
        <div style="overflow-x: auto;">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Timestamp</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Release ID</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody id="auditTableBody">
              <tr><td colspan="6" style="text-align: center; padding: 24px; color: var(--text-muted);">Loading audit log...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- Security Tab -->
    <section id="tokensTab" class="tab-content" style="display: none;">
      <div class="card">
        <div class="card-header">
          <div class="card-title">Signing Certificates &amp; CI Machine Tokens</div>
          <button id="btnNewToken" class="btn btn-primary btn-sm">+ Generate CI Token</button>
        </div>
        <div style="padding: 20px;">
          <h4 style="margin-bottom: 12px;">Active Android Signing Certificates</h4>
          <div id="certsList" style="margin-bottom: 24px;">Loading certificates...</div>

          <h4 style="margin-bottom: 12px;">Automated CI Release Pipeline Integration</h4>
          <p style="color: var(--text-muted); font-size: 0.875rem; margin-bottom: 14px;">
            Configure GitHub Actions or automated build pipelines with a scoped token (<code>release:write</code>, <code>release:publish</code>).
          </p>
          <div class="log-box"># Release workflow authentication
curl -X POST https://api.docmac.app/v1/admin/releases \\
  -H "Authorization: Bearer $DOCMAC_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"versionName": "1.0.5", "versionCode": 105, "channel": "stable"}'</div>
        </div>
      </div>
    </section>
  </main>

  <!-- New Release Modal -->
  <div id="modalNewRelease" class="modal-backdrop">
    <div class="modal">
      <div class="modal-header">
        <h3 class="modal-title">Create New Release</h3>
        <button class="btn btn-secondary btn-sm" id="btnCloseNewRelease">×</button>
      </div>
      <div class="modal-body">
        <form id="newReleaseForm">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
            <div class="form-group">
              <label for="inputVersionName">Version Name</label>
              <input id="inputVersionName" placeholder="e.g. 1.0.5" required pattern="^\\d+\\.\\d+\\.\\d+.*$" />
            </div>
            <div class="form-group">
              <label for="inputVersionCode">Version Code</label>
              <input id="inputVersionCode" type="number" placeholder="e.g. 105" required min="1" />
            </div>
          </div>
          <div class="form-group">
            <label for="selectChannel">Channel</label>
            <select id="selectChannel">
              <option value="stable">Stable</option>
              <option value="beta">Beta</option>
              <option value="internal">Internal</option>
            </select>
          </div>
          <div class="form-group">
            <label for="inputNotes">Release Notes</label>
            <textarea id="inputNotes" rows="3" placeholder="What's new in this build?"></textarea>
          </div>
          <div class="form-group">
            <label>APK File</label>
            <div id="apkDropZone" class="drop-zone">
              <div id="dropZoneText">Drag &amp; drop <strong>.apk</strong> file here, or click to browse</div>
              <input id="apkFileInput" type="file" accept=".apk" style="display: none;" />
            </div>
            <div id="uploadProgress" class="progress-bar-container">
              <div id="uploadProgressBar" class="progress-bar"></div>
            </div>
            <div id="uploadStatusText" style="font-size: 0.8125rem; color: var(--text-muted); margin-top: 6px;"></div>
          </div>
        </form>
        <div id="verificationResultBox" style="display: none; margin-top: 14px;" class="log-box"></div>
      </div>
      <div class="modal-footer">
        <button id="btnCancelRelease" class="btn btn-secondary">Cancel</button>
        <button id="btnStartUpload" class="btn btn-primary" disabled>Upload &amp; Verify</button>
      </div>
    </div>
  </div>

  <!-- Yank Release Modal -->
  <div id="modalYank" class="modal-backdrop">
    <div class="modal">
      <div class="modal-header">
        <h3 class="modal-title">Yank Release</h3>
        <button class="btn btn-secondary btn-sm" id="btnCloseYank">×</button>
      </div>
      <div class="modal-body">
        <p style="margin-bottom: 14px; color: var(--text-muted);">
          Yanking removes this version from the public download card and in-app update feed. Historical download links remain reachable for disaster recovery.
        </p>
        <div class="form-group">
          <label for="yankReasonInput">Reason for yanking</label>
          <input id="yankReasonInput" placeholder="e.g. Critical crash on Android 14" required />
        </div>
      </div>
      <div class="modal-footer">
        <button id="btnCancelYank" class="btn btn-secondary">Cancel</button>
        <button id="btnConfirmYank" class="btn btn-danger">Confirm Yank</button>
      </div>
    </div>
  </div>

  <!-- Inspection Modal -->
  <div id="modalInspect" class="modal-backdrop">
    <div class="modal">
      <div class="modal-header">
        <h3 class="modal-title" id="inspectTitle">Release Details</h3>
        <button class="btn btn-secondary btn-sm" id="btnCloseInspect">×</button>
      </div>
      <div class="modal-body">
        <div id="inspectContent" class="log-box" style="max-height: 400px;"></div>
      </div>
      <div class="modal-footer">
        <button id="btnDismissInspect" class="btn btn-secondary">Close</button>
      </div>
    </div>
  </div>

  <script>
    (function () {
      let authToken = localStorage.getItem('docmac_admin_token') || '';
      let selectedFile = null;
      let activeYankReleaseId = null;

      const $ = (sel) => document.querySelector(sel);
      const $$ = (sel) => document.querySelectorAll(sel);

      // Theme
      const root = document.documentElement;
      const themeBtn = $('#themeToggleBtn');
      const isDark = () => root.getAttribute('data-theme') === 'dark';
      function applyTheme(dark) {
        root.setAttribute('data-theme', dark ? 'dark' : 'light');
        if (themeBtn) themeBtn.textContent = dark ? '☀' : '☾';
      }
      applyTheme(window.matchMedia('(prefers-color-scheme: dark)').matches);
      if (themeBtn) themeBtn.onclick = () => applyTheme(!isDark());

      // Auth Prompt
      $('#authBtn').onclick = () => {
        const val = prompt('Enter Admin API Token or Bearer secret:', authToken);
        if (val !== null) {
          authToken = val.trim();
          localStorage.setItem('docmac_admin_token', authToken);
          loadDashboard();
        }
      };

      function apiHeaders() {
        const h = { 'Content-Type': 'application/json' };
        if (authToken) h['Authorization'] = 'Bearer ' + authToken;
        return h;
      }

      // Tabs
      $$('.tab-btn').forEach((btn) => {
        btn.onclick = () => {
          $$('.tab-btn').forEach((b) => b.classList.remove('active'));
          $$('.tab-content').forEach((c) => (c.style.display = 'none'));
          btn.classList.add('active');
          const target = $('#' + btn.dataset.tab);
          if (target) target.style.display = 'block';
          if (btn.dataset.tab === 'analyticsTab') loadAnalytics();
          if (btn.dataset.tab === 'feedbackTab') loadFeedback();
          if (btn.dataset.tab === 'auditTab') loadAudit();
          if (btn.dataset.tab === 'tokensTab') loadCerts();
        };
      });

      // Modals
      function toggleModal(id, show) {
        const el = $('#' + id);
        if (el) el.classList.toggle('open', show);
      }
      $('#btnOpenNewRelease').onclick = () => toggleModal('modalNewRelease', true);
      $('#btnCloseNewRelease').onclick = () => toggleModal('modalNewRelease', false);
      $('#btnCancelRelease').onclick = () => toggleModal('modalNewRelease', false);

      $('#btnCloseYank').onclick = () => toggleModal('modalYank', false);
      $('#btnCancelYank').onclick = () => toggleModal('modalYank', false);

      $('#btnCloseInspect').onclick = () => toggleModal('modalInspect', false);
      $('#btnDismissInspect').onclick = () => toggleModal('modalInspect', false);

      // File Selection
      const dropZone = $('#apkDropZone');
      const fileInput = $('#apkFileInput');
      dropZone.onclick = () => fileInput.click();
      dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('dragover'); };
      dropZone.ondragleave = () => dropZone.classList.remove('dragover');
      dropZone.ondrop = (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
      };
      fileInput.onchange = () => { if (fileInput.files.length) handleFile(fileInput.files[0]); };

      function handleFile(file) {
        if (!file.name.endsWith('.apk')) {
          alert('Please select an Android .apk package.');
          return;
        }
        selectedFile = file;
        $('#dropZoneText').innerHTML = 'Selected: <strong>' + file.name + '</strong> (' + (file.size / (1024*1024)).toFixed(1) + ' MB)';
        $('#btnStartUpload').disabled = false;
      }

      // API calls
      async function loadDashboard() {
        try {
          const res = await fetch('/v1/admin/stats', { headers: apiHeaders() });
          if (res.ok) {
            const data = await res.json();
            $('#statPublished').textContent = data.totalPublished || 0;
            $('#statDownloads').textContent = (data.totalDownloads || 0).toLocaleString();
            $('#statDrafts').textContent = data.totalDrafts || 0;
          }
          loadReleases();
        } catch (e) {
          console.error(e);
        }
      }

      async function loadReleases() {
        const channel = $('#channelFilter').value;
        const url = '/v1/admin/releases' + (channel ? '?channel=' + channel : '');
        try {
          const res = await fetch(url, { headers: apiHeaders() });
          if (!res.ok) throw new Error('Status ' + res.status);
          const data = await res.json();
          renderReleasesTable(data.releases || []);
        } catch (e) {
          $('#releasesTableBody').innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--danger); padding: 20px;">Failed to load releases: ' + e.message + '</td></tr>';
        }
      }

      function renderReleasesTable(releases) {
        const tbody = $('#releasesTableBody');
        if (!releases.length) {
          tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 24px; color: var(--text-muted);">No releases found.</td></tr>';
          return;
        }
        tbody.innerHTML = releases.map((r) => {
          const badgeClass = 'badge badge-' + r.status;
          const currentBadge = r.is_current ? '<span class="badge badge-published" style="margin-left: 6px;">CURRENT</span>' : '';
          const sha = r.sha256 ? r.sha256.slice(0, 12) + '…' : '-';
          const size = r.size_bytes ? (r.size_bytes / (1024*1024)).toFixed(1) + ' MB' : '-';
          const date = r.published_at ? new Date(r.published_at).toLocaleDateString() : '-';

          let actions = '<button class="btn btn-secondary btn-sm" onclick="inspectRelease(\\'' + r.id + '\\')">Inspect</button>';
          if (r.status === 'ready') {
            actions += ' <button class="btn btn-primary btn-sm" onclick="publishRelease(\\'' + r.id + '\\')">Publish</button>';
          }
          if (r.status === 'published') {
            actions += ' <button class="btn btn-secondary btn-sm" style="color: var(--danger);" onclick="promptYank(\\'' + r.id + '\\')">Yank</button>';
          }
          if (r.status === 'draft') {
            actions += ' <button class="btn btn-secondary btn-sm" style="color: var(--danger);" onclick="deleteDraft(\\'' + r.id + '\\')">Delete</button>';
          }

          return '<tr>' +
            '<td><strong>v' + r.version_name + '</strong>' + currentBadge + '</td>' +
            '<td class="mono">' + r.version_code + '</td>' +
            '<td><span class="' + badgeClass + '">' + r.status + '</span></td>' +
            '<td class="mono truncate" title="' + (r.sha256 || '') + '">' + sha + '</td>' +
            '<td>' + size + '</td>' +
            '<td>' + date + '</td>' +
            '<td>' + actions + '</td>' +
          '</tr>';
        }).join('');
      }

      window.inspectRelease = async (id) => {
        try {
          const res = await fetch('/v1/admin/releases/' + id, { headers: apiHeaders() });
          const data = await res.json();
          $('#inspectTitle').textContent = 'Release v' + (data.version_name || id);
          $('#inspectContent').textContent = JSON.stringify(data, null, 2);
          toggleModal('modalInspect', true);
        } catch (e) {
          alert('Failed to load release details: ' + e.message);
        }
      };

      window.publishRelease = async (id) => {
        if (!confirm('Are you sure you want to promote this release to production? It will become the active download.')) return;
        try {
          const res = await fetch('/v1/admin/releases/' + id + '/publish', { method: 'POST', headers: apiHeaders() });
          const data = await res.json();
          if (!res.ok) throw new Error(data.detail || data.title || 'Publish failed');
          alert('Release v' + data.version_name + ' successfully published!');
          loadDashboard();
        } catch (e) {
          alert('Error publishing release: ' + e.message);
        }
      };

      window.promptYank = (id) => {
        activeYankReleaseId = id;
        $('#yankReasonInput').value = '';
        toggleModal('modalYank', true);
      };

      $('#btnConfirmYank').onclick = async () => {
        const reason = $('#yankReasonInput').value.trim();
        if (!reason) { alert('Please enter a reason for yanking.'); return; }
        try {
          const res = await fetch('/v1/admin/releases/' + activeYankReleaseId + '/yank', {
            method: 'POST',
            headers: apiHeaders(),
            body: JSON.stringify({ reason })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.detail || 'Yank failed');
          toggleModal('modalYank', false);
          alert('Release successfully yanked.');
          loadDashboard();
        } catch (e) {
          alert('Error yanking release: ' + e.message);
        }
      };

      window.deleteDraft = async (id) => {
        if (!confirm('Permanently delete this draft release?')) return;
        try {
          const res = await fetch('/v1/admin/releases/' + id, { method: 'DELETE', headers: apiHeaders() });
          if (!res.ok) throw new Error('Deletion failed');
          loadDashboard();
        } catch (e) {
          alert('Error deleting draft: ' + e.message);
        }
      };

      // Upload Pipeline
      $('#btnStartUpload').onclick = async () => {
        if (!selectedFile) return;
        const vName = $('#inputVersionName').value.trim();
        const vCode = parseInt($('#inputVersionCode').value, 10);
        const channel = $('#selectChannel').value;
        const notes = $('#inputNotes').value.trim();

        const btn = $('#btnStartUpload');
        const pBar = $('#uploadProgressBar');
        const pBox = $('#uploadProgress');
        const sText = $('#uploadStatusText');
        const vBox = $('#verificationResultBox');

        btn.disabled = true;
        pBox.style.display = 'block';
        pBar.style.width = '10%';
        sText.textContent = '1/4 Creating draft release...';
        vBox.style.display = 'none';

        try {
          // 1. Create draft
          const createRes = await fetch('/v1/admin/releases', {
            method: 'POST',
            headers: apiHeaders(),
            body: JSON.stringify({ versionName: vName, versionCode: vCode, channel, releaseNotes: notes })
          });
          const draft = await createRes.json();
          if (!createRes.ok) throw new Error(draft.detail || draft.title || 'Draft creation failed');

          // 2. Upload APK binary
          sText.textContent = '2/4 Uploading APK package (' + (selectedFile.size/(1024*1024)).toFixed(1) + ' MB)...';
          pBar.style.width = '40%';

          const uploadUrl = draft.upload.url;
          const uploadHeaders = {
            ...(draft.upload.headers || { 'Content-Type': 'application/vnd.android.package-archive' }),
          };
          // The upload endpoint is behind the admin auth guard. Presigned R2
          // URLs would not need this header, but the current API does.
          if (authToken) uploadHeaders.Authorization = 'Bearer ' + authToken;
          const uploadRes = await fetch(uploadUrl, {
            method: 'PUT',
            headers: uploadHeaders,
            body: selectedFile
          });
          if (!uploadRes.ok) throw new Error('Upload to storage failed (' + uploadRes.status + ')');

          // 3. Complete and verify
          pBar.style.width = '75%';
          sText.textContent = '3/4 Inspecting package with Verifier engine...';

          const compRes = await fetch('/v1/admin/releases/' + draft.id + '/complete', {
            method: 'POST',
            headers: apiHeaders()
          });
          const compData = await compRes.json();
          if (!compRes.ok) throw new Error(compData.detail || 'Verification request failed');

          pBar.style.width = '100%';
          sText.textContent = '4/4 Verification completed: ' + compData.status;

          vBox.style.display = 'block';
          vBox.textContent = JSON.stringify(compData.verification || compData, null, 2);

          if (compData.status === 'ready') {
            alert('APK verified successfully! You can now publish it.');
            toggleModal('modalNewRelease', false);
            loadDashboard();
          } else {
            alert('Verification failed. See details below.');
          }
        } catch (err) {
          sText.textContent = 'Error: ' + err.message;
          alert('Upload failed: ' + err.message);
        } finally {
          btn.disabled = false;
        }
      };

      async function loadAudit() {
        try {
          const res = await fetch('/v1/admin/audit', { headers: apiHeaders() });
          const data = await res.json();
          const tbody = $('#auditTableBody');
          if (!data.logs || !data.logs.length) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px; color: var(--text-muted);">No audit records found.</td></tr>';
            return;
          }
          tbody.innerHTML = data.logs.map((l) => '<tr>' +
            '<td class="mono">' + l.id + '</td>' +
            '<td>' + new Date(l.created_at).toLocaleString() + '</td>' +
            '<td><strong>' + l.actor + '</strong></td>' +
            '<td class="mono">' + l.action + '</td>' +
            '<td class="mono">' + (l.release_id || '-') + '</td>' +
            '<td class="mono truncate" title="' + l.metadata + '">' + l.metadata + '</td>' +
          '</tr>').join('');
        } catch (e) {
          $('#auditTableBody').innerHTML = '<tr><td colspan="6" style="color: var(--danger); text-align: center;">Failed to load audit logs.</td></tr>';
        }
      }

      async function loadAnalytics() {
        try {
          const res = await fetch('/v1/admin/stats', { headers: apiHeaders() });
          const data = await res.json();
          const vTbody = $('#analyticsVersionTableBody');
          const gTbody = $('#analyticsGeoTableBody');

          if (!data.downloadsByVersion || !data.downloadsByVersion.length) {
            vTbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px; color: var(--text-muted);">No version download data yet.</td></tr>';
          } else {
            vTbody.innerHTML = data.downloadsByVersion.map((v) => '<tr>' +
              '<td><strong>v' + v.version_name + '</strong></td>' +
              '<td>' + v.channel + '</td>' +
              '<td class="mono">' + v.version_code + '</td>' +
              '<td><strong>' + Number(v.downloads).toLocaleString() + '</strong></td>' +
            '</tr>').join('');
          }

          if (!data.recentDownloads || !data.recentDownloads.length) {
            gTbody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px; color: var(--text-muted);">No geographic activity recorded yet.</td></tr>';
          } else {
            gTbody.innerHTML = data.recentDownloads.map((g) => '<tr>' +
              '<td>' + g.day + '</td>' +
              '<td class="mono"><strong>' + g.country.toUpperCase() + '</strong></td>' +
              '<td>' + Number(g.count).toLocaleString() + '</td>' +
            '</tr>').join('');
          }
        } catch (e) {
          console.error(e);
        }
      }

      async function loadFeedback() {
        const status = $('#feedbackStatusFilter').value;
        const url = '/v1/admin/feedback' + (status ? '?status=' + status : '');
        try {
          const res = await fetch(url, { headers: apiHeaders() });
          const data = await res.json();
          const tbody = $('#feedbackTableBody');
          if (!data.feedback || !data.feedback.length) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 24px; color: var(--text-muted);">No feedback records found.</td></tr>';
            return;
          }
          tbody.innerHTML = data.feedback.map((fb) => {
            const badgeClass = fb.status === 'new' ? 'badge badge-published' : fb.status === 'replied' ? 'badge badge-ready' : 'badge badge-draft';
            let actions = '';
            if (fb.status !== 'read') actions += '<button class="btn btn-secondary btn-sm" onclick="setFeedbackStatus(\\'' + fb.id + '\\', \\'read\\')">Mark Read</button> ';
            if (fb.status !== 'replied') actions += '<button class="btn btn-secondary btn-sm" onclick="setFeedbackStatus(\\'' + fb.id + '\\', \\'replied\\')">Replied</button> ';
            if (fb.status !== 'closed') actions += '<button class="btn btn-secondary btn-sm" onclick="setFeedbackStatus(\\'' + fb.id + '\\', \\'closed\\')">Close</button>';

            return '<tr>' +
              '<td class="mono"><strong>' + fb.id + '</strong></td>' +
              '<td>' + new Date(fb.created_at).toLocaleDateString() + '</td>' +
              '<td>' + fb.topic + '</td>' +
              '<td>' + (fb.name || 'Anonymous') + (fb.email ? '<br /><small class="mono">' + fb.email + '</small>' : '') + '</td>' +
              '<td class="truncate" style="max-width: 240px;" title="' + fb.message + '">' + fb.message + '</td>' +
              '<td><span class="' + badgeClass + '">' + fb.status + '</span></td>' +
              '<td>' + actions + '</td>' +
            '</tr>';
          }).join('');
        } catch (e) {
          $('#feedbackTableBody').innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--danger); padding: 20px;">Failed to load feedback.</td></tr>';
        }
      }

      window.setFeedbackStatus = async (id, status) => {
        try {
          const res = await fetch('/v1/admin/feedback/' + id, {
            method: 'PATCH',
            headers: apiHeaders(),
            body: JSON.stringify({ status })
          });
          if (res.ok) loadFeedback();
        } catch (e) {
          alert('Error updating feedback: ' + e.message);
        }
      };

      $('#btnRefreshAnalytics').onclick = loadAnalytics;
      $('#btnRefreshFeedback').onclick = loadFeedback;
      $('#feedbackStatusFilter').onchange = loadFeedback;

      async function loadCerts() {
        const div = $('#certsList');
        div.innerHTML = '<div style="background: var(--bg); padding: 12px; border-radius: var(--radius); font-family: var(--mono); font-size: 0.8125rem;">Official Docmac Release Fingerprint (SHA-256):<br /><strong>40:48:E0:03:BA:37:E9:03:A3:3F:24:0A:68:4F:6F:A3:83:F3:F1:6E:EE:28:B5:2B:E9:4B:47:18:D3:13:93:C6</strong></div>';
      }

      $('#btnNewToken').onclick = async () => {
        const name = prompt('Token name (e.g. GitHub Actions CI):', 'ci-release-token');
        if (!name) return;
        try {
          const res = await fetch('/v1/admin/tokens', {
            method: 'POST',
            headers: apiHeaders(),
            body: JSON.stringify({ name, scopes: ['release:write', 'release:publish'] })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.detail || 'Token creation failed');
          prompt('Save this API token securely. It will not be shown again:', data.token);
        } catch (e) {
          alert('Error: ' + e.message);
        }
      };

      $('#btnRefreshReleases').onclick = loadReleases;
      $('#channelFilter').onchange = loadReleases;
      $('#btnRefreshAudit').onclick = loadAudit;

      loadDashboard();
    })();
  </script>
</body>
</html>`;
}

