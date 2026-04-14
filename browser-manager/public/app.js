class DashboardClient {
  constructor() {
    this.ws = null;
    this.events = [];
    this.triageItems = [];
    this.triageMeta = { extractedCount: 0, minScore: 35 };
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.emailFilters = {
      search: '',
      category: null,  // null means 'All', or one of 'Needs Reply', 'Waiting on Others', 'FYI'
      state: null,     // null means 'All', or one of 'Flagged', 'Pinned', 'Done'
      tag: null,       // null means no tag filter, or one of 'Approval', 'Vendor', 'Urgent'
      tags: []         // array of selected tags from tag popover
    };
    this.selectedEmailId = null;
    this.mobileReaderOpen = false;
    this.emailListScrollTop = 0;
    this.isRefreshingTriage = false;
    this.triageError = null;
    // Logs state (session-only, no persistence)
    this.logs = [];
    this.logsFilterSearch = '';
    this.logsFilterType = 'all';
    this.logsFilterWindow = '15m';
    this.logsIsLive = false;
    this.logsExpandedRowId = null;
    this.graphAuthPollTimer = null;
  }

  connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.updateConnectionStatus(true);
      console.log('WebSocket connected');
      this.queryEvents();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'events') {
          this.events = data.events;
          this.logs = data.events || [];
          this.renderEvents();
          this.updateStats();
          this.renderLogs();
        } else if (data.type === 'event' && data.event) {
          // Only append to logs if live mode is ON
          if (typeof LogHelpers !== 'undefined' && LogHelpers.shouldAppendLiveEvent(this.logsIsLive)) {
            this.logs.push(data.event);
            this.renderLogs();
          }
          this.events.push(data.event);
          this.renderEvents();
          this.updateStats();
        } else if (data.type === 'triage-result' && Array.isArray(data.data)) {
          this.triageItems = data.data;
            this.triageMeta = {
              extractedCount: Number(data?.meta?.totalExtracted || 0),
              minScore: Number(data?.meta?.minScore ?? this.triageMeta.minScore ?? 35)
            };
          this.renderTriage();
        } else if (data.type === 'settings_updated') {
          handleSettingsUpdated(data);
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.isConnected = false;
    };

    this.ws.onclose = () => {
      this.isConnected = false;
      this.updateConnectionStatus(false);
      console.log('WebSocket disconnected');
      this.attemptReconnect();
    };
  }

  attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = 1000 * this.reconnectAttempts;
      setTimeout(() => this.connect(), delay);
    }
  }

  updateConnectionStatus(connected) {
    const indicator = document.getElementById('connectionStatus');
    if (indicator) {
      indicator.className = `status-indicator ${connected ? 'connected' : 'disconnected'}`;
      indicator.textContent = connected ? 'Connected' : 'Disconnected';
    }
  }

  queryEvents() {
    if (this.ws && this.isConnected) {
      this.ws.send(JSON.stringify({ type: 'query-events' }));
    } else {
      this.fetchEventsRest();
    }
  }

  fetchEventsRest() {
    fetch('/api/events')
      .then(response => response.json())
      .then(data => {
        this.events = data.events || [];
        this.renderEvents();
        this.updateStats();
      })
      .catch(error => console.error('Failed to fetch events:', error));
  }

  renderEvents() {
    const eventsList = document.getElementById('eventsList');
    if (!eventsList) return;

    if (this.events.length === 0) {
      eventsList.innerHTML = '<div class="empty-state">No events yet. Waiting for data...</div>';
      return;
    }

    eventsList.innerHTML = this.events
      .slice()
      .reverse()
      .map(event => this.createEventElement(event))
      .join('');
  }

  createEventElement(event) {
    const timestamp = new Date(event.timestamp).toLocaleTimeString();
    const details = this.escapeHtml(JSON.stringify(event.details || {}));
    const eventType = this.escapeHtml(event.type);

    return `
      <div class="event-item ${eventType}">
        <div class="event-header">
          <span class="event-type ${eventType}">${eventType}</span>
          <span class="event-timestamp">${timestamp}</span>
        </div>
        <div class="event-action">${this.escapeHtml(event.action || 'Unknown')}</div>
        <div class="event-details">${details}</div>
      </div>
    `;
  }

  updateStats() {
    const totalEventsEl = document.getElementById('totalEvents');
    const automationCountEl = document.getElementById('automationCount');
    const userCountEl = document.getElementById('userCount');

    if (totalEventsEl) {
      totalEventsEl.textContent = this.events.length;
    }

    if (automationCountEl) {
      const automationCount = this.events.filter(e => e.type === 'automation').length;
      automationCountEl.textContent = automationCount;
    }

    if (userCountEl) {
      const userCount = this.events.filter(e => e.type === 'user').length;
      userCountEl.textContent = userCount;
    }
  }

  clearEvents() {
    if (this.ws && this.isConnected) {
      this.ws.send(JSON.stringify({ type: 'clear-events' }));
    }
    this.events = [];
    this.renderEvents();
    this.updateStats();
  }

  async loadSettings() {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      if (!data.success) return;
      this._settingsData = data.settings || {};
      this.renderSettingsTabs();
      this.renderActiveSettingsTab();
      await this.loadArchiveFolderOptions(this._settingsData.archiveFolderId || '');
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
    this.setupGraphAuthButton();
  }

  async loadArchiveFolderOptions(selectedFolderId) {
    const selectEl = document.getElementById('setting-archiveFolder');
    if (!selectEl) {
      return;
    }

    const currentSelection = String(selectedFolderId || selectEl.value || '');
    selectEl.innerHTML = '<option value="">Default archive behavior</option>';

    try {
      const res = await fetch('/api/graph/mail-folders');
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const folders = Array.isArray(data.folders) ? data.folders : [];
      folders.forEach((folder) => {
        const option = document.createElement('option');
        option.value = folder.id;
        option.textContent = folder.displayName;
        selectEl.appendChild(option);
      });
    } catch (error) {
      console.warn('Failed to load mail folders for archive picklist:', error.message);
    }

    selectEl.value = currentSelection;
  }

  async openDraftEditorModal({ subject, body, providerNotice }) {
    // Stub: draft editing is now inline in the reader pane.
    // Return the values unchanged so callers still work.
    return { subject: String(subject || ''), body: String(body || '') };
  }

  // ── Logs rendering and filtering ──────────────────────────────────────────
  renderLogs() {
    const tableBody = document.getElementById('logsTableBody');
    const emptyState = document.getElementById('logsEmptyState');
    const resultCount = document.getElementById('logsResultCount');

    if (!tableBody) return;

    // Build filter object for LogHelpers
    const filters = {
      search: this.logsFilterSearch,
      type: this.logsFilterType === 'all' ? null : this.logsFilterType,
      window: this.logsFilterWindow,
    };

    // Use LogHelpers.filterLogs if available
    const filteredLogs = typeof LogHelpers !== 'undefined' && LogHelpers.filterLogs
      ? LogHelpers.filterLogs(this.logs, filters, new Date())
      : this.logs;

    // Sort newest first
    const sortedLogs = filteredLogs.slice().sort((a, b) => {
      const timeA = new Date(a.timestamp || 0).getTime();
      const timeB = new Date(b.timestamp || 0).getTime();
      return timeB - timeA;
    });

    // Update result count
    if (resultCount) {
      resultCount.textContent = `${sortedLogs.length} result${sortedLogs.length !== 1 ? 's' : ''}`;
    }

    // Clear table
    tableBody.innerHTML = '';

    // Show/hide empty state
    if (sortedLogs.length === 0) {
      if (emptyState) {
        emptyState.hidden = false;
        if (this.logsFilterSearch || this.logsFilterType !== 'all' || this.logsFilterWindow !== '15m') {
          emptyState.textContent = 'No results match current filters.';
        } else {
          emptyState.textContent = 'No logs found.';
        }
      }
      return;
    }

    if (emptyState) {
      emptyState.hidden = true;
    }

    // Render rows
    sortedLogs.forEach((log, index) => {
      // Use index-based ID to ensure consistency across re-renders
      const logId = `log-${index}`;
      const isExpanded = this.logsExpandedRowId === logId;

      // Main row
      const row = document.createElement('tr');
      row.className = `logs-table-row ${isExpanded ? 'is-expanded' : ''}`;
      row.dataset.logId = logId;

      const timestamp = new Date(log.timestamp || new Date()).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      const dateStr = new Date(log.timestamp || new Date()).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });

      const typeBadge = `<span class="logs-table-type-badge ${log.type}">${log.type || 'unknown'}</span>`;
      const action = this.escapeHtml(log.action || 'N/A');
      const summary = this.escapeHtml((log.summary || log.details?.subject || ''));
      const truncatedSummary = summary.length > 60 ? summary.substring(0, 57) + '...' : summary;

      row.innerHTML = `
        <td class="logs-col-timestamp">${dateStr} ${timestamp}</td>
        <td class="logs-col-type">${typeBadge}</td>
        <td class="logs-col-action">${action}</td>
        <td class="logs-col-summary">${truncatedSummary}</td>
      `;

      row.addEventListener('click', () => {
        this.handleLogsRowExpand(logId);
      });

      tableBody.appendChild(row);

      // Details row (hidden by default)
      if (isExpanded) {
        const detailsRow = document.createElement('tr');
        detailsRow.className = 'logs-table-details-row';
        detailsRow.dataset.logId = logId;
        const detailsJson = this.escapeHtml(JSON.stringify(log, null, 2));
        detailsRow.innerHTML = `
          <td colspan="4">
            <div class="logs-details-content">${detailsJson}</div>
          </td>
        `;
        tableBody.appendChild(detailsRow);
      }
    });
  }

  handleLogsFilterChange() {
    this.renderLogs();
  }

  handleLogsRowExpand(logId) {
    if (this.logsExpandedRowId === logId) {
      this.logsExpandedRowId = null;
    } else {
      this.logsExpandedRowId = logId;
    }
    this.renderLogs();
  }

  async handleLogsLiveToggle(isLive) {
    this.logsIsLive = isLive;

    // Update badge visibility
    const badge = document.getElementById('logsLivePausedBadge');
    if (badge) {
      badge.hidden = isLive;
    }

    // If toggling ON, show refresh indicator and fetch fresh logs
    if (isLive) {
      const refreshIndicator = document.getElementById('logsRefreshIndicator');
      if (refreshIndicator) {
        refreshIndicator.hidden = false;
      }

      try {
        const response = await fetch('/api/events');
        const data = await response.json();
        this.logs = data.events || [];
        this.renderLogs();
      } catch (e) {
        console.error('Failed to fetch logs:', e);
      } finally {
        if (refreshIndicator) {
          refreshIndicator.hidden = true;
        }
      }
    }

    this.renderLogs();
  }

  // ── Settings tab constants ─────────────────────────────────────────────────
  static get SETTINGS_TABS() {
    return [
      { id: 'connection', label: 'Connection' },
      { id: 'ai-providers', label: 'AI Providers' },
      { id: 'categorization', label: 'Categorization' },
      { id: 'advanced', label: 'Advanced' },
    ];
  }

  static get KNOWN_SETTINGS_KEYS() {
    return new Set([
      'emailProvider', 'graphClientId', 'graphTenantId', 'archiveFolderId',
      'emailSignature', 'lookbackDays', 'minScore', 'vipSenders',
      'aiProviderPrimary', 'aiProviderFallback', 'anthropicApiKey',
      'openaiApiKey', 'aiOpenAiModel', 'aiDraftEnabled', 'maxDraftLength',
    ]);
  }

  // ── Render tab pills ──────────────────────────────────────────────────────
  renderSettingsTabs() {
    const container = document.getElementById('settingsTabs');
    if (!container) return;
    const activeTab = (typeof PortalState !== 'undefined' ? PortalState.getSettingsTab() : 'connection') || 'connection';
    // Normalise: map legacy 'general' to 'connection'
    const normTab = activeTab === 'general' ? 'connection' : activeTab;

    container.innerHTML = DashboardClient.SETTINGS_TABS.map((tab) =>
      `<button type="button" class="pill${tab.id === normTab ? ' is-active' : ''}" data-settings-tab="${tab.id}">${tab.label}</button>`
    ).join('');

    container.querySelectorAll('[data-settings-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (typeof PortalState !== 'undefined') PortalState.setSettingsTab(btn.dataset.settingsTab);
        this.renderSettingsTabs();
        this.renderActiveSettingsTab();
      });
    });
  }

  // ── Render active tab content ─────────────────────────────────────────────
  renderActiveSettingsTab() {
    const container = document.getElementById('settingsContent');
    if (!container) return;
    const s = this._settingsData || {};
    let activeTab = (typeof PortalState !== 'undefined' ? PortalState.getSettingsTab() : 'connection') || 'connection';
    if (activeTab === 'general') activeTab = 'connection';

    switch (activeTab) {
      case 'connection': container.innerHTML = this._renderConnectionTab(s); break;
      case 'ai-providers': container.innerHTML = this._renderAiProvidersTab(s); break;
      case 'categorization': container.innerHTML = this._renderCategorizationTab(s); break;
      case 'advanced': container.innerHTML = this._renderAdvancedTab(s); break;
      default: container.innerHTML = this._renderConnectionTab(s);
    }

    // Wire up dirty tracking
    this._wireSettingsDirtyTracking();
    // Hide save bar after render (clean state)
    this._setSettingsDirty(false);
  }

  // ── Connection tab ────────────────────────────────────────────────────────
  _renderConnectionTab(s) {
    const isConnected = s.graphClientId && s.graphTenantId;
    const statusClass = isConnected ? 'success' : 'error';
    const statusLabel = isConnected ? 'Connected' : 'Disconnected';
    const statusIcon = isConnected
      ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--status-success)" stroke-width="2" stroke-linecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
      : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--status-error)" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';

    const selectedProvider = s.emailProvider || 'auto';
    const providers = [
      { value: 'graph', name: 'Microsoft Graph', desc: 'Direct API access via Azure AD' },
      { value: 'chrome', name: 'Chrome', desc: 'Outlook Web via browser extension' },
      { value: 'auto', name: 'Auto-detect', desc: 'Automatically choose best provider' },
    ];

    return `
      <div class="card">
        <div class="connection-header">
          <div class="connection-icon connection-icon--${statusClass}">${statusIcon}</div>
          <div class="connection-meta">
            <div class="connection-meta__title">Microsoft Graph</div>
            <div class="connection-status-text connection-status-text--${statusClass}">${statusLabel}</div>
          </div>
          <button type="button" id="graphAuthButton" class="btn btn--secondary btn--sm">Reconnect</button>
        </div>
        <div id="graphAuthCodeRow" style="display:none; margin-bottom:8px; gap:8px; align-items:center;">
          <input id="graphAuthDeviceCode" type="text" readonly class="form-input" aria-label="Graph device code" style="min-width:180px;">
          <button type="button" id="graphAuthCopyCodeBtn" class="btn btn--ghost btn--sm">Copy code</button>
        </div>
        <div id="graphAuthStatus" class="graph-auth-status" aria-live="polite"></div>
        <div class="stat-grid">
          <div class="stat-card">
            <div class="stat-card__label">Token Expiry</div>
            <div class="stat-card__value" id="statTokenExpiry">${isConnected ? 'Active' : '--'}</div>
          </div>
          <div class="stat-card">
            <div class="stat-card__label">Last Sync</div>
            <div class="stat-card__value" id="statLastSync">--</div>
          </div>
          <div class="stat-card">
            <div class="stat-card__label">Account</div>
            <div class="stat-card__value" id="statAccount">${s.graphTenantId || '--'}</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card__title">Email Provider</div>
        <div class="card__description">Choose how the app fetches your email.</div>
        <div class="provider-options">
          ${providers.map((p) => `
            <div class="provider-option${p.value === selectedProvider ? ' is-selected' : ''}" data-provider="${p.value}">
              <div class="provider-option__name">${p.name}</div>
              <div class="provider-option__desc">${p.desc}</div>
            </div>
          `).join('')}
        </div>
        <input type="hidden" id="setting-provider" value="${selectedProvider}">
      </div>

      <div class="card">
        <div class="card__title">Archive Destination</div>
        <div class="card__description">When set, Archive action moves emails into this Outlook folder.</div>
        <div class="setting-group">
          <label class="form-label" for="setting-archiveFolder">Folder</label>
          <select id="setting-archiveFolder" class="form-select">
            <option value="">Default archive behavior</option>
          </select>
        </div>
      </div>

      <div class="card">
        <div class="card__title">Inbox Lookback</div>
        <div class="card__description">Graph triage scans messages in this recent window (plus flagged).</div>
        <div class="setting-group">
          <label class="form-label" for="setting-lookbackDays">Days</label>
          <input id="setting-lookbackDays" type="number" class="form-input" min="1" max="60" value="${s.lookbackDays ?? 3}">
        </div>
      </div>

      <div class="card">
        <div class="card__title">Graph Credentials</div>
        <div class="card__description">Azure AD application registration details.</div>
        <div class="setting-group">
          <label class="form-label" for="setting-clientId">Client ID</label>
          <input id="setting-clientId" type="text" class="form-input" placeholder="Azure app client ID" spellcheck="false" value="${this._escapeAttr(s.graphClientId || '')}">
        </div>
        <div class="setting-group">
          <label class="form-label" for="setting-tenantId">Tenant ID</label>
          <input id="setting-tenantId" type="text" class="form-input" placeholder="organizations" value="${this._escapeAttr(s.graphTenantId || 'organizations')}">
        </div>
      </div>
    `;
  }

  // ── AI Providers tab ──────────────────────────────────────────────────────
  _renderAiProvidersTab(s) {
    const providerOptions = `
      <option value="claude-opus">Claude Opus</option>
      <option value="openai-gpt41">OpenAI (GPT-4.1)</option>
      <option value="gemma-lmstudio">Gemma (LM Studio)</option>
    `;
    const fallbackOptions = `
      <option value="gemma-lmstudio">Gemma (LM Studio)</option>
      <option value="openai-gpt54">OpenAI (GPT-5.4)</option>
      <option value="claude-opus">Claude Opus</option>
    `;
    const modelOptions = `
      <option value="gpt-5.4">GPT-5.4 (Flagship)</option>
      <option value="gpt-5.4-mini">GPT-5.4 Mini (Cost-effective)</option>
      <option value="gpt-5.4-nano">GPT-5.4 Nano (Budget)</option>
      <option value="gpt-4o">GPT-4o</option>
      <option value="gpt-4o-mini">GPT-4o Mini</option>
    `;

    return `
      <div class="card">
        <div class="card__title">Primary Provider</div>
        <div class="card__description">Main AI provider for categorization and drafting.</div>
        <div class="setting-group">
          <label class="form-label" for="setting-aiPrimary">Provider</label>
          <select id="setting-aiPrimary" class="form-select">${providerOptions}</select>
        </div>
        <div class="setting-group">
          <label class="form-label" for="setting-aiOpenAiModel">OpenAI Model</label>
          <select id="setting-aiOpenAiModel" class="form-select">${modelOptions}</select>
        </div>
        <div class="setting-group">
          <label class="form-label" for="setting-openaiApiKey">OpenAI API Key</label>
          <input id="setting-openaiApiKey" type="password" class="form-input" placeholder="sk-..." autocomplete="off" spellcheck="false" value="${this._escapeAttr(s.openaiApiKey || '')}">
          <div class="form-hint">Used for OpenAI primary/fallback calls.</div>
        </div>
        <div class="setting-group">
          <label class="form-label" for="setting-anthropicApiKey">Anthropic API Key</label>
          <input id="setting-anthropicApiKey" type="password" class="form-input" placeholder="sk-ant-..." autocomplete="off" spellcheck="false" value="${this._escapeAttr(s.anthropicApiKey || '')}">
          <div class="form-hint">Used for Claude primary/fallback calls.</div>
        </div>
      </div>

      <div class="card">
        <div class="card__title">Fallback Provider</div>
        <div class="card__description">Used when primary provider is unavailable.</div>
        <div class="setting-group">
          <label class="form-label" for="setting-aiFallback">Provider</label>
          <select id="setting-aiFallback" class="form-select">${fallbackOptions}</select>
        </div>
      </div>

      <div class="card">
        <div class="card__title">AI Settings</div>
        <div class="card__description">Control AI drafting behavior.</div>
        <div class="setting-group" style="display:flex;align-items:center;gap:12px;">
          <label class="toggle">
            <input type="checkbox" id="setting-aiDraftEnabled" ${s.aiDraftEnabled !== false ? 'checked' : ''}>
            <span class="toggle-track"></span>
            <span class="toggle-knob"></span>
          </label>
          <span class="form-label" style="margin-bottom:0;">Enable AI Drafting</span>
        </div>
        <div class="setting-group">
          <label class="form-label" for="setting-maxDraftLength">Max Draft Length (chars)</label>
          <input id="setting-maxDraftLength" type="number" class="form-input" min="200" max="12000" value="${s.maxDraftLength ?? 4000}">
        </div>
      </div>

      <div class="card">
        <div class="card__title">Scoring &amp; Priority</div>
        <div class="card__description">Configure triage scoring thresholds.</div>
        <div class="setting-group">
          <label class="form-label" for="setting-minScore">Priority Threshold (%)</label>
          <input id="setting-minScore" type="number" class="form-input" min="0" max="100" value="${s.minScore ?? 20}">
        </div>
        <div class="setting-group" style="display:flex;align-items:center;gap:12px;">
          <label class="toggle">
            <input type="checkbox" id="setting-groupByPriority" ${(typeof PortalState !== 'undefined' && PortalState.getGroupByPriority()) ? 'checked' : ''}>
            <span class="toggle-track"></span>
            <span class="toggle-knob"></span>
          </label>
          <span class="form-label" style="margin-bottom:0;">Group by Priority</span>
        </div>
      </div>
    `;
  }

  // ── Categorization tab (placeholder for Task 8) ───────────────────────────
  _renderCategorizationTab(_s) {
    return `
      <div class="card">
        <div class="card__title">Categorization</div>
        <p style="font-size:0.8125rem;color:var(--text-muted);">Category, topic label, and custom rule configuration coming in next update.</p>
      </div>
    `;
  }

  // ── Advanced tab ──────────────────────────────────────────────────────────
  _renderAdvancedTab(s) {
    const vipValue = Array.isArray(s.vipSenders) ? s.vipSenders.join(', ') : (s.vipSenders || '');
    const knownKeys = DashboardClient.KNOWN_SETTINGS_KEYS;
    const extraSettings = {};
    Object.keys(s).forEach((key) => {
      if (!knownKeys.has(key)) extraSettings[key] = s[key];
    });
    const extraJson = Object.keys(extraSettings).length ? JSON.stringify(extraSettings, null, 2) : '';

    return `
      <div class="card">
        <div class="card__title">VIP Senders</div>
        <div class="card__description">Emails from these senders are always prioritised.</div>
        <div class="setting-group">
          <textarea id="setting-vipSenders" class="form-textarea" rows="3" placeholder="ceo@, vp@, director@">${this._escapeHtml(vipValue)}</textarea>
          <div class="form-hint">Comma-separated prefixes or addresses</div>
        </div>
      </div>

      <div class="card">
        <div class="card__title">Email Signature</div>
        <div class="card__description">Appended to AI-generated draft replies.</div>
        <div class="setting-group">
          <textarea id="setting-emailSignature" class="form-textarea" rows="4" placeholder="Kind regards,\nDamian">${this._escapeHtml(s.emailSignature || '')}</textarea>
        </div>
      </div>

      <div class="card">
        <div class="card__title">Additional Settings (JSON)</div>
        <div class="card__description">Custom keys are loaded here and saved back to settings.</div>
        <div class="setting-group">
          <textarea id="setting-extra" class="form-textarea" rows="6" placeholder='{\n  "graphScopes": ["Mail.Read", "User.Read"]\n}'>${this._escapeHtml(extraJson)}</textarea>
        </div>
      </div>
    `;
  }

  // ── Post-render: set select values (must be called after innerHTML) ───────
  _applySelectValues() {
    const s = this._settingsData || {};
    const f = (id) => document.getElementById(id);
    if (f('setting-provider')) f('setting-provider').value = s.emailProvider || 'auto';
    if (f('setting-archiveFolder')) f('setting-archiveFolder').value = s.archiveFolderId || '';
    if (f('setting-aiPrimary')) f('setting-aiPrimary').value = s.aiProviderPrimary || 'claude-opus';
    if (f('setting-aiFallback')) f('setting-aiFallback').value = s.aiProviderFallback || 'gemma-lmstudio';
    if (f('setting-aiOpenAiModel')) f('setting-aiOpenAiModel').value = s.aiOpenAiModel || 'gpt-5.4';
  }

  // ── Dirty state tracking ──────────────────────────────────────────────────
  _wireSettingsDirtyTracking() {
    const content = document.getElementById('settingsContent');
    if (!content) return;

    // Set select values after render
    this._applySelectValues();

    // Wire provider option cards
    content.querySelectorAll('.provider-option').forEach((card) => {
      card.addEventListener('click', () => {
        content.querySelectorAll('.provider-option').forEach((c) => c.classList.remove('is-selected'));
        card.classList.add('is-selected');
        const hiddenInput = document.getElementById('setting-provider');
        if (hiddenInput) hiddenInput.value = card.dataset.provider;
        this._setSettingsDirty(true);
      });
    });

    // Track changes on inputs/selects/textareas
    content.querySelectorAll('input, select, textarea').forEach((el) => {
      el.addEventListener('input', () => this._setSettingsDirty(true));
      el.addEventListener('change', () => this._setSettingsDirty(true));
    });

    // Wire group-by-priority toggle directly (not part of server settings)
    const groupToggle = document.getElementById('setting-groupByPriority');
    if (groupToggle) {
      groupToggle.addEventListener('change', () => {
        if (typeof PortalState !== 'undefined') PortalState.setGroupByPriority(groupToggle.checked);
      });
    }
  }

  _setSettingsDirty(dirty) {
    if (typeof PortalState !== 'undefined') PortalState.setSettingsDirty(dirty);
    const bar = document.getElementById('settingsSaveBar');
    if (bar) bar.hidden = !dirty;
  }

  // ── Gather values from current form controls and save ─────────────────────
  async saveSettings() {
    const saveBtn = document.getElementById('settingsSave');
    if (saveBtn) saveBtn.disabled = true;

    const f = (id) => {
      const el = document.getElementById(id);
      return el ? (el.type === 'checkbox' ? el.checked : el.value) : undefined;
    };

    try {
      const vipRaw = String(f('setting-vipSenders') || '');
      const extraRaw = String(f('setting-extra') || '').trim();
      let extraSettings = {};
      if (extraRaw) {
        const parsed = JSON.parse(extraRaw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('Additional Settings must be a JSON object');
        }
        extraSettings = parsed;
      }

      // Merge with existing data so we don't lose fields from other tabs
      const payload = {
        ...(this._settingsData || {}),
        emailProvider: f('setting-provider') ?? this._settingsData?.emailProvider ?? 'auto',
        graphClientId: f('setting-clientId') ?? this._settingsData?.graphClientId ?? '',
        graphTenantId: f('setting-tenantId') ?? this._settingsData?.graphTenantId ?? 'organizations',
        archiveFolderId: f('setting-archiveFolder') ?? this._settingsData?.archiveFolderId ?? '',
        lookbackDays: Number(f('setting-lookbackDays')) || this._settingsData?.lookbackDays || 3,
        minScore: Number(f('setting-minScore')) || this._settingsData?.minScore || 20,
        vipSenders: f('setting-vipSenders') !== undefined
          ? vipRaw.split(',').map((s) => s.trim()).filter(Boolean)
          : (this._settingsData?.vipSenders || []),
        emailSignature: f('setting-emailSignature') ?? this._settingsData?.emailSignature ?? '',
        aiProviderPrimary: f('setting-aiPrimary') ?? this._settingsData?.aiProviderPrimary ?? 'claude-opus',
        aiProviderFallback: f('setting-aiFallback') ?? this._settingsData?.aiProviderFallback ?? 'gemma-lmstudio',
        openaiApiKey: f('setting-openaiApiKey') ?? this._settingsData?.openaiApiKey ?? '',
        aiOpenAiModel: f('setting-aiOpenAiModel') ?? this._settingsData?.aiOpenAiModel ?? 'gpt-5.4',
        anthropicApiKey: f('setting-anthropicApiKey') ?? this._settingsData?.anthropicApiKey ?? '',
        aiDraftEnabled: f('setting-aiDraftEnabled') !== undefined ? f('setting-aiDraftEnabled') : (this._settingsData?.aiDraftEnabled !== false),
        maxDraftLength: Number(f('setting-maxDraftLength')) || this._settingsData?.maxDraftLength || 4000,
        extraSettings,
      };

      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || `HTTP ${res.status}`);

      // Update local cache
      this._settingsData = payload;
      this._setSettingsDirty(false);
    } catch (e) {
      console.error('Save settings error:', e);
      alert('Failed to save settings: ' + e.message);
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  // ── HTML helpers for settings templates ────────────────────────────────────
  _escapeAttr(str) {
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  _escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Graph status popover ──────────────────────────────────────────────────
  toggleGraphPopover() {
    let popover = document.querySelector('.graph-popover');
    if (popover) {
      popover.remove();
      return;
    }

    const s = this._settingsData || {};
    const isConnected = s.graphClientId && s.graphTenantId;
    const statusClass = isConnected ? 'success' : 'error';
    const statusLabel = isConnected ? 'Connected' : 'Disconnected';
    const statusIcon = isConnected
      ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--status-success)" stroke-width="2" stroke-linecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
      : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--status-error)" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';

    popover = document.createElement('div');
    popover.className = 'graph-popover';
    popover.innerHTML = `
      <div class="connection-header">
        <div class="connection-icon connection-icon--${statusClass}">${statusIcon}</div>
        <div class="connection-meta">
          <div class="connection-meta__title">Microsoft Graph</div>
          <div class="connection-status-text connection-status-text--${statusClass}">${statusLabel}</div>
        </div>
      </div>
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-card__label">Token</div>
          <div class="stat-card__value">${isConnected ? 'Active' : '--'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__label">Tenant</div>
          <div class="stat-card__value">${s.graphTenantId || '--'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__label">Provider</div>
          <div class="stat-card__value">${s.emailProvider || 'auto'}</div>
        </div>
      </div>
    `;
    document.body.appendChild(popover);

    // Close on click outside
    const closeHandler = (e) => {
      if (!popover.contains(e.target) && e.target.id !== 'graphStatusBtn' && !e.target.closest('#graphStatusBtn')) {
        popover.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
  }

  // Backward-compat stub
  fillSettingsForm(s) {
    this._settingsData = s;
    this.renderSettingsTabs();
    this.renderActiveSettingsTab();
  }

  async refreshTriage() {    const statusEl = document.getElementById('triageStatus');
    const btnEl = document.getElementById('triageRefreshBtn');

    if (this.isRefreshingTriage) {
      return;
    }
    this.isRefreshingTriage = true;

    if (btnEl) {
      btnEl.disabled = true;
    }
    if (statusEl) {
      statusEl.textContent = 'Scanning inbox...';
    }
    this.triageError = null;

    try {
      const response = await fetch('/api/emails/triage', { method: 'POST' });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      this.triageItems = data.items || [];
      this.triageMeta = {
        extractedCount: Number(data.extractedCount || 0),
        minScore: Number(data.minScore ?? this.triageMeta.minScore ?? 35)
      };
      this.triageError = null;
      this.renderTriage();
    } catch (error) {
      this.triageError = 'Unable to load messages';
      this.triageItems = [];
      this.renderTriage();
      if (statusEl) {
        statusEl.textContent = this.triageError;
      }
    } finally {
      this.isRefreshingTriage = false;
      if (btnEl) {
        btnEl.disabled = false;
      }
    }
  }

  renderTriage() {
    const statusEl = document.getElementById('triageStatus');
    const ingestedAt = new Date().toISOString();
    const rawItems = Array.isArray(this.triageItems) ? this.triageItems : [];
    const localState = typeof PortalState !== 'undefined' && PortalState.readEmailUiState
      ? PortalState.readEmailUiState()
      : {};
    const mapped = typeof EmailHelpers !== 'undefined' && EmailHelpers.mapEmailItem
      ? rawItems.map((item) => EmailHelpers.mapEmailItem(item, ingestedAt))
      : rawItems;
    const merged = typeof PortalState !== 'undefined' && PortalState.mergeEmailUiState
      ? PortalState.mergeEmailUiState(mapped, localState)
      : mapped;

    const filtered = applyEmailFilters(merged, this.emailFilters);

    if (typeof EmailHelpers !== 'undefined' && EmailHelpers.warnIfLargeEmailList) {
      EmailHelpers.warnIfLargeEmailList(filtered);
    }

    // Compute counts for filter pills (after search, before active filter narrowing)
    this.updateFilterCounts(merged);
    
    this.renderEmailCards(filtered);
    this.updateFilterActiveStates();

    if (!rawItems.length) {
      if (statusEl) {
        statusEl.textContent = `Scanned ${this.triageMeta.extractedCount} emails. No actionable emails above ${this.triageMeta.minScore}%.`;
      }
      return;
    }

    if (statusEl) {
      statusEl.textContent = `Scanned ${this.triageMeta.extractedCount} emails. Found ${rawItems.length} actionable (threshold ${this.triageMeta.minScore}%).`;
    }
  }

  updateFilterCounts(items) {
    if (typeof EmailHelpers === 'undefined' || !EmailHelpers.countEmailBuckets) {
      return;
    }

    const counts = EmailHelpers.countEmailBuckets(items, { search: this.emailFilters.search });
    this._lastTagCounts = counts.tags || {};

    // ── Category pills ──────────────────────────────────────────────────────
    const categoryPillsEl = document.getElementById('categoryPills');
    if (categoryPillsEl) {
      categoryPillsEl.textContent = '';

      const allCount = Object.values(counts.categories).reduce((s, n) => s + n, 0);
      const allPill = document.createElement('button');
      allPill.type = 'button';
      allPill.className = 'pill' + (!this.emailFilters.category ? ' is-active' : '');
      allPill.dataset.category = '';
      allPill.textContent = 'All ';
      const allSpan = document.createElement('span');
      allSpan.className = 'pill-count';
      allSpan.textContent = String(allCount);
      allPill.appendChild(allSpan);
      categoryPillsEl.appendChild(allPill);

      const categoryVariants = {
        'Needs Reply': 'needs-reply',
        'Waiting on Others': 'waiting',
        'FYI': 'fyi',
      };

      ['Needs Reply', 'Waiting on Others', 'FYI'].forEach((cat) => {
        const count = counts.categories[cat] || 0;
        const variant = categoryVariants[cat] || '';
        const isActive = this.emailFilters.category === cat;
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'pill' + (isActive ? ' is-active pill--' + variant : '');
        pill.dataset.category = cat;
        pill.textContent = cat + ' ';
        const countSpan = document.createElement('span');
        countSpan.className = 'pill-count';
        countSpan.textContent = String(count);
        pill.appendChild(countSpan);
        categoryPillsEl.appendChild(pill);
      });

      // Attach click handlers to category pills
      categoryPillsEl.querySelectorAll('[data-category]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.emailFilters.category = btn.dataset.category || null;
          this.renderTriage();
        });
      });
    }

    // ── State pills ─────────────────────────────────────────────────────────
    const statePillsEl = document.getElementById('statePills');
    if (statePillsEl) {
      statePillsEl.textContent = '';

      ['Flagged', 'Pinned', 'Done'].forEach((state) => {
        const isActive = this.emailFilters.state === state;
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'pill pill--sm pill--ghost' + (isActive ? ' is-active' : '');
        pill.dataset.state = state;
        pill.textContent = state;
        statePillsEl.appendChild(pill);
      });

      // Tag overflow pill
      const selectedTagCount = this.emailFilters.tags.length;
      const tagOverflow = document.createElement('span');
      tagOverflow.className = 'pill pill--sm pill--ghost';
      tagOverflow.id = 'tagOverflowPill';
      tagOverflow.hidden = selectedTagCount === 0;
      tagOverflow.textContent = '+' + selectedTagCount + ' tag' + (selectedTagCount !== 1 ? 's' : '');
      statePillsEl.appendChild(tagOverflow);

      // Tag filter button
      const tagBtn = document.createElement('button');
      tagBtn.type = 'button';
      tagBtn.className = 'btn btn--icon btn--ghost';
      tagBtn.id = 'tagFilterBtn';
      tagBtn.setAttribute('aria-label', 'Filter by tags');
      tagBtn.style.marginLeft = 'auto';
      tagBtn.style.position = 'relative';
      const tagSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      tagSvg.setAttribute('width', '14');
      tagSvg.setAttribute('height', '14');
      tagSvg.setAttribute('viewBox', '0 0 24 24');
      tagSvg.setAttribute('fill', 'none');
      tagSvg.setAttribute('stroke', 'currentColor');
      tagSvg.setAttribute('stroke-width', '2');
      tagSvg.setAttribute('stroke-linecap', 'round');
      const tagPoly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      tagPoly.setAttribute('points', '22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3');
      tagSvg.appendChild(tagPoly);
      tagBtn.appendChild(tagSvg);
      statePillsEl.appendChild(tagBtn);

      // Attach click handlers to state pills
      statePillsEl.querySelectorAll('[data-state]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.emailFilters.state = this.emailFilters.state === btn.dataset.state ? null : btn.dataset.state;
          this.renderTriage();
        });
      });

      // Attach tag filter popover toggle
      tagBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleTagPopover(tagBtn);
      });
    }
  }

  toggleTagPopover(anchorBtn) {
    let popover = document.querySelector('.tag-popover');
    if (popover) {
      popover.remove();
      return;
    }

    const tagCounts = this._lastTagCounts || {};
    const entries = Object.entries(tagCounts)
      .filter(([, count]) => Number(count) > 0)
      .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));

    popover = document.createElement('div');
    popover.className = 'tag-popover';

    const title = document.createElement('div');
    title.className = 'tag-popover__title';
    title.textContent = 'Filter by tags';
    popover.appendChild(title);

    const tagsWrap = document.createElement('div');
    tagsWrap.className = 'tag-popover__tags';

    entries.forEach(([tag]) => {
      const isSelected = this.emailFilters.tags.includes(tag);
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'pill pill--sm pill--ghost' + (isSelected ? ' is-active' : '');
      pill.dataset.popoverTag = tag;
      pill.textContent = tag;
      pill.addEventListener('click', () => {
        const idx = this.emailFilters.tags.indexOf(tag);
        if (idx >= 0) {
          this.emailFilters.tags.splice(idx, 1);
        } else {
          this.emailFilters.tags.push(tag);
        }
        this.renderTriage();
      });
      tagsWrap.appendChild(pill);
    });

    popover.appendChild(tagsWrap);

    if (this.emailFilters.tags.length > 0) {
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'tag-popover__clear';
      clearBtn.textContent = 'Clear all';
      clearBtn.addEventListener('click', () => {
        this.emailFilters.tags = [];
        this.renderTriage();
      });
      popover.appendChild(clearBtn);
    }

    // Position relative to anchorBtn
    anchorBtn.style.position = 'relative';
    anchorBtn.appendChild(popover);

    // Close popover when clicking outside
    const closeHandler = (e) => {
      if (!popover.contains(e.target) && e.target !== anchorBtn && !anchorBtn.contains(e.target)) {
        popover.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
  }

  updateFilterActiveStates() {
    // Category and state pills are now fully re-rendered in updateFilterCounts(),
    // so active states are applied there. This method is kept as a no-op for
    // backward compatibility with any code that still calls it.
  }

  renderEmailCards(items) {
    const listEl = document.getElementById('triageList');
    const emptyStateEl = document.getElementById('emailEmptyState');
    if (!listEl) return;

    const safeItems = Array.isArray(items) ? items : [];
    this.selectedEmailId = resolveSelectedEmailId(this.selectedEmailId, safeItems);

    listEl.textContent = '';

    if (!safeItems.length) {
      this.mobileReaderOpen = false;
      this.renderReaderPane(null);
      this.syncEmailWorkspaceState();
      if (emptyStateEl) {
        emptyStateEl.textContent = resolveEmptyStateMessage({
          triageError: this.triageError,
          filters: this.emailFilters,
        });
        emptyStateEl.hidden = false;
      }
      return;
    }

    if (emptyStateEl) {
      emptyStateEl.hidden = true;
    }

    const selectedItem = safeItems.find((item) => String((item && item.id) || '') === this.selectedEmailId) || null;
    this.renderReaderPane(selectedItem);
    this.syncEmailWorkspaceState();

    // Helper: check if an item belongs to the 'act-now' tier
    const isActNow = (item) => {
      return item.urgency === 'high' && (item.score || 0) >= 70;
    };

    // Helper: build a single compact email row element
    const buildEmailRow = (item) => {
      const itemId = String(item && item.id ? item.id : '');
      const isSelected = Boolean(itemId) && itemId === this.selectedEmailId;
      const sender = String((item && item.sender) || 'Unknown sender');
      const subject = String((item && item.subject) || 'No subject');
      const preview = String((item && item.preview) || (item && item.body) || '');
      const category = String((item && item.primaryCategory) || 'FYI');
      const tags = Array.isArray(item && item.tags) ? item.tags : [];
      const visibleTags = tags.slice(0, 2);
      const overflowTagCount = Math.max(tags.length - visibleTags.length, 0);
      const score = typeof item.score === 'number' ? item.score : 0;
      const timestampMeta = typeof EmailHelpers !== 'undefined' && EmailHelpers.resolveDisplayTimestamp
        ? EmailHelpers.resolveDisplayTimestamp(item)
        : { value: item && item.timestamp ? item.timestamp : item && item.ingestedAt };
      const isoTimestamp = String((timestampMeta && timestampMeta.value) || '');

      // Derive colors from helpers
      const senderInitials = sender.trim() ? sender.trim().charAt(0).toUpperCase() : '?';
      const avColor = typeof EmailHelpers !== 'undefined' && EmailHelpers.avatarColor
        ? EmailHelpers.avatarColor(sender)
        : { bg: '#e8d5c4', fg: '#8b6a4f' };
      const heatColor = typeof EmailHelpers !== 'undefined' && EmailHelpers.scoreToHeatColor
        ? EmailHelpers.scoreToHeatColor(score)
        : '#e0dbd4';
      const catColor = typeof EmailHelpers !== 'undefined' && EmailHelpers.getCategoryColor
        ? EmailHelpers.getCategoryColor(category)
        : { fg: '#777', bg: '#f5f3f0' };

      const actNow = isActNow(item);

      // ── Row container ─────────────────────────────────────────────────────
      const rowEl = document.createElement('div');
      rowEl.className = 'email-row' + (actNow ? ' is-act-now' : '') + (isSelected ? ' is-selected' : '');
      rowEl.dataset.id = itemId;
      rowEl.style.borderLeftColor = heatColor;

      // ── Avatar ────────────────────────────────────────────────────────────
      const avatarEl = document.createElement('div');
      avatarEl.className = 'avatar avatar--md';
      avatarEl.style.background = avColor.bg;
      avatarEl.style.color = avColor.fg;
      avatarEl.textContent = senderInitials;

      // ── Content wrapper ───────────────────────────────────────────────────
      const contentEl = document.createElement('div');
      contentEl.className = 'email-row__content';

      // ── Line 1 ────────────────────────────────────────────────────────────
      const line1 = document.createElement('div');
      line1.className = 'email-row__line1';

      const senderEl = document.createElement('span');
      senderEl.className = 'email-row__sender';
      senderEl.textContent = sender;

      const badgeEl = document.createElement('span');
      badgeEl.className = 'badge';
      badgeEl.style.background = catColor.bg;
      badgeEl.style.color = catColor.fg;
      badgeEl.textContent = category;

      const tagsEl = document.createElement('span');
      tagsEl.className = 'email-row__tags';
      visibleTags.forEach((tag) => {
        const pill = document.createElement('span');
        pill.className = 'pill pill--sm pill--ghost';
        pill.textContent = String(tag);
        tagsEl.appendChild(pill);
      });
      if (overflowTagCount > 0) {
        const overflowPill = document.createElement('span');
        overflowPill.className = 'pill pill--sm pill--ghost';
        overflowPill.textContent = '+' + overflowTagCount;
        tagsEl.appendChild(overflowPill);
      }

      line1.append(senderEl, badgeEl, tagsEl);

      if (actNow) {
        const actionLabel = document.createElement('span');
        actionLabel.className = 'email-row__action-label';
        actionLabel.textContent = 'Action required';
        line1.appendChild(actionLabel);
      }

      const scoreDot = document.createElement('span');
      scoreDot.className = 'email-row__score-dot';
      scoreDot.style.background = heatColor;

      const timeEl = document.createElement('span');
      timeEl.className = 'email-row__time';
      timeEl.textContent = relativeTime(isoTimestamp);
      timeEl.title = isoTimestamp;

      line1.append(scoreDot, timeEl);

      // ── Line 2 ────────────────────────────────────────────────────────────
      const line2 = document.createElement('div');
      line2.className = 'email-row__line2';

      const subjectEl = document.createElement('span');
      subjectEl.className = 'email-row__subject';
      subjectEl.textContent = subject;

      const previewEl = document.createElement('span');
      previewEl.className = 'email-row__preview';
      previewEl.textContent = preview ? ' \u2014 ' + preview : '';

      line2.append(subjectEl, previewEl);

      contentEl.append(line1, line2);
      rowEl.append(avatarEl, contentEl);

      // ── Click handler ─────────────────────────────────────────────────────
      rowEl.addEventListener('click', () => {
        if (itemId) {
          this.selectedEmailId = itemId;
          listEl.querySelectorAll('.email-row').forEach((node) => {
            node.classList.toggle('is-selected', node.dataset.id === itemId);
          });
          this.openMobileReader(listEl);
          this.renderReaderPane(item);
        }
      });

      return rowEl;
    };

    // ── Render with or without priority grouping ────────────────────────────
    const useGrouping = typeof PortalState !== 'undefined' && PortalState.getGroupByPriority
      ? PortalState.getGroupByPriority()
      : true;

    if (useGrouping && typeof EmailHelpers !== 'undefined' && EmailHelpers.groupByPriorityTier) {
      const groups = EmailHelpers.groupByPriorityTier(safeItems);

      groups.forEach((group) => {
        // Tier header
        const headerEl = document.createElement('div');
        headerEl.className = 'tier-header tier-header--' + group.key;
        headerEl.dataset.tier = group.key;

        const labelEl = document.createElement('span');
        labelEl.className = 'tier-header__label';
        labelEl.textContent = group.label;

        const countEl = document.createElement('span');
        countEl.className = 'tier-header__count';
        countEl.textContent = String(group.items.length);

        const lineEl = document.createElement('span');
        lineEl.className = 'tier-header__line';

        const chevronEl = document.createElement('span');
        chevronEl.className = 'tier-header__chevron';
        chevronEl.textContent = '\u25BE';

        headerEl.append(labelEl, countEl, lineEl, chevronEl);

        // Tier group container
        const groupEl = document.createElement('div');
        groupEl.className = 'tier-group';
        groupEl.dataset.tier = group.key;

        group.items.forEach((item) => {
          groupEl.appendChild(buildEmailRow(item));
        });

        // Collapse toggle
        headerEl.addEventListener('click', () => {
          headerEl.classList.toggle('is-collapsed');
          groupEl.classList.toggle('is-collapsed');
        });

        listEl.append(headerEl, groupEl);
      });
    } else {
      // Flat list — no tier headers
      safeItems.forEach((item) => {
        listEl.appendChild(buildEmailRow(item));
      });
    }
  }

  // ── Stubs for action handlers (attached via delegation or kept for reader pane) ──
  _handleEmailPin(item, itemId) {
    if (typeof PortalState === 'undefined' || !PortalState.readEmailUiState || !PortalState.writeEmailUiState) {
      return;
    }

    const currentUiState = item && item.uiState ? item.uiState : {};
    const newPinnedValue = !Boolean(currentUiState.pinned);

    fetch(`/api/emails/${encodeURIComponent(itemId)}/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: Boolean(newPinnedValue) }),
    })
      .then((response) => response.json())
      .then((payload) => {
        if (!payload.success) {
          throw new Error(payload.error || 'Failed');
        }
        const state = PortalState.readEmailUiState();
        const newDoneValue = Boolean(currentUiState.done);
        state[itemId] = {
          pinned: Boolean(newPinnedValue),
          done: Boolean(newDoneValue),
          updatedAt: new Date().toISOString(),
        };
        PortalState.writeEmailUiState(state);
        this.renderTriage();
      })
      .catch((error) => {
        alert(`Failed to update pin state in Outlook: ${error.message}`);
      });
  }

  _handleEmailDone(item, itemId) {
    if (typeof PortalState === 'undefined' || !PortalState.readEmailUiState || !PortalState.writeEmailUiState) {
      return;
    }

    const state = PortalState.readEmailUiState();
    const currentUiState = item && item.uiState ? item.uiState : {};
    const newPinnedValue = Boolean(currentUiState.pinned);
    const newDoneValue = !Boolean(currentUiState.done);
    state[itemId] = {
      pinned: Boolean(newPinnedValue),
      done: Boolean(newDoneValue),
      updatedAt: new Date().toISOString(),
    };

    PortalState.writeEmailUiState(state);
    this.renderTriage();
  }

  renderReaderPane(item) {
    const readerPane = document.getElementById('readerPane');
    if (!readerPane) {
      return;
    }

    readerPane.innerHTML = '';

    if (!item) {
      readerPane.innerHTML = '<div class="reader-empty">Select an email to read</div>';
      return;
    }

    const itemId = String(item.id || '');
    const sender = String(item.sender || 'Unknown sender');
    const senderEmail = String(item.senderEmail || item.from || '');
    const subject = String(item.subject || 'No subject');
    const category = String(item.primaryCategory || 'FYI');
    const tags = Array.isArray(item.tags) ? item.tags : [];
    const score = typeof item.score === 'number' ? item.score : 0;
    const senderInitials = sender.trim() ? sender.trim().charAt(0).toUpperCase() : '?';

    const avColor = typeof EmailHelpers !== 'undefined' && EmailHelpers.avatarColor
      ? EmailHelpers.avatarColor(sender)
      : { bg: '#e8d5c4', fg: '#8b6a4f' };
    const catColor = typeof EmailHelpers !== 'undefined' && EmailHelpers.getCategoryColor
      ? EmailHelpers.getCategoryColor(category)
      : { fg: '#777', bg: '#f5f3f0' };
    const heatColor = typeof EmailHelpers !== 'undefined' && EmailHelpers.scoreToHeatColor
      ? EmailHelpers.scoreToHeatColor(score)
      : '#e0dbd4';

    const timestampMeta = typeof EmailHelpers !== 'undefined' && EmailHelpers.resolveDisplayTimestamp
      ? EmailHelpers.resolveDisplayTimestamp(item)
      : { value: item.timestamp || item.ingestedAt };
    const isoTimestamp = String((timestampMeta && timestampMeta.value) || '');

    const currentUiState = item.uiState || {};
    const isPinned = Boolean(currentUiState.pinned);
    const isDone = Boolean(currentUiState.done);

    // ── Tag pills HTML ──────────────────────────────────────────────────────
    const tagPillsHtml = tags.map((t) =>
      `<span class="pill pill--sm pill--ghost">${this.escapeHtml(String(t))}</span>`
    ).join('');

    // ── Score detail section ────────────────────────────────────────────────
    const urgency = this.escapeHtml(String(item.urgency || 'unknown'));
    const recommendedAction = this.escapeHtml(String(item.recommendedAction || item.action || 'none'));
    const reasons = Array.isArray(item.reasons) ? item.reasons : [];
    const reasonsHtml = reasons.map((r) => `<li>${this.escapeHtml(String(r))}</li>`).join('');

    // ── Draft section ───────────────────────────────────────────────────────
    const draft = item.draft || null;
    let draftHtml = '';
    if (draft) {
      const draftText = this.escapeHtml(String(draft.body || draft.text || ''));
      const providerName = this.escapeHtml(formatDraftProviderNotice(draft));
      draftHtml = `
        <div class="card card--ai" id="draftCard">
          <div class="draft-header">
            <div class="draft-icon">\u2605</div>
            <span class="draft-label">AI DRAFT</span>
            <span class="draft-provider">${providerName}</span>
          </div>
          <div class="draft-body" id="draftBody">${draftText}</div>
          <div class="draft-actions" id="draftActions">
            <button class="btn btn--primary-ai btn--sm" data-action="send-draft" id="sendDraftBtn">Send Draft</button>
            <button class="btn btn--secondary btn--sm" data-action="edit-draft">Edit</button>
            <button class="btn btn--ghost btn--sm" data-action="regenerate">Regenerate</button>
          </div>
        </div>`;
    }

    // ── Build full reader HTML ──────────────────────────────────────────────
    const html = `
      <div class="reader-header">
        <div class="reader-header__top">
          <div class="avatar avatar--lg" style="background: ${avColor.bg}; color: ${avColor.fg}">${this.escapeHtml(senderInitials)}</div>
          <div class="reader-header__meta">
            <div class="reader-header__subject">${this.escapeHtml(subject)}</div>
            <div class="reader-header__sender">${this.escapeHtml(sender)} &middot; ${this.escapeHtml(senderEmail)} &middot; ${this.escapeHtml(relativeTime(isoTimestamp))}</div>
          </div>
          <div class="reader-header__badges">
            <span class="badge" style="background: ${catColor.bg}; color: ${catColor.fg}">${this.escapeHtml(category)}</span>
            ${tagPillsHtml}
            <span class="badge reader-score-badge" style="background: ${heatColor}; color: #fff" id="scoreToggle">Score: ${score}</span>
          </div>
        </div>

        <div class="reader-score-detail" id="scoreDetail" hidden>
          <div class="section-label">Scoring Details</div>
          <div><strong>Urgency:</strong> ${urgency}</div>
          <div><strong>Action:</strong> ${recommendedAction}</div>
          <div><strong>Reasons:</strong></div>
          <ul>${reasonsHtml}</ul>
        </div>

        <div class="reader-actions">
          <button class="btn btn--secondary btn--sm" data-action="reply">Reply</button>
          <button class="btn btn--secondary btn--sm" data-action="pin">${isPinned ? 'Unpin' : 'Pin'}</button>
          <button class="btn btn--secondary btn--sm" data-action="move" id="moveToBtn" style="position: relative;">Move to\u2026</button>
          <button class="btn btn--secondary btn--sm" data-action="archive">Archive</button>
          <button class="btn btn--secondary btn--sm" data-action="done">${isDone ? 'Undo Done' : 'Done'}</button>
          <button class="btn btn--danger btn--sm" data-action="delete" style="margin-left: auto;">Delete</button>
        </div>
      </div>

      <div class="reader-body">${this.escapeHtml(String(item.body || item.preview || 'No content available.'))}</div>

      ${draftHtml}
    `;

    readerPane.innerHTML = html;

    // ── Mobile back button (must be after innerHTML) ──────────────────────
    if (isMobileReaderViewport()) {
      const backButton = document.createElement('button');
      backButton.type = 'button';
      backButton.className = 'mobile-reader-back';
      backButton.textContent = 'Back to inbox';
      backButton.addEventListener('click', () => {
        this.closeMobileReader();
      });
      readerPane.prepend(backButton);
    }

    // ── Wire up action buttons ──────────────────────────────────────────────
    this._wireReaderActions(item, itemId, readerPane);
  }

  _wireReaderActions(item, itemId, readerPane) {
    // Score toggle
    const scoreToggle = readerPane.querySelector('#scoreToggle');
    const scoreDetail = readerPane.querySelector('#scoreDetail');
    if (scoreToggle && scoreDetail) {
      scoreToggle.addEventListener('click', () => {
        scoreDetail.hidden = !scoreDetail.hidden;
      });
    }

    // Action buttons via delegation
    readerPane.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const action = e.currentTarget.dataset.action;
        switch (action) {
          case 'reply':
            this._handleReaderReply(item, itemId);
            break;
          case 'pin':
            this._handleEmailPin(item, itemId);
            break;
          case 'archive':
            this._handleReaderArchive(itemId);
            break;
          case 'done':
            this._handleEmailDone(item, itemId);
            break;
          case 'delete':
            this._handleReaderDelete(itemId);
            break;
          case 'move':
            this._handleReaderMove(item, itemId, e.currentTarget);
            break;
          case 'send-draft':
            this._handleSendDraft(item, itemId, e.currentTarget);
            break;
          case 'edit-draft':
            this._handleEditDraft(item, itemId);
            break;
          case 'regenerate':
            this._handleRegenerateDraft(item, itemId);
            break;
          case 'save-draft':
            this._handleSaveDraft(item, itemId);
            break;
          case 'cancel-edit':
            this.renderReaderPane(item);
            break;
        }
      });
    });
  }

  // ── Reader action handlers ──────────────────────────────────────────────
  _handleReaderReply(item, itemId) {
    // Generate AI draft
    fetch(`/api/emails/drafts/${encodeURIComponent(itemId)}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.draft) {
          item.draft = data.draft;
          this.renderReaderPane(item);
        }
      })
      .catch((err) => console.error('Failed to generate draft:', err));
  }

  _handleReaderArchive(itemId) {
    fetch(`/api/emails/${encodeURIComponent(itemId)}/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          this.triageItems = this.triageItems.filter((t) => String(t.id) !== itemId);
          this.selectedEmailId = null;
          this.renderReaderPane(null);
          this.renderTriage();
        }
      })
      .catch((err) => alert('Archive failed: ' + err.message));
  }

  _handleReaderDelete(itemId) {
    if (!confirm('Delete this email permanently?')) return;
    fetch(`/api/emails/${encodeURIComponent(itemId)}/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          this.triageItems = this.triageItems.filter((t) => String(t.id) !== itemId);
          this.selectedEmailId = null;
          this.renderReaderPane(null);
          this.renderTriage();
        }
      })
      .catch((err) => alert('Delete failed: ' + err.message));
  }

  // ── Inline draft editing ──────────────────────────────────────────────────
  _handleEditDraft(item, itemId) {
    const draftCard = document.getElementById('draftCard');
    if (!draftCard) return;
    const draft = item.draft || {};
    const draftSubject = String(draft.subject || item.subject || '');
    const draftBody = String(draft.body || draft.text || '');

    const draftBodyEl = document.getElementById('draftBody');
    const draftActionsEl = document.getElementById('draftActions');
    if (!draftBodyEl || !draftActionsEl) return;

    // Insert subject input before body
    const subjectInput = document.createElement('input');
    subjectInput.className = 'form-input draft-edit-subject';
    subjectInput.id = 'draftEditSubject';
    subjectInput.value = draftSubject;
    draftBodyEl.parentNode.insertBefore(subjectInput, draftBodyEl);

    // Replace body with textarea
    const textarea = document.createElement('textarea');
    textarea.className = 'form-textarea';
    textarea.id = 'draftEditBody';
    textarea.value = draftBody;
    textarea.rows = calculateDraftEditorRows(draftBody);
    draftBodyEl.replaceWith(textarea);

    // Replace action buttons
    draftActionsEl.innerHTML = `
      <button class="btn btn--primary btn--sm" data-action="save-draft">Save</button>
      <button class="btn btn--ghost btn--sm" data-action="cancel-edit">Cancel</button>
    `;

    // Wire up new buttons
    draftActionsEl.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const action = e.currentTarget.dataset.action;
        if (action === 'save-draft') {
          this._handleSaveDraft(item, itemId);
        } else if (action === 'cancel-edit') {
          this.renderReaderPane(item);
        }
      });
    });

    textarea.focus();
  }

  _handleSaveDraft(item, itemId) {
    const subjectInput = document.getElementById('draftEditSubject');
    const bodyTextarea = document.getElementById('draftEditBody');
    if (!subjectInput || !bodyTextarea) return;

    const updatedSubject = subjectInput.value;
    const updatedBody = bodyTextarea.value;

    fetch(`/api/emails/drafts/${encodeURIComponent(itemId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: updatedSubject, body: updatedBody }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success || data.draft) {
          if (!item.draft) item.draft = {};
          item.draft.subject = updatedSubject;
          item.draft.body = updatedBody;
        }
        this.renderReaderPane(item);
      })
      .catch((err) => {
        console.error('Failed to save draft:', err);
        this.renderReaderPane(item);
      });
  }

  _handleSendDraft(item, itemId, btn) {
    if (btn.dataset.confirming === 'true') {
      // Second click during confirm window — actually send
      btn.textContent = 'Sending...';
      btn.disabled = true;
      fetch(`/api/emails/drafts/${encodeURIComponent(itemId)}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            delete item.draft;
            this.renderReaderPane(item);
          } else {
            alert('Send failed: ' + (data.error || 'Unknown error'));
            btn.textContent = 'Send Draft';
            btn.disabled = false;
            btn.dataset.confirming = 'false';
          }
        })
        .catch((err) => {
          alert('Send failed: ' + err.message);
          btn.textContent = 'Send Draft';
          btn.disabled = false;
          btn.dataset.confirming = 'false';
        });
      return;
    }

    // First click — enter confirm state
    btn.dataset.confirming = 'true';
    btn.textContent = 'Confirm Send?';
    btn.classList.add('btn--confirm');

    setTimeout(() => {
      if (btn.dataset.confirming === 'true') {
        btn.textContent = 'Send Draft';
        btn.classList.remove('btn--confirm');
        btn.dataset.confirming = 'false';
      }
    }, 3000);
  }

  _handleRegenerateDraft(item, itemId) {
    fetch(`/api/emails/drafts/${encodeURIComponent(itemId)}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.draft) {
          item.draft = data.draft;
          this.renderReaderPane(item);
        }
      })
      .catch((err) => console.error('Failed to regenerate draft:', err));
  }

  // ── Move to folder ──────────────────────────────────────────────────────
  _handleReaderMove(item, itemId, btnEl) {
    // Close existing popover if open
    const existing = document.getElementById('folderPopover');
    if (existing) {
      existing.remove();
      return;
    }

    const popover = document.createElement('div');
    popover.className = 'folder-popover';
    popover.id = 'folderPopover';
    popover.innerHTML = '<div class="section-label">Move to folder</div><div class="folder-popover__list" id="folderList">Loading...</div>';
    btnEl.appendChild(popover);

    // Close on outside click
    const closePopover = (e) => {
      if (!popover.contains(e.target) && e.target !== btnEl) {
        popover.remove();
        document.removeEventListener('click', closePopover);
      }
    };
    setTimeout(() => document.addEventListener('click', closePopover), 0);

    // Fetch folders (with cache)
    const renderFolders = (folders) => {
      const listEl = document.getElementById('folderList');
      if (!listEl) return;
      listEl.innerHTML = '';
      folders.forEach((folder) => {
        const btn = document.createElement('button');
        btn.className = 'folder-popover__item';
        btn.dataset.folderId = folder.id;
        btn.textContent = folder.displayName;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._moveEmailToFolder(itemId, folder.id, item);
          popover.remove();
          document.removeEventListener('click', closePopover);
        });
        listEl.appendChild(btn);
      });
    };

    if (this.folderCache) {
      renderFolders(this.folderCache);
    } else {
      fetch('/api/graph/mail-folders')
        .then((res) => res.json())
        .then((data) => {
          const folders = Array.isArray(data.folders) ? data.folders : [];
          this.folderCache = folders;
          renderFolders(folders);
        })
        .catch((err) => {
          const listEl = document.getElementById('folderList');
          if (listEl) listEl.textContent = 'Failed to load folders';
          console.error('Folder fetch error:', err);
        });
    }
  }

  _moveEmailToFolder(emailId, folderId, item) {
    fetch(`/api/emails/${encodeURIComponent(emailId)}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success || !data.error) {
          this.triageItems = this.triageItems.filter((t) => String(t.id) !== emailId);
          this.selectedEmailId = null;
          this.renderReaderPane(null);
          this.renderTriage();
        } else {
          alert('Move failed: ' + (data.error || 'Unknown error'));
        }
      })
      .catch((err) => alert('Move failed: ' + err.message));
  }

  openMobileReader(listEl) {
    if (!isMobileReaderViewport()) {
      return;
    }
    this.emailListScrollTop = listEl ? Number(listEl.scrollTop || 0) : 0;
    this.mobileReaderOpen = true;
    this.syncEmailWorkspaceState();
  }

  closeMobileReader() {
    this.mobileReaderOpen = false;
    this.syncEmailWorkspaceState();

    const listEl = document.getElementById('triageList');
    if (listEl) {
      listEl.scrollTop = this.emailListScrollTop;
    }
  }

  syncEmailWorkspaceState() {
    const workspace = document.querySelector('.email-workspace');
    if (!workspace) {
      return;
    }

    const isEmailRoute = (document.body.dataset.route || 'email') === 'email';
    const isReaderOpen = isEmailRoute && this.mobileReaderOpen && isMobileReaderViewport();
    workspace.classList.toggle('is-reader-open', isReaderOpen);
  }

  handleRouteChange(route) {
    if (route !== 'email') {
      this.mobileReaderOpen = false;
    }
    if (route !== 'settings') {
      this.stopGraphAuthPolling();
    }
    this.syncEmailWorkspaceState();
  }

  stopGraphAuthPolling() {
    if (this.graphAuthPollTimer) {
      clearInterval(this.graphAuthPollTimer);
      this.graphAuthPollTimer = null;
    }
  }

  pollGraphAuthStatus(sessionId) {
    const statusEl = document.getElementById('graphAuthStatus');
    if (!sessionId) {
      return;
    }

    this.stopGraphAuthPolling();

    const pollOnce = async () => {
      try {
        const response = await fetch(`/api/graph-auth/status/${encodeURIComponent(sessionId)}`);
        if (!response.ok) {
          throw new Error(`Status check failed (${response.status})`);
        }
        const data = await response.json();

        if (data.status === 'completed') {
          if (statusEl) {
            statusEl.textContent = 'Authentication complete. Graph token saved.';
          }
          this.stopGraphAuthPolling();
          return;
        }

        if (data.status === 'failed') {
          if (statusEl) {
            statusEl.textContent = `Authentication failed: ${data.error || 'Unknown error'}`;
          }
          this.stopGraphAuthPolling();
          return;
        }

        if (statusEl) {
          statusEl.textContent = 'Waiting for Microsoft sign-in approval...';
        }
      } catch (error) {
        if (statusEl) {
          statusEl.textContent = `Status check error: ${error.message}`;
        }
      }
    };

    void pollOnce();
    this.graphAuthPollTimer = setInterval(() => {
      void pollOnce();
    }, 3000);
  }

  setupGraphAuthButton() {
    try {
      let graphAuthBtn = document.getElementById('graphAuthButton');
      
      // If button doesn't exist in DOM, create and insert it dynamically
      if (!graphAuthBtn) {
        const tenantInput = document.getElementById('setting-tenantId');
        if (tenantInput) {
          const tenantGroup = tenantInput.closest('.setting-group');
          if (tenantGroup && tenantGroup.parentNode) {
            // Create the button group with more explicit styling
            const buttonGroup = document.createElement('div');
            buttonGroup.className = 'setting-group';
            buttonGroup.innerHTML = `
              <label>Microsoft Graph Authentication</label>
              <button type="button" id="graphAuthButton" class="btn btn-secondary" style="margin:8px 0;">Authenticate with Microsoft Graph</button>
              <div id="graphAuthCodeRow" style="display:none; margin:8px 0; gap:8px; align-items:center;">
                <input id="graphAuthDeviceCode" type="text" readonly aria-label="Graph device code" style="min-width:220px;" />
                <button type="button" id="graphAuthCopyCodeBtn" class="btn btn-secondary">Copy code</button>
              </div>
              <div id="graphAuthStatus" class="settings-save-status" aria-live="polite"></div>
              <small>Opens the device code flow to authorize Graph API access.</small>
            `;
            // Insert after the tenant ID group
            tenantGroup.parentNode.insertBefore(buttonGroup, tenantGroup.nextSibling);
            graphAuthBtn = document.getElementById('graphAuthButton');
          }
        }
      }
      
      // Attach click handler
      if (graphAuthBtn && !graphAuthBtn.dataset.graphAuthSetup) {
        graphAuthBtn.dataset.graphAuthSetup = 'true';
        graphAuthBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          await this.startGraphAuth();
        });
      }

      const copyBtn = document.getElementById('graphAuthCopyCodeBtn');
      if (copyBtn && !copyBtn.dataset.graphAuthSetup) {
        copyBtn.dataset.graphAuthSetup = 'true';
        copyBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          const codeInput = document.getElementById('graphAuthDeviceCode');
          const statusEl = document.getElementById('graphAuthStatus');
          const code = codeInput && typeof codeInput.value === 'string' ? codeInput.value.trim() : '';
          if (!code) {
            if (statusEl) {
              statusEl.textContent = 'No device code available yet.';
            }
            return;
          }

          try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
              await navigator.clipboard.writeText(code);
              if (statusEl) {
                statusEl.textContent = `Device code copied: ${code}`;
              }
              return;
            }
          } catch {
            // Fall back to manual selection below.
          }

          if (codeInput && typeof codeInput.select === 'function') {
            codeInput.focus();
            codeInput.select();
          }
          if (statusEl) {
            statusEl.textContent = `Clipboard blocked. Device code selected: ${code}`;
          }
        });
      }
    } catch (error) {
      console.error('Error setting up graph auth button:', error);
    }
  }

  async startGraphAuth() {
    const originalText = 'Authenticate with Microsoft Graph';
    const btn = document.getElementById('graphAuthButton');
    const statusEl = document.getElementById('graphAuthStatus');
    const codeRow = document.getElementById('graphAuthCodeRow');
    const codeInput = document.getElementById('graphAuthDeviceCode');
    if (!btn) return;

    btn.disabled = true;
    btn.textContent = 'Starting authentication...';
    if (statusEl) {
      statusEl.textContent = 'Requesting device code...';
    }

    try {
      const response = await fetch('/api/graph-auth/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error(`Request failed with status ${response.status}`);
      }

      if (data.success) {
        const message = data.instructions || 'Authentication started';
        const deviceCode = String(data.userCode || '').trim();

        if (codeRow) {
          codeRow.style.display = deviceCode ? 'flex' : 'none';
        }
        if (codeInput) {
          codeInput.value = deviceCode;
        }

        if (deviceCode) {
          try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
              await navigator.clipboard.writeText(deviceCode);
            }
          } catch {
            // Non-fatal: user can still use the copy button or selected field.
          }
        }

        if (statusEl) {
          statusEl.textContent = deviceCode
            ? `Device code ready: ${deviceCode}. Opening Microsoft sign-in...`
            : 'Device code ready.';
        }
        if (data.verificationUri) {
          window.open(data.verificationUri, '_blank', 'noopener,noreferrer');
        }
        if (data.sessionId) {
          this.pollGraphAuthStatus(data.sessionId);
        }
        alert(`Graph Authentication Instructions:\n\n${message}\n\nThe device code is also shown in Settings for easy copy/paste.`);
      } else {
        if (codeRow) {
          codeRow.style.display = 'none';
        }
        if (codeInput) {
          codeInput.value = '';
        }
        if (statusEl) {
          statusEl.textContent = `Authentication failed: ${data.error || 'Unknown error'}`;
        }
        alert(`Authentication failed: ${data.error}`);
      }
    } catch (error) {
      if (statusEl) {
        statusEl.textContent = `Error starting authentication: ${error.message}`;
      }
      alert(`Error starting authentication: ${error.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  escapeHtml(text) {
    const str = String(text);
    return str
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
}

function formatAiProviderLabel(item) {
  if (typeof AiProviderHelpers !== 'undefined' && AiProviderHelpers.formatAiProviderLabel) {
    return AiProviderHelpers.formatAiProviderLabel(item);
  }

  const aiPriority = String((item && item.aiPriority) || '').trim();
  const aiProviderUsed = String((item && item.aiProviderUsed) || '').trim();
  if (!aiPriority) {
    return 'Unavailable';
  }
  return aiProviderUsed ? `${aiPriority} (${aiProviderUsed})` : aiPriority;
}

function formatDraftProviderNotice(draft) {
  if (typeof AiProviderHelpers !== 'undefined' && AiProviderHelpers.formatDraftProviderNotice) {
    return AiProviderHelpers.formatDraftProviderNotice(draft);
  }

  const providerUsed = String((draft && draft.providerUsed) || '').trim() || 'unknown provider';
  return `Draft generated by ${providerUsed}.`;
}

function formatCategorySourceLabel(item) {
  if (typeof AiProviderHelpers !== 'undefined' && AiProviderHelpers.formatCategorySourceLabel) {
    return AiProviderHelpers.formatCategorySourceLabel(item);
  }

  const source = String((item && item.categorySource) || '').trim();
  if (source === 'ai') {
    return 'AI';
  }
  if (source === 'heuristic') {
    return 'Heuristic fallback';
  }
  return 'Unknown';
}

function calculateDraftEditorRows(text) {
  if (typeof DraftEditorHelpers !== 'undefined' && DraftEditorHelpers.calculateEditorRows) {
    return DraftEditorHelpers.calculateEditorRows(text);
  }

  const value = String(text || '');
  const lineCount = value ? value.split(/\r\n|\r|\n/).length : 1;
  return Math.min(24, Math.max(10, lineCount + 2));
}

// ── URL safety helper ──────────────────────────────────────────────────────
function isSafeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch { return false; }
}

function relativeTime(isoString) {
  const timestamp = Date.parse(isoString);
  if (!Number.isFinite(timestamp)) {
    return 'now';
  }

  const diffMs = Date.now() - timestamp;
  if (diffMs <= 0) {
    return 'now';
  }

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) {
    return `${Math.max(minutes, 1)}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Route helpers ──────────────────────────────────────────────────────────
function normalizeRoute(hash) {
  const route = String(hash || '').replace(/^#/, '');
  return ['email', 'logs', 'settings'].includes(route) ? route : 'email';
}

function resolveRoute(hash) {
  return normalizeRoute(hash);
}

function applyRoute(route) {
  document.body.dataset.route = route;
  document.querySelectorAll('[data-view]').forEach((node) => {
    const isVisible = node.dataset.view === route;
    node.hidden = !isVisible;
    // Initialize logs view when it becomes active
    if (isVisible && node.dataset.view === 'logs' && dashboard) {
      dashboard.renderLogs();
    }
    if (isVisible && node.dataset.view === 'settings' && dashboard) {
      dashboard.loadSettings();
    }
  });
  document.querySelectorAll('[data-route]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.route === route);
  });
}

function syncRouteHash(route) {
  const expectedHash = `#${route}`;
  if (window.location.hash !== expectedHash) {
    window.history.replaceState(null, '', expectedHash);
  }
}

function isCompactViewport() {
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(max-width: 1099px)').matches;
  }
  return window.innerWidth <= 1099;
}

function isMobileReaderViewport() {
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(max-width: 767px)').matches;
  }
  return window.innerWidth <= 767;
}

