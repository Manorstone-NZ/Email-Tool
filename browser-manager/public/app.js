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
    // Logs state (session-only, no persistence)
    this.logs = [];
    this.logsFilterSearch = '';
    this.logsFilterType = 'all';
    this.logsFilterWindow = '24h';
    this.logsIsLive = true;
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
              minScore: Number(data?.meta?.minScore || this.triageMeta.minScore || 35)
            };
          this.renderTriage();
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
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
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
        if (this.logsFilterSearch || this.logsFilterType !== 'all' || this.logsFilterWindow !== '24h') {
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
    if (f('setting-provider')) f('setting-provider').value = s.emailProvider || 'auto';
    if (f('setting-clientId')) f('setting-clientId').value = s.graphClientId || '';
    if (f('setting-tenantId')) f('setting-tenantId').value = s.graphTenantId || 'organizations';
    if (f('setting-minScore')) f('setting-minScore').value = s.minScore ?? 20;
    if (f('setting-vipSenders')) {
      f('setting-vipSenders').value = Array.isArray(s.vipSenders) ? s.vipSenders.join(', ') : (s.vipSenders || '');
    }
  }

  async saveSettings(formData) {
    const statusEl = document.getElementById('settingsSaveStatus');
    const btn = document.querySelector('#settingsForm button[type="submit"]');
    if (btn) btn.disabled = true;
    if (statusEl) statusEl.textContent = 'Saving…';

    const vipRaw = formData.get('vipSenders') || '';
    const payload = {
      emailProvider: formData.get('emailProvider'),
      graphClientId: formData.get('graphClientId'),
      graphTenantId: formData.get('graphTenantId') || 'organizations',
      minScore: Number(formData.get('minScore')) || 20,
      vipSenders: vipRaw.split(',').map((s) => s.trim()).filter(Boolean)
    };

    try {
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

    try {
      const response = await fetch('/api/emails/triage', { method: 'POST' });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      this.triageItems = data.items || [];
      this.triageMeta = {
        extractedCount: Number(data.extractedCount || 0),
        minScore: Number(data.minScore || this.triageMeta.minScore || 35)
      };
      this.renderTriage();
    } catch (error) {
      if (statusEl) {
        statusEl.textContent = `Triage failed: ${error.message}`;
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

    // Apply text search, category, state, tag filters
    const filtered = typeof EmailHelpers !== 'undefined' && EmailHelpers.filterEmailItems
      ? EmailHelpers.filterEmailItems(merged, this.emailFilters)
      : merged;

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
      'count-tag-approval': counts.tags.Approval || 0,
      'count-tag-vendor': counts.tags.Vendor || 0,
      'count-tag-urgent': counts.tags.Urgent || 0,
    };

    Object.entries(countMap).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = value > 0 ? `(${value})` : '';
      }
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

    listEl.innerHTML = '';

    if (!safeItems.length) {
      if (emptyStateEl) {
        // Determine which empty state to show
        if (this.emailFilters.search || this.emailFilters.category || this.emailFilters.state || this.emailFilters.tag) {
          emptyStateEl.textContent = 'No results match current filters.';
        } else {
          emptyStateEl.textContent = 'No emails found.';
        }
        emptyStateEl.hidden = false;
      }
      return;
    }

    if (emptyStateEl) {
      emptyStateEl.hidden = true;
    }

    safeItems.forEach((item) => {
      const itemId = String(item && item.id ? item.id : '');
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
      const reasonText = String((item && item.reason) || 'No explicit reason provided.');
      const matchedSignals = Array.isArray(item && item.matchedSignals)
        ? item.matchedSignals
        : (Array.isArray(item && item.signals) ? item.signals : []);

      const cardEl = document.createElement('div');
      cardEl.className = 'email-card';
      cardEl.dataset.id = itemId;
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

      actionsEl.append(openEl, pinEl, doneEl);

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

      const signalsEl = document.createElement('div');
      signalsEl.className = 'card-signals';
      const signalsLabelEl = document.createElement('strong');
      signalsLabelEl.textContent = 'Matched signals:';
      signalsEl.append(signalsLabelEl, document.createTextNode(` ${matchedSignals.length ? matchedSignals.join(', ') : 'None'}`));

      const rawEl = document.createElement('details');
      rawEl.className = 'card-raw';

      const rawSummaryEl = document.createElement('summary');
      rawSummaryEl.textContent = 'Raw metadata';

      const rawContentEl = document.createElement('pre');
      rawContentEl.className = 'card-raw-content';
      rawContentEl.textContent = JSON.stringify(item, null, 2);

      rawEl.append(rawSummaryEl, rawContentEl);
      expandedEl.append(bodyPreviewEl, reasonEl, signalsEl, rawEl);

      collapsedEl.addEventListener('click', () => {
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

      pinEl.addEventListener('click', (event) => {
        event.stopPropagation();

        if (typeof PortalState === 'undefined' || !PortalState.readEmailUiState || !PortalState.writeEmailUiState) {
          return;
        }

        const state = PortalState.readEmailUiState();
        const currentUiState = item && item.uiState ? item.uiState : {};
        const newPinnedValue = !Boolean(currentUiState.pinned);
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

function applyRoute(route) {
  document.querySelectorAll('[data-view]').forEach((node) => {
    const isVisible = node.dataset.view === route;
    node.hidden = !isVisible;
    // Initialize logs view when it becomes active
    if (isVisible && node.dataset.view === 'logs' && dashboard) {
      dashboard.renderLogs();
    }
  });
  document.querySelectorAll('[data-route]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.route === route);
  });
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

  document.querySelectorAll('[data-tag]').forEach((btn) => {
    btn.addEventListener('click', () => {
      dashboard.emailFilters.tag = btn.dataset.tag || null;
      dashboard.renderTriage();
    });
  });

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
      dashboard.logsFilterWindow = '24h';
      dashboard.logsExpandedRowId = null;
      if (logsSearchInput) logsSearchInput.value = '';
      if (logsTypeSelect) logsTypeSelect.value = 'all';
      if (logsWindowSelect) logsWindowSelect.value = '24h';
      dashboard.handleLogsFilterChange();
    });
  }

  const logsLiveToggle = document.getElementById('logsLiveToggle');
  if (logsLiveToggle) {
    logsLiveToggle.addEventListener('change', (e) => {
      dashboard.handleLogsLiveToggle(e.target.checked);
    });
  }

  // ── Route controller ──────────────────────────────────────────────────────
  document.querySelectorAll('[data-route]').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.location.hash = btn.dataset.route;
    });
  });

  window.addEventListener('hashchange', () => {
    applyRoute(normalizeRoute(window.location.hash));
  });

  // Initial dispatch: apply route immediately, then normalise URL if needed
  const startRoute = normalizeRoute(window.location.hash);
  applyRoute(startRoute);
  if (window.location.hash !== '#' + startRoute) {
    window.location.hash = startRoute;
  }
});
