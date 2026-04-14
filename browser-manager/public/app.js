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
      const s = data.settings;
      this.fillSettingsForm(s);
      await this.loadArchiveFolderOptions(s.archiveFolderId || '');
    } catch (e) {
      console.error('Failed to load settings:', e);
    }

    const panel = document.getElementById('settings-panel');
    if (panel) {
      const api = {
        getSettings: () => fetch('/api/settings/categorisation').then(r => r.json()),
        putSettings: (settings) => fetch('/api/settings/categorisation', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(settings),
        }).then(r => r.json()),
      };
      await renderSettingsPanel(panel, api);
    }

    // Setup Graph Auth button after settings are loaded
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
    const modal = document.getElementById('draftEditorModal');
    const subjectInput = document.getElementById('draftEditorSubject');
    const bodyInput = document.getElementById('draftEditorBody');
    const providerNoticeEl = document.getElementById('draftEditorProviderNotice');
    const cancelBtn = document.getElementById('draftEditorCancel');
    const saveBtn = document.getElementById('draftEditorSave');

    if (!modal || !subjectInput || !bodyInput || !providerNoticeEl || !cancelBtn || !saveBtn) {
      const fallbackSubject = window.prompt(`Edit draft subject before approval:\n${providerNotice}`, String(subject || ''));
      if (fallbackSubject === null) {
        return null;
      }
      const fallbackBody = window.prompt(`Edit draft body before approval:\n${providerNotice}`, String(body || ''));
      if (fallbackBody === null) {
        return null;
      }
      return {
        subject: fallbackSubject,
        body: fallbackBody,
      };
    }

    providerNoticeEl.textContent = providerNotice;
    subjectInput.value = String(subject || '');
    bodyInput.value = String(body || '');
    bodyInput.rows = calculateDraftEditorRows(bodyInput.value);
    modal.hidden = false;

    return new Promise((resolve) => {
      const cleanup = () => {
        modal.hidden = true;
        cancelBtn.removeEventListener('click', onCancel);
        saveBtn.removeEventListener('click', onSave);
        modal.removeEventListener('click', onBackdropClick);
        document.removeEventListener('keydown', onKeyDown, true);
      };

      const onCancel = () => {
        cleanup();
        resolve(null);
      };

      const onSave = () => {
        cleanup();
        resolve({
          subject: subjectInput.value,
          body: bodyInput.value,
        });
      };

      const onBackdropClick = (event) => {
        if (event.target === modal) {
          onCancel();
        }
      };

      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
          return;
        }

        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          onSave();
        }
      };

      cancelBtn.addEventListener('click', onCancel);
      saveBtn.addEventListener('click', onSave);
      modal.addEventListener('click', onBackdropClick);
      document.addEventListener('keydown', onKeyDown, true);

      setTimeout(() => {
        bodyInput.focus();
        const cursor = bodyInput.value.length;
        bodyInput.setSelectionRange(cursor, cursor);
      }, 0);
    });
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

  fillSettingsForm(s) {
    const f = (id) => document.getElementById(id);
    const settings = s && typeof s === 'object' ? s : {};
    const knownKeys = new Set([
      'emailProvider',
      'graphClientId',
      'graphTenantId',
      'archiveFolderId',
      'emailSignature',
      'lookbackDays',
      'minScore',
      'vipSenders',
      'aiProviderPrimary',
      'aiProviderFallback',
      'anthropicApiKey',
      'openaiApiKey',
      'aiOpenAiModel',
      'aiDraftEnabled',
      'maxDraftLength',
    ]);
    if (f('setting-provider')) f('setting-provider').value = s.emailProvider || 'auto';
    if (f('setting-clientId')) f('setting-clientId').value = s.graphClientId || '';
    if (f('setting-tenantId')) f('setting-tenantId').value = s.graphTenantId || 'organizations';
    if (f('setting-archiveFolder')) f('setting-archiveFolder').value = s.archiveFolderId || '';
    if (f('setting-lookbackDays')) f('setting-lookbackDays').value = s.lookbackDays ?? 3;
    if (f('setting-minScore')) f('setting-minScore').value = s.minScore ?? 20;
    if (f('setting-aiPrimary')) f('setting-aiPrimary').value = s.aiProviderPrimary || 'claude-opus';
    if (f('setting-aiFallback')) f('setting-aiFallback').value = s.aiProviderFallback || 'gemma-lmstudio';
    if (f('setting-openaiApiKey')) f('setting-openaiApiKey').value = s.openaiApiKey || '';
    if (f('setting-aiOpenAiModel')) f('setting-aiOpenAiModel').value = s.aiOpenAiModel || 'gpt-5.4';
    if (f('setting-anthropicApiKey')) f('setting-anthropicApiKey').value = s.anthropicApiKey || '';
    if (f('setting-aiDraftEnabled')) f('setting-aiDraftEnabled').checked = s.aiDraftEnabled !== false;
    if (f('setting-maxDraftLength')) f('setting-maxDraftLength').value = s.maxDraftLength ?? 4000;
    if (f('setting-vipSenders')) {
      f('setting-vipSenders').value = Array.isArray(s.vipSenders) ? s.vipSenders.join(', ') : (s.vipSenders || '');
    }
    if (f('setting-emailSignature')) {
      f('setting-emailSignature').value = s.emailSignature || '';
    }
    const extraSettings = {};
    Object.keys(settings).forEach((key) => {
      if (!knownKeys.has(key)) {
        extraSettings[key] = settings[key];
      }
    });
    if (f('setting-extra')) {
      f('setting-extra').value = Object.keys(extraSettings).length ? JSON.stringify(extraSettings, null, 2) : '';
    }
  }

  async saveSettings(formData) {
    const statusEl = document.getElementById('settingsSaveStatus');
    const btn = document.querySelector('#settingsForm button[type="submit"]');
    if (btn) btn.disabled = true;
    if (statusEl) statusEl.textContent = 'Saving…';

    const vipRaw = formData.get('vipSenders') || '';
    try {
      const extraRaw = String(formData.get('extraSettingsJson') || '').trim();
      let extraSettings = {};
      if (extraRaw) {
        const parsed = JSON.parse(extraRaw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('Additional Settings must be a JSON object');
        }
        extraSettings = parsed;
      }

      const payload = {
        emailProvider: formData.get('emailProvider'),
        graphClientId: formData.get('graphClientId'),
        graphTenantId: formData.get('graphTenantId') || 'organizations',
        archiveFolderId: formData.get('archiveFolderId') || '',
        lookbackDays: Number(formData.get('lookbackDays')) || 3,
        minScore: Number(formData.get('minScore')) || 20,
        vipSenders: vipRaw.split(',').map((s) => s.trim()).filter(Boolean),
        emailSignature: formData.get('emailSignature') || '',
        aiProviderPrimary: formData.get('aiProviderPrimary') || 'claude-opus',
        aiProviderFallback: formData.get('aiProviderFallback') || 'gemma-lmstudio',
        openaiApiKey: formData.get('openaiApiKey') || '',
        aiOpenAiModel: formData.get('aiOpenAiModel') || 'gpt-4.1',
        anthropicApiKey: formData.get('anthropicApiKey') || '',
        aiDraftEnabled: formData.get('aiDraftEnabled') === 'on',
        maxDraftLength: Number(formData.get('maxDraftLength')) || 4000,
        extraSettings
      };

      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || `HTTP ${res.status}`);
      if (statusEl) {
        statusEl.textContent = 'Saved';
        statusEl.className = 'settings-save-status saved';
        setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'settings-save-status'; }, 2000);
      }
    } catch (e) {
      if (statusEl) {
        statusEl.textContent = `Error: ${e.message}`;
        statusEl.className = 'settings-save-status error';
      }
    } finally {
      if (btn) btn.disabled = false;
    }
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
      const placeholder = document.createElement('div');
      placeholder.className = 'reader-empty';
      placeholder.textContent = 'Select an email to view details.';
      readerPane.appendChild(placeholder);
      return;
    }

    if (isMobileReaderViewport()) {
      const backButton = document.createElement('button');
      backButton.type = 'button';
      backButton.className = 'mobile-reader-back';
      backButton.textContent = 'Back to inbox';
      backButton.addEventListener('click', () => {
        this.closeMobileReader();
      });
      readerPane.appendChild(backButton);
    }

    const subject = document.createElement('h3');
    subject.className = 'reader-subject';
    subject.textContent = String(item.subject || 'No subject');

    const metadata = createReaderMetadataStrip(item, { maxEntries: 4, maxLines: 2 });

    const body = document.createElement('div');
    body.className = 'reader-body';
    body.textContent = String(item.body || item.preview || 'No content available.');

    readerPane.append(subject, metadata, body);
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

  // Settings form
  const settingsForm = document.getElementById('settingsForm');
  if (settingsForm) {
    settingsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      dashboard.saveSettings(new FormData(settingsForm));
    });
  }

  // Load current settings into form
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