// setSidebarOpen / closeSidebarOnCompactViewport retained as stubs —
// the old 240px sidebar is replaced by the icon rail (no open/close state needed).
function setSidebarOpen(_isOpen) { /* no-op: icon rail has no open/close state */ }

function closeSidebarOnCompactViewport() { /* no-op: icon rail always visible */ }

function toggleFilterValue(currentValue, nextValue) {
  const next = nextValue || null;
  if (!next) {
    return null;
  }
  return currentValue === next ? null : next;
}

function applySearch(items, searchTerm) {
  const safeItems = Array.isArray(items) ? items : [];
  const query = String(searchTerm || '').trim().toLowerCase();
  if (!query) {
    return safeItems;
  }

  return safeItems.filter((item) => {
    const haystack = [
      item && item.subject,
      item && item.sender,
      item && item.preview,
      item && item.body,
    ].join(' ').toLowerCase();
    return haystack.includes(query);
  });
}

function applyCategoryFilter(items, category) {
  if (!category) {
    return items;
  }
  return items.filter((item) => String((item && item.primaryCategory) || '') === String(category));
}

function applyStateFilter(items, state) {
  if (!state) {
    return items;
  }
  return items.filter((item) => String((item && item.stateLabel) || '') === String(state));
}

function applyTagFilter(items, tag) {
  if (!tag) {
    return items;
  }

  return items.filter((item) => {
    const tags = Array.isArray(item && item.tags) ? item.tags : [];
    return tags.some((candidate) => String(candidate) === String(tag));
  });
}

