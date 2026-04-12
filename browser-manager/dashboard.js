const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { loadSettings, saveSettings } = require('./src/settings-store');

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function buildSettingsUpdates(body) {
  const input = isPlainObject(body) ? body : {};
  const { emailProvider, graphClientId, graphTenantId, minScore, vipSenders, extraSettings } = input;
  const updates = {};

  if (emailProvider !== undefined) updates.emailProvider = String(emailProvider);
  if (graphClientId !== undefined) updates.graphClientId = String(graphClientId).trim();
  if (graphTenantId !== undefined) updates.graphTenantId = String(graphTenantId).trim() || 'organizations';
  if (minScore !== undefined) updates.minScore = Number(minScore);
  if (vipSenders !== undefined) {
    updates.vipSenders = Array.isArray(vipSenders)
      ? vipSenders
      : String(vipSenders).split(',').map((s) => s.trim()).filter(Boolean);
  }

  if (isPlainObject(extraSettings)) {
    Object.assign(updates, extraSettings);
  }

  return updates;
}

class DashboardServer {
  constructor(port = 4100) {
    this.port = port;
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocket.Server({ server: this.server });
    this.clients = new Set();
    this.eventLogger = null;
    this.manager = null;
  }

  setEventLogger(eventLogger) {
    this.eventLogger = eventLogger;
  }

  setManager(manager) {
    this.manager = manager;
  }

  setup() {
    // Disable caching so portal UI changes are reflected immediately.
    this.app.use((req, res, next) => {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      next();
    });

    // Serve static files
    this.app.use(express.static(path.join(__dirname, 'public')));
    this.app.use(express.json());

    // REST API endpoint for events
    this.app.get('/api/events', (req, res) => {
      if (!this.eventLogger) {
        return res.json({ events: [] });
      }
      const events = this.eventLogger.getEvents();
      res.json({ events });
    });

    this.app.post('/api/emails/triage', async (req, res) => {
      if (!this.manager || typeof this.manager.triageEmails !== 'function') {
        return res.status(503).json({ success: false, error: 'Email triage is unavailable' });
      }

      try {
        const results = await this.manager.triageEmails();
        const runMeta = this.manager.emailTriage.getLastRunMeta();
        const formatted = results.map((item) => ({
          sender: item.email.sender,
          subject: item.email.subject,
          body: item.email.body,
          openUrl: item.email.openUrl || '',
          score: item.score,
          confidence: `${item.score}%`,
          action: item.action,
          reason: item.reason
        }));

        this.broadcast({
          type: 'triage-result',
          data: formatted,
          meta: runMeta,
          timestamp: new Date().toISOString()
        });

        res.json({
          success: true,
          count: formatted.length,
          extractedCount: runMeta.totalExtracted,
          minScore: runMeta.minScore,
          items: formatted
        });
      } catch (error) {
        console.error('[Dashboard] Triage error:', error.message);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/emails/triage', (req, res) => {
      if (!this.manager || !this.manager.emailTriage) {
        return res.json({ success: true, count: 0, items: [] });
      }

      const lastResult = this.manager.emailTriage.getLastResult();
      const runMeta = this.manager.emailTriage.getLastRunMeta();
      const formatted = lastResult.map((item) => ({
        sender: item.email.sender,
        subject: item.email.subject,
        body: item.email.body,
        openUrl: item.email.openUrl || '',
        score: item.score,
        confidence: `${item.score}%`,
        action: item.action,
        reason: item.reason
      }));

      res.json({
        success: true,
        count: formatted.length,
        extractedCount: runMeta.totalExtracted,
        minScore: runMeta.minScore,
        items: formatted
      });
    });

    this.app.get('/api/settings', (req, res) => {
      res.json({ success: true, settings: loadSettings() });
    });

    this.app.post('/api/settings', (req, res) => {
      const updates = buildSettingsUpdates(req.body);

      try {
        const saved = saveSettings(updates);
        res.json({ success: true, settings: saved });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // WebSocket connection handler
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);

      if (this.eventLogger) {
        const events = this.eventLogger.getEvents();
        ws.send(JSON.stringify({
          type: 'events',
          events
        }));
      }

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          if (data.type === 'query-events' && this.eventLogger) {
            const events = this.eventLogger.getEvents();
            ws.send(JSON.stringify({
              type: 'events',
              events: events
            }));
          } else if (data.type === 'clear-events' && this.eventLogger) {
            this.eventLogger.clear();
          }
        } catch (e) {
          console.error('WebSocket message error:', e.message);
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error.message);
      });
    });
  }

  start() {
    this.setup();
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        console.log(`Dashboard server running on http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  broadcast(data) {
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
  }

  stop() {
    return new Promise((resolve) => {
      this.wss.clients.forEach((client) => {
        client.close();
      });
      this.server.close(() => {
        console.log('Dashboard server stopped');
        resolve();
      });
    });
  }
}

module.exports = DashboardServer;
module.exports.buildSettingsUpdates = buildSettingsUpdates;
