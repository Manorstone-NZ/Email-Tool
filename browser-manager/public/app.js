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
      tag: null        // null means no tag filter, or one of 'Approval', 'Vendor', 'Urgent'
    };
    this.selectedEmailId = null;
    this.triageError = null;
    // Logs state (session-only, no persistence)
    this.logs = [];
    this.logsFilterSearch = '';
    this.logsFilterType = 'all';
    this.logsFilterWindow = '15m';
    this.logsIsLive = false;
    this.logsExpandedRowId = null;
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

    // Compute counts for left rail (after search, before active filter narrowing)
    this.updateRailCounts(merged);
    
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

  updateRailCounts(items) {
    if (typeof EmailHelpers === 'undefined' || !EmailHelpers.countEmailBuckets) {
      return;
    }

    const counts = EmailHelpers.countEmailBuckets(items, { search: this.emailFilters.search });
    const countMap = {
      'count-cat-needs-reply': counts.categories['Needs Reply'] || 0,
      'count-cat-waiting': counts.categories['Waiting on Others'] || 0,
      'count-cat-fyi': counts.categories.FYI || 0,
      'count-state-flagged': counts.states.Flagged || 0,
      'count-state-pinned': counts.states.Pinned || 0,
      'count-state-done': counts.states.Done || 0,
    };

    Object.entries(countMap).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = value > 0 ? `(${value})` : '';
      }
    });

    this.renderTagRail(counts.tags || {});
  }

  renderTagRail(tagCounts) {
    const tagList = document.getElementById('tagList');
    if (!tagList) {
      return;
    }

    const entries = Object.entries(tagCounts || {})
      .filter(([, count]) => Number(count) > 0)
      .sort((a, b) => {
        if (b[1] !== a[1]) {
          return b[1] - a[1];
        }
        return String(a[0]).localeCompare(String(b[0]));
      });

    tagList.innerHTML = '';

    const allLi = document.createElement('li');
    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'rail-filter';
    allBtn.dataset.tag = '';
    allBtn.textContent = 'All Tags';
    allLi.appendChild(allBtn);
    tagList.appendChild(allLi);

    entries.forEach(([tag, count]) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rail-filter';
      btn.dataset.tag = String(tag);
      btn.textContent = `${tag} (${count})`;
      li.appendChild(btn);
      tagList.appendChild(li);
    });
  }

  updateFilterActiveStates() {
    document.querySelectorAll('[data-category]').forEach((btn) => {
      btn.classList.toggle('is-active', (btn.dataset.category || null) === this.emailFilters.category);
    });

    document.querySelectorAll('[data-state]').forEach((btn) => {
      btn.classList.toggle('is-active', (btn.dataset.state || null) === this.emailFilters.state);
    });

    document.querySelectorAll('[data-tag]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.tag === this.emailFilters.tag);
    });
  }

  renderEmailCards(items) {
    const listEl = document.getElementById('triageList');
    const emptyStateEl = document.getElementById('emailEmptyState');
    if (!listEl) return;

    const safeItems = Array.isArray(items) ? items : [];
    this.selectedEmailId = resolveSelectedEmailId(this.selectedEmailId, safeItems);

    listEl.innerHTML = '';

    if (!safeItems.length) {
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

    safeItems.forEach((item) => {
      const itemId = String(item && item.id ? item.id : '');
      const isSelected = Boolean(itemId) && itemId === this.selectedEmailId;
      const sender = String((item && item.sender) || 'Unknown sender');
      const subject = String((item && item.subject) || 'No subject');
      const recommendedAction = String((item && item.recommendedAction) || 'Review');
      const preview = String((item && item.preview) || (item && item.body) || 'No preview available.');
      const category = String((item && item.primaryCategory) || 'FYI');
      const tags = Array.isArray(item && item.tags) ? item.tags : [];
      const visibleTags = tags.slice(0, 2);
      const overflowTagCount = Math.max(tags.length - visibleTags.length, 0);
      const scoreText = String((item && item.scoreMeta && item.scoreMeta.confidenceText) || item.confidence || `${Math.round(Number(item && item.score ? item.score : 0))}%`);
      const timestampMeta = typeof EmailHelpers !== 'undefined' && EmailHelpers.resolveDisplayTimestamp
        ? EmailHelpers.resolveDisplayTimestamp(item)
        : { value: item && item.timestamp ? item.timestamp : item && item.ingestedAt };
      const isoTimestamp = String((timestampMeta && timestampMeta.value) || '');
      const openUrl = item && item.openUrl;
      const safeOpenUrl = openUrl && isSafeUrl(openUrl) ? openUrl : '';
      const initial = sender.trim() ? sender.trim().charAt(0).toUpperCase() : '?';
      const reasonText = Array.isArray(item && item.reasons) && item.reasons.length
        ? item.reasons.join(' | ')
        : String((item && item.reason) || 'No explicit reason provided.');
      const matchedSignals = Array.isArray(item && item.matchedSignals)
        ? item.matchedSignals
        : (Array.isArray(item && item.signals) ? item.signals : []);

      const cardEl = document.createElement('div');
      cardEl.className = 'email-card';
      cardEl.dataset.id = itemId;
      cardEl.dataset.selected = isSelected ? 'true' : 'false';
      cardEl.dataset.expanded = 'false';

      const collapsedEl = document.createElement('div');
      collapsedEl.className = 'card-collapsed';

      const avatarEl = document.createElement('div');
      avatarEl.className = 'card-avatar';
      avatarEl.textContent = initial;

      const contentEl = document.createElement('div');
      contentEl.className = 'card-content';

      const subjectRowEl = document.createElement('div');
      subjectRowEl.className = 'card-subject-row';

      const subjectEl = document.createElement('span');
      subjectEl.className = 'card-subject';
      subjectEl.textContent = subject;

      const actionBadgeEl = document.createElement('span');
      actionBadgeEl.className = 'card-action-badge';
      actionBadgeEl.textContent = recommendedAction;

      subjectRowEl.append(subjectEl, actionBadgeEl);

      const metaRowEl = document.createElement('div');
      metaRowEl.className = 'card-meta-row';

      const senderEl = document.createElement('span');
      senderEl.className = 'card-sender';
      senderEl.textContent = sender;

      const timestampEl = document.createElement('span');
      timestampEl.className = 'card-timestamp';
      timestampEl.textContent = relativeTime(isoTimestamp);
      timestampEl.title = isoTimestamp;

      const confidenceEl = document.createElement('span');
      confidenceEl.className = 'card-confidence';
      confidenceEl.textContent = scoreText;

      metaRowEl.append(senderEl, timestampEl, confidenceEl);

      const previewEl = document.createElement('div');
      previewEl.className = 'card-preview';
      previewEl.textContent = preview;

      const pillsEl = document.createElement('div');
      pillsEl.className = 'card-pills';

      const categoryPillEl = document.createElement('span');
      categoryPillEl.className = 'pill category-pill';
      categoryPillEl.textContent = category;
      pillsEl.appendChild(categoryPillEl);

      visibleTags.forEach((tag) => {
        const tagPillEl = document.createElement('span');
        tagPillEl.className = 'pill tag-pill';
        tagPillEl.textContent = String(tag);
        pillsEl.appendChild(tagPillEl);
      });

      if (overflowTagCount > 0) {
        const overflowPillEl = document.createElement('span');
        overflowPillEl.className = 'pill tag-pill';
        overflowPillEl.textContent = `+${overflowTagCount} more`;
        pillsEl.appendChild(overflowPillEl);
      }

      contentEl.append(subjectRowEl, metaRowEl, previewEl, pillsEl);
      collapsedEl.append(avatarEl, contentEl);

      const actionsEl = document.createElement('div');
      actionsEl.className = 'card-actions';

      const openEl = document.createElement('a');
      openEl.className = 'btn-card-action';
      openEl.textContent = 'Open';
      openEl.target = '_blank';
      openEl.rel = 'noopener noreferrer';
      openEl.href = safeOpenUrl || '#';
      if (!safeOpenUrl) {
        openEl.classList.add('is-disabled');
        openEl.setAttribute('aria-disabled', 'true');
      }

      const pinEl = document.createElement('button');
      pinEl.type = 'button';
      pinEl.className = 'btn-card-action';
      pinEl.dataset.action = 'pin';
      pinEl.textContent = 'Pin';
      if (item && item.uiState && item.uiState.pinned) {
        pinEl.classList.add('is-active');
      }

      const doneEl = document.createElement('button');
      doneEl.type = 'button';
      doneEl.className = 'btn-card-action';
      doneEl.dataset.action = 'done';
      doneEl.textContent = 'Done';

      const draftEl = document.createElement('button');
      draftEl.type = 'button';
      draftEl.className = 'btn-card-action';
      draftEl.dataset.action = 'draft';
      draftEl.textContent = 'Draft Reply';

      const deleteEl = document.createElement('button');
      deleteEl.type = 'button';
      deleteEl.className = 'btn-card-action btn-card-action-danger';
      deleteEl.dataset.action = 'delete';
      deleteEl.textContent = '🗑 Delete';

      const archiveEl = document.createElement('button');
      archiveEl.type = 'button';
      archiveEl.className = 'btn-card-action';
      archiveEl.dataset.action = 'archive';
      archiveEl.textContent = '📦 Archive';

      actionsEl.append(openEl, pinEl, doneEl, draftEl, deleteEl, archiveEl);

      const expandedEl = document.createElement('div');
      expandedEl.className = 'card-expanded';
      expandedEl.hidden = true;

      const bodyPreviewEl = document.createElement('div');
      bodyPreviewEl.className = 'card-body-preview';
      bodyPreviewEl.textContent = String((item && item.body) || preview);

      const reasonEl = document.createElement('div');
      reasonEl.className = 'card-reason';
      const reasonLabelEl = document.createElement('strong');
      reasonLabelEl.textContent = 'Reason:';
      reasonEl.append(reasonLabelEl, document.createTextNode(` ${reasonText}`));

      const aiMetaEl = document.createElement('div');
      aiMetaEl.className = 'card-signals';
      const aiMetaLabelEl = document.createElement('strong');
      aiMetaLabelEl.textContent = 'AI:';
      const aiMetaText = formatAiProviderLabel(item);
      aiMetaEl.append(aiMetaLabelEl, document.createTextNode(` ${aiMetaText}`));

      const categorySourceEl = document.createElement('div');
      categorySourceEl.className = 'card-signals';
      const categorySourceLabelEl = document.createElement('strong');
      categorySourceLabelEl.textContent = 'Category Source:';
      const categorySourceText = formatCategorySourceLabel(item);
      categorySourceEl.append(categorySourceLabelEl, document.createTextNode(` ${categorySourceText}`));

      const signalsEl = document.createElement('div');
      signalsEl.className = 'card-signals';
      const signalsLabelEl = document.createElement('strong');
      signalsLabelEl.textContent = 'Matched signals:';
      signalsEl.append(signalsLabelEl, document.createTextNode(` ${matchedSignals.length ? matchedSignals.join(', ') : 'None'}`));

      const rawEl = document.createElement('details');
      rawEl.className = 'card-raw';

      const readerMetadataStrip = createReaderMetadataStrip(item, { maxEntries: 4, maxLines: 2 });

      const rawSummaryEl = document.createElement('summary');
      rawSummaryEl.textContent = 'Raw metadata';

      const rawContentEl = document.createElement('pre');
      rawContentEl.className = 'card-raw-content';
      rawContentEl.textContent = JSON.stringify(item, null, 2);

      rawEl.append(rawSummaryEl, rawContentEl);
  expandedEl.append(readerMetadataStrip, bodyPreviewEl, reasonEl, aiMetaEl, categorySourceEl, signalsEl, rawEl);

      collapsedEl.addEventListener('click', () => {
        if (itemId) {
          this.selectedEmailId = itemId;
          listEl.querySelectorAll('.email-card').forEach((node) => {
            node.dataset.selected = node.dataset.id === itemId ? 'true' : 'false';
          });
        }

        const isExpanded = cardEl.dataset.expanded === 'true';
        cardEl.dataset.expanded = isExpanded ? 'false' : 'true';
        expandedEl.hidden = isExpanded;
      });

      openEl.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!safeOpenUrl) {
          event.preventDefault();
        }
      });

      pinEl.addEventListener('click', async (event) => {
        event.stopPropagation();

        if (typeof PortalState === 'undefined' || !PortalState.readEmailUiState || !PortalState.writeEmailUiState) {
          return;
        }

        const currentUiState = item && item.uiState ? item.uiState : {};
        const newPinnedValue = !Boolean(currentUiState.pinned);

        try {
          const response = await fetch(`/api/emails/${encodeURIComponent(itemId)}/pin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pinned: Boolean(newPinnedValue) }),
          });
          const payload = await response.json();
          if (!payload.success) {
            throw new Error(payload.error || `HTTP ${response.status}`);
          }
        } catch (error) {
          alert(`Failed to update pin state in Outlook: ${error.message}`);
          return;
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
      });

      doneEl.addEventListener('click', (event) => {
        event.stopPropagation();

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
      });

      draftEl.addEventListener('click', async (event) => {
        event.stopPropagation();

        try {
          const generatedRes = await fetch(`/api/emails/drafts/${encodeURIComponent(itemId)}/generate`, {
            method: 'POST',
          });
          const generatedData = await generatedRes.json();
          if (!generatedData.success) {
            throw new Error(generatedData.error || `HTTP ${generatedRes.status}`);
          }

          const generatedDraft = generatedData.draft || {};
          const providerNotice = formatDraftProviderNotice(generatedDraft);
          const editedDraft = await this.openDraftEditorModal({
            subject: generatedDraft.subject,
            body: generatedDraft.body,
            providerNotice,
          });
          if (!editedDraft) {
            return;
          }

          const savedRes = await fetch(`/api/emails/drafts/${encodeURIComponent(itemId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              subject: editedDraft.subject,
              body: editedDraft.body,
            }),
          });
          const savedData = await savedRes.json();
          if (!savedData.success) {
            throw new Error(savedData.error || `HTTP ${savedRes.status}`);
          }

          if (!window.confirm(`${providerNotice}\nApprove this draft for sending?`)) {
            return;
          }

          const approvedRes = await fetch(`/api/emails/drafts/${encodeURIComponent(itemId)}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ approvedBy: 'user' }),
          });
          const approvedData = await approvedRes.json();
          if (!approvedData.success) {
            throw new Error(approvedData.error || `HTTP ${approvedRes.status}`);
          }

          if (!window.confirm(`${providerNotice}\nSend approved draft now?`)) {
            return;
          }

          const sendRes = await fetch(`/api/emails/drafts/${encodeURIComponent(itemId)}/send`, {
            method: 'POST',
          });
          const sendData = await sendRes.json();
          if (!sendData.success) {
            throw new Error(sendData.error || `HTTP ${sendRes.status}`);
          }

          alert('Draft sent successfully.');
        } catch (err) {
          alert(`Draft flow failed: ${err.message}`);
        }
      });

      deleteEl.addEventListener('click', async (event) => {
        event.stopPropagation();

        if (!confirm('Are you sure you want to delete this email?')) {
          return;
        }

        try {
          const res = await fetch(`/api/emails/${encodeURIComponent(itemId)}/delete`, {
            method: 'POST',
          });
          const data = await res.json();
          if (!data.success) {
            throw new Error(data.error || `HTTP ${res.status}`);
          }

          // Remove the email from the list
          cardEl.remove();
          if (document.getElementById('triageList').children.length === 0) {
            const emptyStateEl = document.getElementById('emailEmptyState');
            if (emptyStateEl) {
              emptyStateEl.textContent = 'No emails found.';
              emptyStateEl.hidden = false;
            }
          }
        } catch (err) {
          alert(`Failed to delete email: ${err.message}`);
        }
      });

      archiveEl.addEventListener('click', async (event) => {
        event.stopPropagation();

        try {
          const res = await fetch(`/api/emails/${encodeURIComponent(itemId)}/archive`, {
            method: 'POST',
          });
          const data = await res.json();
          if (!data.success) {
            throw new Error(data.error || `HTTP ${res.status}`);
          }

          // Archive the email by removing it from the list
          cardEl.remove();
          if (document.getElementById('triageList').children.length === 0) {
            const emptyStateEl = document.getElementById('emailEmptyState');
            if (emptyStateEl) {
              emptyStateEl.textContent = 'No emails found.';
              emptyStateEl.hidden = false;
            }
          }
        } catch (err) {
          alert(`Failed to archive email: ${err.message}`);
        }
      });

      cardEl.append(collapsedEl, actionsEl, expandedEl);
      listEl.appendChild(cardEl);
    });
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

function setSidebarOpen(isOpen) {
  document.body.classList.toggle('sidebar-open', Boolean(isOpen));
  const toggleBtn = document.getElementById('sidebarToggleBtn');
  if (toggleBtn) {
    toggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  }
}

function closeSidebarOnCompactViewport() {
  if (isCompactViewport()) {
    setSidebarOpen(false);
  }
}

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

function applyEmailFilters(items, filters) {
  const safeFilters = filters || {};
  const searched = applySearch(items, safeFilters.search);
  const categoryFiltered = applyCategoryFilter(searched, safeFilters.category);
  const stateFiltered = applyStateFilter(categoryFiltered, safeFilters.state);
  return applyTagFilter(stateFiltered, safeFilters.tag);
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

  const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
  if (sidebarToggleBtn) {
    sidebarToggleBtn.addEventListener('click', () => {
      const isOpen = document.body.classList.contains('sidebar-open');
      setSidebarOpen(!isOpen);
    });
  }

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
  document.querySelectorAll('[data-category]').forEach((btn) => {
    btn.addEventListener('click', () => {
      dashboard.emailFilters.category = btn.dataset.category || null;
      dashboard.renderTriage();
    });
  });

  document.querySelectorAll('[data-state]').forEach((btn) => {
    btn.addEventListener('click', () => {
      dashboard.emailFilters.state = btn.dataset.state || null;
      dashboard.renderTriage();
    });
  });

  const tagList = document.getElementById('tagList');
  if (tagList) {
    tagList.addEventListener('click', (event) => {
      const target = event.target.closest('[data-tag]');
      if (!target) {
        return;
      }
      dashboard.emailFilters.tag = toggleFilterValue(dashboard.emailFilters.tag, target.dataset.tag);
      dashboard.renderTriage();
    });
  }

  const emailSearch = document.getElementById('emailSearch');
  if (emailSearch) {
    emailSearch.addEventListener('input', (e) => {
      dashboard.emailFilters.search = e.target.value;
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
    syncRouteHash(route);
    closeSidebarOnCompactViewport();
    if (typeof PortalState !== 'undefined') {
      PortalState.setActiveRoute(route);
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
  syncRouteHash(startRoute);
  if (typeof PortalState !== 'undefined') {
    PortalState.setActiveRoute(startRoute);
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
    categorizationPanel.appendChild(moveOutSection);

    const keepInSection = createCategorySection('keep-in', 'Keep in', ['fyi', 'to_follow_up']);
    categorizationPanel.appendChild(keepInSection);

    const existingCategoriesSection = createCategorySection('existing-categories', 'Existing categories', ['marketing']);
    categorizationPanel.appendChild(existingCategoriesSection);

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
        <button class="delete-button" data-id="${topicLabel.id}">Delete</button>
      `;
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
      settings.topicLabels.push({ id, key: 'new-label', mapsToCategory: 'todo', patterns: ['example'], enabled: true });
      markSettingsDirty();
      renderSettingsPanel(container, api, settings);
    });

    labelsSection.appendChild(labelsList);
    categorizationPanel.appendChild(labelsSection);

    const rulesSection = document.createElement('section');
    rulesSection.className = 'custom-rules-section';
    const rulesTitle = document.createElement('h4');
    rulesTitle.textContent = 'Custom Rules';
    rulesSection.appendChild(rulesTitle);
    const addRuleBtn = document.createElement('button');
    addRuleBtn.className = 'add-rule-button';
    addRuleBtn.textContent = '+ Add Custom Rule';
    rulesSection.appendChild(addRuleBtn);
    const rulesList = document.createElement('ul');
    rulesList.className = 'custom-rules-list';
    rulesList.id = 'custom-rules-list';

    for (const rule of settings.customRules) {
      const li = document.createElement('li');
      li.className = 'rule-item';
      li.dataset.ruleId = String(rule.id);
      li.innerHTML = `
        <span>${rule.type}: ${rule.value} → ${rule.action}</span>
        <button class="delete-button" data-id="${rule.id}">Delete</button>
      `;
      li.querySelector('.delete-button').addEventListener('click', (e) => {
        e.preventDefault();
        settings.customRules = settings.customRules.filter((entry) => entry.id !== rule.id);
        markSettingsDirty();
        renderSettingsPanel(container, api, settings);
      });
      rulesList.appendChild(li);
    }

    addRuleBtn.addEventListener('click', () => {
      const id = `rule_${Date.now()}`;
      settings.customRules.push({ id, enabled: true, type: 'sender_email', value: 'new@example.com', action: 'todo' });
      markSettingsDirty();
      renderSettingsPanel(container, api, settings);
    });

    rulesSection.appendChild(rulesList);
    categorizationPanel.appendChild(rulesSection);

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
  module.exports = { renderCategoryBadge, getCategoryColour, getCategoryDisplayName, renderSettingsPanel, updateSettings, handleSettingsUpdated, toggleFilterValue, resolveSelectedEmailId, applyEmailFilters, resolveEmptyStateMessage, createReaderMetadataStrip, getVisibleMetadataKeys, guardUnsavedSettingsNavigation, isSettingsDirty, setSettingsDirty };
} else {
  window.renderCategoryBadge = renderCategoryBadge;
  window.getCategoryColour = getCategoryColour;
  window.getCategoryDisplayName = getCategoryDisplayName;
  window.renderSettingsPanel = renderSettingsPanel;
  window.handleSettingsUpdated = handleSettingsUpdated;
}
