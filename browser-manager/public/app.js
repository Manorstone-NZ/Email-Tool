class DashboardClient {
  constructor() {
    this.ws = null;
    this.events = [];
    this.triageItems = [];
    this.triageMeta = { extractedCount: 0, minScore: 35 };
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
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
          this.renderEvents();
          this.updateStats();
        } else if (data.type === 'event' && data.event) {
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
    const details = JSON.stringify(event.details || {});

    return `
      <div class="event-item ${event.type}">
        <div class="event-header">
          <span class="event-type ${event.type}">${event.type}</span>
          <span class="event-timestamp">${timestamp}</span>
        </div>
        <div class="event-action">${event.action || 'Unknown'}</div>
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
    const listEl = document.getElementById('triageList');
    const statusEl = document.getElementById('triageStatus');
    if (!listEl) return;

    if (!this.triageItems.length) {
      listEl.innerHTML = '';
      if (statusEl) {
        statusEl.textContent = `Scanned ${this.triageMeta.extractedCount} emails. No actionable emails above ${this.triageMeta.minScore}%.`;
      }
      return;
    }

    if (statusEl) {
      statusEl.textContent = `Scanned ${this.triageMeta.extractedCount} emails. Found ${this.triageItems.length} actionable (threshold ${this.triageMeta.minScore}%).`;
    }

    listEl.innerHTML = this.triageItems
      .map((item) => {
        const score = Number(item.score || 0);
        let scoreClass = 'low-confidence';
        if (score >= 70) {
          scoreClass = 'high-confidence';
        } else if (score >= 50) {
          scoreClass = 'medium-confidence';
        }

          const subject = this.escapeHtml(item.subject || 'No subject');
          const linkedSubject = item.openUrl
            ? `<a class="triage-link" target="_blank" rel="noopener noreferrer" href="${this.escapeHtml(item.openUrl)}">${subject}</a>`
            : subject;

          return `
          <div class="triage-item ${scoreClass}">
            <div class="triage-sender">${this.escapeHtml(item.sender || 'Unknown sender')}</div>
              <div class="triage-subject">${linkedSubject}</div>
            <div class="triage-meta">
              <span class="triage-confidence">${this.escapeHtml(item.confidence || `${score}%`)}</span>
              <span class="triage-action">${this.escapeHtml(item.action || 'Review')}</span>
            </div>
            <div class="triage-reason">${this.escapeHtml(item.reason || 'No explicit reason')}</div>
          </div>
        `;
      })
      .join('');
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

// ── Route helpers ──────────────────────────────────────────────────────────
function normalizeRoute(hash) {
  const route = String(hash || '').replace(/^#/, '');
  return ['email', 'logs', 'settings'].includes(route) ? route : 'email';
}

function applyRoute(route) {
  document.querySelectorAll('[data-view]').forEach((node) => {
    node.hidden = node.dataset.view !== route;
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