function applyTagsFilter(items, tags) {
  if (!Array.isArray(tags) || tags.length === 0) {
    return items;
  }
  return items.filter((item) => {
    const itemTags = Array.isArray(item && item.tags) ? item.tags : [];
    return tags.some((t) => itemTags.includes(t));
  });
}

function applyEmailFilters(items, filters) {
  const safeFilters = filters || {};
  const searched = applySearch(items, safeFilters.search);
  const categoryFiltered = applyCategoryFilter(searched, safeFilters.category);
  const stateFiltered = applyStateFilter(categoryFiltered, safeFilters.state);
  const tagFiltered = applyTagFilter(stateFiltered, safeFilters.tag);
  return applyTagsFilter(tagFiltered, safeFilters.tags);
}

function resolveEmptyStateMessage({ triageError, filters }) {
  if (triageError) {
    return String(triageError);
  }

  const safeFilters = filters || {};
  if (safeFilters.search || safeFilters.category || safeFilters.state || safeFilters.tag) {
    return 'No messages match current filters';
  }
  return 'No emails found.';
}

function resolveSelectedEmailId(currentSelectedId, visibleItems) {
  const safeItems = Array.isArray(visibleItems) ? visibleItems : [];
  const visibleIds = safeItems
    .map((item) => String(item && item.id ? item.id : ''))
    .filter(Boolean);

  if (!visibleIds.length) {
    return null;
  }

  const currentId = currentSelectedId ? String(currentSelectedId) : null;
  if (!currentId) {
    return visibleIds[0];
  }

  return visibleIds.includes(currentId) ? currentId : visibleIds[0];
}

function buildReaderMetadata(item, options) {
  if (typeof EmailHelpers !== 'undefined' && EmailHelpers.getPrioritizedReaderMetadata) {
    return EmailHelpers.getPrioritizedReaderMetadata(item, options);
  }

  const maxEntries = Number((options && options.maxEntries) || 4);
  const entries = [
    { key: 'category', label: 'Category', value: String((item && item.primaryCategory) || 'FYI'), priority: 'high' },
    { key: 'recommendedAction', label: 'Recommended action', value: String((item && item.recommendedAction) || 'Review'), priority: 'high' },
    { key: 'urgency', label: 'Urgency', value: String((item && item.urgency) || ''), priority: 'low' },
    { key: 'source', label: 'Source', value: String((item && item.categorySource) || ''), priority: 'low' },
    { key: 'confidence', label: 'Confidence', value: String((item && item.scoreMeta && item.scoreMeta.confidenceText) || ''), priority: 'low' },
  ].filter((entry) => entry.value);

  entries.sort((a, b) => {
    if (a.priority === b.priority) {
      return 0;
    }
    return a.priority === 'high' ? -1 : 1;
  });

  return entries.slice(0, Math.max(maxEntries, 0));
}

function createReaderMetadataStrip(item, options) {
  const strip = document.createElement('div');
  strip.className = 'reader-meta-strip';
  strip.dataset.maxLines = String((options && options.maxLines) || 2);

  const metadata = buildReaderMetadata(item, options);
  metadata.forEach((entry) => {
    const chip = document.createElement('span');
    chip.className = entry.priority === 'high' ? 'meta-priority-high' : 'meta-priority-low';
    chip.dataset.key = entry.key;
    chip.textContent = `${entry.label}: ${entry.value}`;
    strip.appendChild(chip);
  });

  return strip;
}

function getVisibleMetadataKeys(item, options) {
  return buildReaderMetadata(item, options).map((entry) => entry.key);
}

// Initialize dashboard on page load
let dashboard = null;

document.addEventListener('DOMContentLoaded', () => {
  dashboard = new DashboardClient();
  dashboard.connect();

  // Periodically query events if not connected via WebSocket
  setInterval(() => {
    if (!dashboard.isConnected) {
      dashboard.fetchEventsRest();
    }
  }, 2000);

  // Setup clear button
  const clearBtn = document.getElementById('clearEventsBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to clear all events?')) {
        dashboard.clearEvents();
      }
    });
  }

  const triageBtn = document.getElementById('triageRefreshBtn');
  if (triageBtn) {
    triageBtn.addEventListener('click', () => {
      dashboard.refreshTriage();
    });
  }

  // ── Email filter handlers ──────────────────────────────────────────────────
  // Category and state pill click handlers are attached dynamically in updateFilterCounts().

  const emailSearch = document.getElementById('emailSearch');
  const emailSearchClear = document.getElementById('emailSearchClear');
  if (emailSearch) {
    emailSearch.addEventListener('input', (e) => {
      dashboard.emailFilters.search = e.target.value;
      if (emailSearchClear) {
        emailSearchClear.hidden = !e.target.value;
      }
      dashboard.renderTriage();
    });
  }
  if (emailSearchClear) {
    emailSearchClear.addEventListener('click', () => {
      if (emailSearch) {
        emailSearch.value = '';
      }
      dashboard.emailFilters.search = '';
      emailSearchClear.hidden = true;
      dashboard.renderTriage();
    });
  }

  // Settings panel toggle — removed (settings now live in dedicated view)

  // Settings save / discard
  const settingsSaveBtn = document.getElementById('settingsSave');
  if (settingsSaveBtn) {
    settingsSaveBtn.addEventListener('click', () => {
      dashboard.saveSettings();
    });
  }

  const settingsDiscardBtn = document.getElementById('settingsDiscard');
  if (settingsDiscardBtn) {
    settingsDiscardBtn.addEventListener('click', () => {
      dashboard.loadSettings();
    });
  }

  // Graph status popover toggle
  const graphStatusBtn = document.getElementById('graphStatusBtn');
  if (graphStatusBtn) {
    graphStatusBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dashboard.toggleGraphPopover();
    });
  }

  // Load current settings
  dashboard.loadSettings();

  // ── Logs filter handlers ──────────────────────────────────────────────────
  const logsSearchInput = document.getElementById('logsSearchInput');
  if (logsSearchInput) {
    logsSearchInput.addEventListener('input', (e) => {
      dashboard.logsFilterSearch = e.target.value;
      dashboard.handleLogsFilterChange();
    });
  }

  const logsTypeSelect = document.getElementById('logsTypeSelect');
  if (logsTypeSelect) {
    logsTypeSelect.addEventListener('change', (e) => {
      dashboard.logsFilterType = e.target.value;
      dashboard.handleLogsFilterChange();
    });
  }

  const logsWindowSelect = document.getElementById('logsWindowSelect');
  if (logsWindowSelect) {
    logsWindowSelect.addEventListener('change', (e) => {
      dashboard.logsFilterWindow = e.target.value;
      dashboard.handleLogsFilterChange();
    });
  }

  const logsClearFiltersBtn = document.getElementById('logsClearFiltersBtn');
  if (logsClearFiltersBtn) {
    logsClearFiltersBtn.addEventListener('click', () => {
      dashboard.logsFilterSearch = '';
      dashboard.logsFilterType = 'all';
      dashboard.logsFilterWindow = '15m';
      dashboard.logsExpandedRowId = null;
      if (logsSearchInput) logsSearchInput.value = '';
      if (logsTypeSelect) logsTypeSelect.value = 'all';
      if (logsWindowSelect) logsWindowSelect.value = '15m';
      dashboard.handleLogsFilterChange();
    });
  }

  const logsLiveToggle = document.getElementById('logsLiveToggle');
  if (logsLiveToggle) {
    logsLiveToggle.checked = dashboard.logsIsLive;
    logsLiveToggle.addEventListener('change', (e) => {
      dashboard.handleLogsLiveToggle(e.target.checked);
    });
  }

  const logsLivePausedBadge = document.getElementById('logsLivePausedBadge');
  if (logsLivePausedBadge) {
    logsLivePausedBadge.hidden = dashboard.logsIsLive;
  }

  // ── Route controller ──────────────────────────────────────────────────────
  document.querySelectorAll('[data-route]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextRoute = btn.dataset.route;
      if (!guardUnsavedSettingsNavigation(nextRoute)) {
        return;
      }
      window.location.hash = btn.dataset.route;
      closeSidebarOnCompactViewport();
    });
  });

  window.addEventListener('hashchange', () => {
    const currentRoute = document.body.dataset.route || 'email';
    const route = resolveRoute(window.location.hash);
    if (currentRoute === 'settings' && route !== 'settings' && !guardUnsavedSettingsNavigation(route)) {
      syncRouteHash(currentRoute);
      return;
    }
    applyRoute(route);
    dashboard.handleRouteChange(route);
    syncRouteHash(route);
    closeSidebarOnCompactViewport();
    if (typeof PortalState !== 'undefined') {
      PortalState.setActiveRoute(route);
    }
    if (route === 'email') {
      dashboard.refreshTriage();
    }
  });

  window.addEventListener('beforeunload', (event) => {
    if (!isSettingsDirty()) {
      return;
    }
    event.preventDefault();
    event.returnValue = '';
  });

  // Initial dispatch: apply route immediately, then normalise URL if needed
  const startRoute = resolveRoute(window.location.hash);
  applyRoute(startRoute);
  dashboard.handleRouteChange(startRoute);
  syncRouteHash(startRoute);
  if (typeof PortalState !== 'undefined') {
    PortalState.setActiveRoute(startRoute);
  }
  if (startRoute === 'email') {
    dashboard.refreshTriage();
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Category Badge Components (Task 8: Frontend Category Badge)
// ──────────────────────────────────────────────────────────────────────────

// Category colour scheme
const CATEGORY_COLOURS = {
  todo: '#e74c3c',
  fyi: '#3498db',
  to_follow_up: '#f39c12',
  notification: '#27ae60',
  marketing: '#95a5a6',
  null: '#bdc3c7',
};

const CATEGORY_DISPLAY_NAMES = {
  todo: 'Todo',
  fyi: 'FYI',
  to_follow_up: 'To Follow Up',
  notification: 'Notification',
  marketing: 'Marketing',
  null: 'Uncategorised',
};

function getCategoryColour(category) {
  return CATEGORY_COLOURS[category] || CATEGORY_COLOURS.null;
}

function getCategoryDisplayName(category) {
  return CATEGORY_DISPLAY_NAMES[category] || 'Unknown';
}

function renderCategoryBadge(item) {
  const span = document.createElement('span');
  
  span.className = 'category-badge';
  span.classList.add(`category-${item.category || 'null'}`);
  
  if (item.isLoading) {
    span.classList.add('loading');
  }

  // Build title attribute
  const titleParts = [item.category || 'uncategorised'];
  if (item.categorySource) titleParts.push(item.categorySource);
  if (item.categorizationConfidence !== null && item.categorizationConfidence !== undefined) {
    titleParts.push(`${Math.round(item.categorizationConfidence * 100)}%`);
  }
  span.setAttribute('title', titleParts.join(' · '));

  // Build content
  let content = getCategoryDisplayName(item.category);
  if (item.categorizationConfidence !== null && item.categorizationConfidence !== undefined) {
    content += ` ${Math.round(item.categorizationConfidence * 100)}%`;
  }
  if (item.isLoading) {
    content += ' …';
  }
  span.textContent = content;

  // Add skip-automation indicator
  if (item.skipAutomation) {
    const lockIcon = document.createElement('span');
    lockIcon.className = 'skip-automation';
    lockIcon.textContent = '🔒';
    lockIcon.setAttribute('title', 'Automation skipped for this email');
    span.appendChild(lockIcon);
  }

  // Apply colour via style
  span.style.backgroundColor = getCategoryColour(item.category);
  span.style.color = '#fff';
  span.style.padding = '2px 6px';
  span.style.borderRadius = '3px';
  span.style.fontSize = '12px';
  span.style.fontWeight = 'bold';
  span.style.display = 'inline-block';
  span.style.marginRight = '4px';

  span.style.opacity = item.isLoading ? '0.6' : '1';
  span.style.cursor = item.isLoading ? 'wait' : 'default';

  return span;
}

const settingsPanelState = {
  dirty: false,
  saving: false,
  currentSettings: null,
  api: null,
  container: null,
};

function isSettingsDirty() {
  return Boolean(settingsPanelState.dirty);
}

function setSettingsDirty(next) {
  settingsPanelState.dirty = Boolean(next);
  if (typeof PortalState !== 'undefined' && PortalState.setSettingsDirty) {
    PortalState.setSettingsDirty(settingsPanelState.dirty);
  }

  if (!settingsPanelState.container) {
    return;
  }

  const indicator = settingsPanelState.container.querySelector('[data-settings-dirty-indicator]');
  if (indicator) {
    indicator.hidden = !settingsPanelState.dirty;
  }
}

function markSettingsDirty() {
  setSettingsDirty(true);
}

function guardUnsavedSettingsNavigation(nextRoute, confirmFn) {
  if (!isSettingsDirty() || nextRoute === 'settings') {
    return true;
  }

  const askConfirm = typeof confirmFn === 'function' ? confirmFn : window.confirm;
  return askConfirm('You have unsaved changes. Leave settings and discard them?');
}

function collectCategorizationSettingsFromDom(container, currentSettings) {
  const settings = {
    topicLabelsGloballyEnabled: container.querySelector('#topicLabelsGloballyEnabled')?.checked || false,
    categories: {},
    topicLabels: Array.isArray(currentSettings?.topicLabels) ? currentSettings.topicLabels.slice() : [],
    customRules: Array.isArray(currentSettings?.customRules) ? currentSettings.customRules.slice() : [],
  };

  for (const cat of ['todo', 'fyi', 'to_follow_up', 'notification', 'marketing']) {
    settings.categories[cat] = {
      enabled: container.querySelector(`input[name="${cat}-enabled"]`)?.checked || false,
      targetFolderName: container.querySelector(`input[name="${cat}-targetFolderName"]`)?.value || '',
      outlookCategoryTag: container.querySelector(`input[name="${cat}-outlookCategoryTag"]`)?.value || '',
      topicLabelsEnabled: container.querySelector(`input[name="${cat}-topicLabels"]`)?.checked || false,
    };
  }

  return settings;
}

async function persistCategorizationSettings() {
  if (!settingsPanelState.api || !settingsPanelState.container || settingsPanelState.saving) {
    return;
  }

  const actionBtn = settingsPanelState.container.querySelector('[data-settings-save-button]');
  const statusEl = settingsPanelState.container.querySelector('[data-settings-save-status]');
  settingsPanelState.saving = true;
  if (actionBtn) {
    actionBtn.disabled = true;
  }
  if (statusEl) {
    statusEl.textContent = 'Saving...';
  }

  try {
    const nextSettings = collectCategorizationSettingsFromDom(settingsPanelState.container, settingsPanelState.currentSettings);
    await settingsPanelState.api.putSettings(nextSettings);
    settingsPanelState.currentSettings = nextSettings;
    setSettingsDirty(false);
    if (statusEl) {
      statusEl.textContent = 'Saved';
    }
  } catch (error) {
    if (statusEl) {
      statusEl.textContent = `Error: ${error.message}`;
    }
  } finally {
    settingsPanelState.saving = false;
    if (actionBtn) {
      actionBtn.disabled = false;
    }
  }
}

// Settings Panel Renderer
async function renderSettingsPanel(container, api, providedSettings) {
  try {
    const settings = providedSettings || await api.getSettings();
    settingsPanelState.currentSettings = settings;
    settingsPanelState.api = api;
    settingsPanelState.container = container;

    container.innerHTML = '';

    const tabBar = document.createElement('div');
    tabBar.className = 'settings-tabs';
    tabBar.innerHTML = `
      <button type="button" class="settings-tab-button is-active" data-settings-tab="general">General</button>
      <button type="button" class="settings-tab-button" data-settings-tab="categorization">Categorization</button>
    `;
    container.appendChild(tabBar);

    const categorizationPanel = document.createElement('section');
    categorizationPanel.className = 'categorization-panel settings-tab-panel';
    categorizationPanel.dataset.settingsTabPanel = 'categorization';

    const dirtyIndicator = document.createElement('p');
    dirtyIndicator.textContent = 'Unsaved changes';
    dirtyIndicator.className = 'settings-dirty-indicator';
    dirtyIndicator.dataset.settingsDirtyIndicator = 'true';
    dirtyIndicator.hidden = !isSettingsDirty();
    categorizationPanel.appendChild(dirtyIndicator);

    const actionRow = document.createElement('div');
    actionRow.className = 'settings-actions';
    actionRow.innerHTML = `
      <button type="button" class="btn btn-primary" data-settings-save-button>Update preferences</button>
      <span class="settings-save-status" data-settings-save-status></span>
    `;
    categorizationPanel.appendChild(actionRow);

    const categorizationTabs = document.createElement('div');
    categorizationTabs.className = 'categorization-tabs';
    categorizationTabs.innerHTML = `
      <button type="button" class="settings-tab-button" data-categorization-tab-trigger="general">General</button>
      <button type="button" class="settings-tab-button" data-categorization-tab-trigger="advanced">Advanced</button>
    `;
    categorizationPanel.appendChild(categorizationTabs);

    const generalPanel = document.createElement('div');
    generalPanel.className = 'categorization-tab-panel';
    generalPanel.dataset.categorizationTabPanel = 'general';

    const advancedPanel = document.createElement('div');
    advancedPanel.className = 'categorization-tab-panel';
    advancedPanel.dataset.categorizationTabPanel = 'advanced';
    advancedPanel.hidden = true;

    const globalSection = document.createElement('section');
    globalSection.className = 'global-settings';
    const globalToggle = document.createElement('input');
    globalToggle.type = 'checkbox';
    globalToggle.id = 'topicLabelsGloballyEnabled';
    globalToggle.checked = Boolean(settings.topicLabelsGloballyEnabled);
    globalToggle.addEventListener('change', markSettingsDirty);
    globalSection.appendChild(globalToggle);
    const label = document.createElement('label');
    label.htmlFor = 'topicLabelsGloballyEnabled';
    label.textContent = 'Enable Topic Labels Globally';
    globalSection.appendChild(label);
    categorizationPanel.appendChild(globalSection);

    const createCategorySection = (sectionKey, titleText, categories) => {
      const section = document.createElement('section');
      section.className = 'category-cards';
      section.dataset.categorizationSection = sectionKey;

      const title = document.createElement('h4');
      title.textContent = titleText;
      section.appendChild(title);

      const cardsContainer = document.createElement('div');
      cardsContainer.className = 'cards-container';
      if (sectionKey === 'move-out') {
        cardsContainer.id = 'category-cards';
      }

      categories.forEach((cat) => {
        const catSettings = settings.categories[cat] || {
          enabled: false,
          targetFolderName: '',
          outlookCategoryTag: '',
          topicLabelsEnabled: false,
        };

        const card = document.createElement('div');
        card.className = 'category-card';

        const enabled = Boolean(catSettings.enabled);
        card.innerHTML = `
          <h3>${cat}</h3>
          <label>
            <input type="checkbox" name="${cat}-enabled" ${enabled ? 'checked' : ''} />
            Enabled
          </label>
          <label data-secondary-control ${enabled ? '' : 'hidden'}>
            Folder:
            <input type="text" name="${cat}-targetFolderName" value="${catSettings.targetFolderName || ''}" />
          </label>
          <label data-secondary-control ${enabled ? '' : 'hidden'}>
            Outlook Tag:
            <input type="text" name="${cat}-outlookCategoryTag" value="${catSettings.outlookCategoryTag || ''}" />
          </label>
          <label data-secondary-control ${enabled ? '' : 'hidden'}>
            <input type="checkbox" name="${cat}-topicLabels" ${catSettings.topicLabelsEnabled ? 'checked' : ''} />
            Enable Topic Labels
          </label>
        `;

        card.querySelectorAll('input').forEach((input) => {
          input.addEventListener('change', markSettingsDirty);
        });

        const enabledToggle = card.querySelector(`input[name="${cat}-enabled"]`);
        if (enabledToggle) {
          enabledToggle.addEventListener('change', () => {
            const showSecondary = enabledToggle.checked;
            card.querySelectorAll('[data-secondary-control]').forEach((control) => {
              control.hidden = !showSecondary;
            });
          });
        }

        cardsContainer.appendChild(card);
      });

      section.appendChild(cardsContainer);
      return section;
    };

    const moveOutSection = createCategorySection('move-out', 'Move out', ['todo', 'notification']);
    generalPanel.appendChild(moveOutSection);

    const keepInSection = createCategorySection('keep-in', 'Keep in', ['fyi', 'to_follow_up']);
    generalPanel.appendChild(keepInSection);

    const existingCategoriesSection = createCategorySection('existing-categories', 'Existing categories', ['marketing']);
    generalPanel.appendChild(existingCategoriesSection);

    const labelsSection = document.createElement('section');
    labelsSection.className = 'topic-labels-section';
    labelsSection.dataset.categorizationSection = 'topic-labels';
    const labelsTitle = document.createElement('h4');
    labelsTitle.textContent = 'Topic Labels';
    labelsSection.appendChild(labelsTitle);
    const addLabelBtn = document.createElement('button');
    addLabelBtn.className = 'add-label-button';
    addLabelBtn.textContent = '+ Add Topic Label';
    labelsSection.appendChild(addLabelBtn);
    const labelsList = document.createElement('ul');
    labelsList.className = 'topic-labels-list';
    labelsList.id = 'topic-labels-list';

    for (const topicLabel of settings.topicLabels) {
      const li = document.createElement('li');
      li.className = 'label-item';
      li.dataset.labelId = String(topicLabel.id);
      li.innerHTML = `
        <span>${topicLabel.key} → ${topicLabel.mapsToCategory} (${topicLabel.patterns.join(', ')})</span>
        <div>
          <button type="button" class="btn btn-secondary" data-topic-label-move="up" data-id="${topicLabel.id}">↑</button>
          <button type="button" class="btn btn-secondary" data-topic-label-move="down" data-id="${topicLabel.id}">↓</button>
          <button class="delete-button" data-id="${topicLabel.id}">Delete</button>
        </div>
      `;
      li.querySelector('[data-topic-label-move="up"]').addEventListener('click', () => {
        const index = settings.topicLabels.findIndex((entry) => entry.id === topicLabel.id);
        if (index > 0) {
          const tmp = settings.topicLabels[index - 1];
          settings.topicLabels[index - 1] = settings.topicLabels[index];
          settings.topicLabels[index] = tmp;
          markSettingsDirty();
          renderSettingsPanel(container, api, settings);
        }
      });
      li.querySelector('[data-topic-label-move="down"]').addEventListener('click', () => {
        const index = settings.topicLabels.findIndex((entry) => entry.id === topicLabel.id);
        if (index >= 0 && index < settings.topicLabels.length - 1) {
          const tmp = settings.topicLabels[index + 1];
          settings.topicLabels[index + 1] = settings.topicLabels[index];
          settings.topicLabels[index] = tmp;
          markSettingsDirty();
          renderSettingsPanel(container, api, settings);
        }
      });
      li.querySelector('.delete-button').addEventListener('click', (e) => {
        e.preventDefault();
        settings.topicLabels = settings.topicLabels.filter((entry) => entry.id !== topicLabel.id);
        markSettingsDirty();
        renderSettingsPanel(container, api, settings);
      });
      labelsList.appendChild(li);
    }

    addLabelBtn.addEventListener('click', () => {
      const id = `label_${Date.now()}`;
      settings.topicLabels.push({ id, key: 'vip', mapsToCategory: 'todo', patterns: ['vip'], enabled: true });
      markSettingsDirty();
      renderSettingsPanel(container, api, settings);
    });

    labelsSection.appendChild(labelsList);
    generalPanel.appendChild(labelsSection);

    const rulesSection = document.createElement('section');
    rulesSection.className = 'custom-rules-section';
    const rulesTitle = document.createElement('h4');
    rulesTitle.textContent = 'Custom Rules';
    rulesSection.appendChild(rulesTitle);
    const addRuleBtn = document.createElement('button');
    addRuleBtn.className = 'add-rule-button';
    addRuleBtn.textContent = '+ Add Custom Rule';
    rulesSection.appendChild(addRuleBtn);
    const rulesList = document.createElement('div');
    rulesList.className = 'custom-rules-list';
    rulesList.id = 'custom-rules-list';

    for (const rule of settings.customRules) {
      const row = document.createElement('div');
      row.className = 'custom-rule-row';
      row.dataset.ruleId = String(rule.id);

      const enabledCol = document.createElement('div');
      enabledCol.dataset.column = 'enabled';
      enabledCol.innerHTML = `<input type="checkbox" ${rule.enabled ? 'checked' : ''}>`;

      const inputCol = document.createElement('div');
      inputCol.dataset.column = 'input';
      inputCol.innerHTML = `<input type="text" value="${rule.value || ''}">`;

      const categoryCol = document.createElement('div');
      categoryCol.dataset.column = 'category';
      categoryCol.innerHTML = `
        <select>
          <option value="todo" ${rule.action === 'todo' ? 'selected' : ''}>todo</option>
          <option value="fyi" ${rule.action === 'fyi' ? 'selected' : ''}>fyi</option>
          <option value="to_follow_up" ${rule.action === 'to_follow_up' ? 'selected' : ''}>to_follow_up</option>
          <option value="notification" ${rule.action === 'notification' ? 'selected' : ''}>notification</option>
          <option value="marketing" ${rule.action === 'marketing' ? 'selected' : ''}>marketing</option>
        </select>
      `;

      const actionCol = document.createElement('div');
      actionCol.dataset.column = 'action';
      actionCol.innerHTML = `
        <button type="button" class="btn btn-secondary" data-rule-move="up" data-id="${rule.id}">↑</button>
        <button type="button" class="btn btn-secondary" data-rule-move="down" data-id="${rule.id}">↓</button>
        <button type="button" class="delete-button" data-id="${rule.id}">Delete</button>
      `;

      enabledCol.querySelector('input').addEventListener('change', (e) => {
        rule.enabled = e.target.checked;
        markSettingsDirty();
      });
      inputCol.querySelector('input').addEventListener('input', (e) => {
        rule.value = e.target.value;
        markSettingsDirty();
      });
      categoryCol.querySelector('select').addEventListener('change', (e) => {
        rule.action = e.target.value;
        markSettingsDirty();
      });

      actionCol.querySelector('[data-rule-move="up"]').addEventListener('click', () => {
        const index = settings.customRules.findIndex((entry) => entry.id === rule.id);
        if (index > 0) {
          const tmp = settings.customRules[index - 1];
          settings.customRules[index - 1] = settings.customRules[index];
          settings.customRules[index] = tmp;
          markSettingsDirty();
          renderSettingsPanel(container, api, settings);
        }
      });
      actionCol.querySelector('[data-rule-move="down"]').addEventListener('click', () => {
        const index = settings.customRules.findIndex((entry) => entry.id === rule.id);
        if (index >= 0 && index < settings.customRules.length - 1) {
          const tmp = settings.customRules[index + 1];
          settings.customRules[index + 1] = settings.customRules[index];
          settings.customRules[index] = tmp;
          markSettingsDirty();
          renderSettingsPanel(container, api, settings);
        }
      });

      actionCol.querySelector('.delete-button').addEventListener('click', (e) => {
        e.preventDefault();
        settings.customRules = settings.customRules.filter((entry) => entry.id !== rule.id);
        markSettingsDirty();
        renderSettingsPanel(container, api, settings);
      });

      row.append(enabledCol, inputCol, categoryCol, actionCol);
      rulesList.appendChild(row);
    }

    addRuleBtn.addEventListener('click', () => {
      const id = `rule_${Date.now()}`;
      settings.customRules.push({ id, enabled: true, type: 'sender_email', value: 'new@example.com', action: 'todo' });
      markSettingsDirty();
      renderSettingsPanel(container, api, settings);
    });

    rulesSection.appendChild(rulesList);
    advancedPanel.appendChild(rulesSection);

    const marketingSection = document.createElement('section');
    marketingSection.className = 'marketing-strategy-section';
    marketingSection.innerHTML = `
      <h4>Marketing classification strategy</h4>
      <select id="marketingStrategyControl">
        <option value="default" ${(settings.marketingStrategy || 'default') === 'default' ? 'selected' : ''}>default</option>
        <option value="aggressive" ${settings.marketingStrategy === 'aggressive' ? 'selected' : ''}>aggressive</option>
        <option value="conservative" ${settings.marketingStrategy === 'conservative' ? 'selected' : ''}>conservative</option>
      </select>
    `;
    marketingSection.querySelector('#marketingStrategyControl').addEventListener('change', (e) => {
      settings.marketingStrategy = e.target.value;
      markSettingsDirty();
    });
    advancedPanel.appendChild(marketingSection);

    const identitiesSection = document.createElement('section');
    identitiesSection.className = 'alternative-identities-section';
    identitiesSection.innerHTML = '<h4>Alternative email identities</h4>';
    const identitiesList = document.createElement('div');
    identitiesList.className = 'alternative-identities-list';
    const identities = Array.isArray(settings.alternativeEmails) ? settings.alternativeEmails : [];
    identities.forEach((identity, index) => {
      const row = document.createElement('div');
      row.className = 'alternative-identity-row';
      row.innerHTML = `
        <input type="text" value="${identity}">
        <button type="button" class="delete-button" data-identity-index="${index}">Delete</button>
      `;
      row.querySelector('input').addEventListener('input', (e) => {
        settings.alternativeEmails[index] = e.target.value;
        markSettingsDirty();
      });
      row.querySelector('.delete-button').addEventListener('click', () => {
        settings.alternativeEmails.splice(index, 1);
        markSettingsDirty();
        renderSettingsPanel(container, api, settings);
      });
      identitiesList.appendChild(row);
    });
    const addIdentityBtn = document.createElement('button');
    addIdentityBtn.type = 'button';
    addIdentityBtn.className = 'add-identity-button';
    addIdentityBtn.textContent = '+ Add identity';
    addIdentityBtn.addEventListener('click', () => {
      settings.alternativeEmails = Array.isArray(settings.alternativeEmails) ? settings.alternativeEmails : [];
      settings.alternativeEmails.push('new-identity@example.com');
      markSettingsDirty();
      renderSettingsPanel(container, api, settings);
    });
    identitiesSection.appendChild(identitiesList);
    identitiesSection.appendChild(addIdentityBtn);
    advancedPanel.appendChild(identitiesSection);

    categorizationPanel.appendChild(generalPanel);
    categorizationPanel.appendChild(advancedPanel);

    const setActiveCategorizationTab = (tab) => {
      const normalized = tab === 'advanced' ? 'advanced' : 'general';
      generalPanel.hidden = normalized !== 'general';
      advancedPanel.hidden = normalized !== 'advanced';
      categorizationTabs.querySelectorAll('[data-categorization-tab-trigger]').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.categorizationTabTrigger === normalized);
      });
      if (typeof PortalState !== 'undefined' && PortalState.setCategorizationTab) {
        PortalState.setCategorizationTab(normalized);
      }
    };

    categorizationTabs.querySelectorAll('[data-categorization-tab-trigger]').forEach((btn) => {
      btn.addEventListener('click', () => setActiveCategorizationTab(btn.dataset.categorizationTabTrigger));
    });
    const initialCategorizationTab = (typeof PortalState !== 'undefined' && PortalState.getCategorizationTab)
      ? PortalState.getCategorizationTab()
      : 'general';
    setActiveCategorizationTab(initialCategorizationTab);

    container.appendChild(categorizationPanel);

    const saveButton = container.querySelector('[data-settings-save-button]');
    if (saveButton) {
      saveButton.addEventListener('click', () => {
        persistCategorizationSettings();
      });
    }

    if (!providedSettings) {
      setSettingsDirty(false);
    }
  } catch (error) {
    console.error('[renderSettingsPanel] Error:', error);
    container.innerHTML = `<p style="color: red;">Error loading settings: ${error.message}</p>`;
  }
}

async function updateSettings(api, container, currentSettings) {
  const settings = collectCategorizationSettingsFromDom(container, currentSettings);
  await api.putSettings(settings);
}

function handleSettingsUpdated(message) {
  if (message.key !== 'categorisation') {
    return;
  }
  if (isSettingsDirty()) {
    return;
  }

  const panel = document.getElementById('settings-panel');
  if (panel) {
    renderSettingsPanel(panel, {
      getSettings: () => Promise.resolve(message.settings),
      putSettings: (settings) => fetch('/api/settings/categorisation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      }).then(r => r.json())
    }, message.settings);
  }
}

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderCategoryBadge, getCategoryColour, getCategoryDisplayName, renderSettingsPanel, updateSettings, handleSettingsUpdated, toggleFilterValue, resolveSelectedEmailId, applyEmailFilters, resolveEmptyStateMessage, createReaderMetadataStrip, getVisibleMetadataKeys, guardUnsavedSettingsNavigation, isSettingsDirty, setSettingsDirty, setSidebarOpen, isMobileReaderViewport };
} else {
  window.renderCategoryBadge = renderCategoryBadge;
  window.getCategoryColour = getCategoryColour;
  window.getCategoryDisplayName = getCategoryDisplayName;
  window.renderSettingsPanel = renderSettingsPanel;
  window.handleSettingsUpdated = handleSettingsUpdated;
}
