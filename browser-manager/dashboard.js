const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');
const { loadSettings, saveSettings } = require('./src/settings-store');
const { requestDeviceCode, pollForToken } = require('./src/graph-device-auth');
const GraphTokenStore = require('./src/graph-token-store');
const { buildEmailId } = require('./src/email-id');

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function buildSettingsUpdates(body) {
  const input = isPlainObject(body) ? body : {};
  const {
    emailProvider,
    graphClientId,
    graphTenantId,
    archiveFolderId,
    emailSignature,
    lookbackDays,
    minScore,
    vipSenders,
    aiProviderPrimary,
    aiProviderFallback,
    anthropicApiKey,
    openaiApiKey,
    aiClaudeModel,
    aiOpenAiModel,
    aiGemmaModel,
    aiDraftEnabled,
    draftEligiblePriorities,
    maxDraftLength,
    graphSendEnabled,
    extraSettings
  } = input;
  const updates = {};

  if (emailProvider !== undefined) updates.emailProvider = String(emailProvider);
  if (graphClientId !== undefined) updates.graphClientId = String(graphClientId).trim();
  if (graphTenantId !== undefined) updates.graphTenantId = String(graphTenantId).trim() || 'organizations';
  if (archiveFolderId !== undefined) updates.archiveFolderId = String(archiveFolderId).trim();
  if (emailSignature !== undefined) updates.emailSignature = String(emailSignature).trim();
  if (lookbackDays !== undefined) updates.lookbackDays = Number(lookbackDays);
  if (minScore !== undefined) updates.minScore = Number(minScore);
  if (aiProviderPrimary !== undefined) updates.aiProviderPrimary = String(aiProviderPrimary).trim();
  if (aiProviderFallback !== undefined) updates.aiProviderFallback = String(aiProviderFallback).trim();
  if (anthropicApiKey !== undefined) updates.anthropicApiKey = String(anthropicApiKey).trim();
  if (openaiApiKey !== undefined) updates.openaiApiKey = String(openaiApiKey).trim();
  if (aiClaudeModel !== undefined) updates.aiClaudeModel = String(aiClaudeModel).trim();
  if (aiOpenAiModel !== undefined) updates.aiOpenAiModel = String(aiOpenAiModel).trim();
  if (aiGemmaModel !== undefined) updates.aiGemmaModel = String(aiGemmaModel).trim();
  if (aiDraftEnabled !== undefined) updates.aiDraftEnabled = Boolean(aiDraftEnabled);
  if (draftEligiblePriorities !== undefined) {
    updates.draftEligiblePriorities = Array.isArray(draftEligiblePriorities)
      ? draftEligiblePriorities.map((x) => String(x))
      : String(draftEligiblePriorities).split(',').map((x) => x.trim()).filter(Boolean);
  }
  if (maxDraftLength !== undefined) updates.maxDraftLength = Number(maxDraftLength);
  if (graphSendEnabled !== undefined) updates.graphSendEnabled = Boolean(graphSendEnabled);
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

function formatTriageItemForApi(item) {
  const email = item && item.email ? item.email : {};
  const emailId = buildEmailId(email);
  const reasons = Array.isArray(item && item.reasons)
    ? item.reasons.filter((reason) => typeof reason === 'string' && reason.trim() !== '')
    : [];
  const matchedSignals = [];

  if (item && item.matchedTopicLabel) {
    matchedSignals.push(`Topic label: ${item.matchedTopicLabel}`);
  }
  if (item && item.matchedRuleId) {
    matchedSignals.push(`Rule: ${item.matchedRuleId}`);
  }
  matchedSignals.push(...reasons);

  return {
    id: emailId,  // Add explicit id field for frontend use
    emailId,
    messageId: email.messageId || '',  // Include actual Graph message ID for API operations
    threadId: email.threadId || '',
    sender: email.sender,
    subject: email.subject,
    preview: email.preview || email.body || '',
    
    // Categorisation fields
    category: (item && item.category) || (item && item.primaryCategory) || (email.category) || null,
    categorySource: (item && item.categorySource) || null,
    categorizationConfidence: item && item.categorizationConfidence !== undefined ? item.categorizationConfidence : (item && item.aiConfidence !== undefined ? item.aiConfidence : null),
    skipAutomation: (item && item.skipAutomation) || false,
    matchedTopicLabel: (item && item.matchedTopicLabel) || null,
    matchedRuleId: (item && item.matchedRuleId) || null,
    
    // Scoring fields
    urgency: (item && item.urgency) || (item && item.aiPriority) || null,
    score: item && item.score,
    recommendedAction: (item && item.recommendedAction) || null,
    
    // Reasons/metadata
    reasons,
    matchedSignals,
    
    // Legacy fields for backward compatibility
    body: email.body,
    openUrl: email.openUrl || '',
    timestamp: email.timestamp || '',
    flagged: Boolean(email.flagged),
    read: Boolean(email.read),
    confidence: `${item && item.score}%`,
    action: item && item.action,
    reason: reasons[0] || (item && item.reason) || (item && item.aiReason) || null,
    aiPriority: (item && item.aiPriority) || null,
    aiReason: (item && item.aiReason) || null,
    aiDraftTone: (item && item.aiDraftTone) || null,
    aiConfidence: item && item.aiConfidence !== undefined ? item.aiConfidence : null,
    aiProviderUsed: (item && item.aiProviderUsed) || null,
    responseRecommended: Boolean(item && item.responseRecommended),
  };
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
    this.categorizationSettings = null;
    this.graphAuthSessions = new Map();
  }

  setEventLogger(eventLogger) {
    this.eventLogger = eventLogger;
  }

  setManager(manager) {
    this.manager = manager;
  }

  setCategorizationSettings(categorizationSettings) {
    this.categorizationSettings = categorizationSettings;
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

    if (this.categorizationSettings) {
      const dashboardRouter = new Dashboard({
        emailTriage: this.manager && this.manager.emailTriage,
        broadcast: (this.manager && this.manager.broadcast) || this.broadcast.bind(this),
        setCategorizationSettings: this.manager && this.manager.setCategorizationSettings
          ? this.manager.setCategorizationSettings.bind(this.manager)
          : undefined,
      }, this.categorizationSettings);
      this.app.use('/', dashboardRouter.router);
    }

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

        if (runMeta && runMeta.error) {
          return res.status(500).json({ success: false, error: runMeta.error });
        }

        const formatted = results.map(formatTriageItemForApi);

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
      const formatted = lastResult.map(formatTriageItemForApi);

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

    this.app.get('/api/graph/mail-folders', async (req, res) => {
      if (!this.manager || typeof this.manager.listMailFolders !== 'function') {
        return res.status(503).json({ success: false, error: 'Mail service unavailable' });
      }

      try {
        const folders = await this.manager.listMailFolders();
        res.json({ success: true, folders });
      } catch (error) {
        res.status(400).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/settings', (req, res) => {
      const updates = buildSettingsUpdates(req.body);

      try {
        const saved = saveSettings(updates);
        if (this.manager && typeof this.manager.applySettings === 'function') {
          this.manager.applySettings(saved);
        }
        res.json({ success: true, settings: saved });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/emails/drafts', (req, res) => {
      if (!this.manager || typeof this.manager.listDrafts !== 'function') {
        return res.json({ success: true, drafts: [] });
      }
      res.json({ success: true, drafts: this.manager.listDrafts() });
    });

    this.app.get('/api/emails/drafts/:emailId', (req, res) => {
      if (!this.manager || typeof this.manager.getDraft !== 'function') {
        return res.status(503).json({ success: false, error: 'Draft service unavailable' });
      }
      const draft = this.manager.getDraft(req.params.emailId);
      res.json({ success: true, draft: draft || null });
    });

    this.app.post('/api/emails/drafts/:emailId/generate', async (req, res) => {
      if (!this.manager || typeof this.manager.generateDraft !== 'function') {
        return res.status(503).json({ success: false, error: 'Draft service unavailable' });
      }
      try {
        const draft = await this.manager.generateDraft(req.params.emailId);
        res.json({ success: true, draft });
      } catch (error) {
        res.status(400).json({ success: false, error: error.message });
      }
    });

    this.app.patch('/api/emails/drafts/:emailId', (req, res) => {
      if (!this.manager || typeof this.manager.editDraft !== 'function') {
        return res.status(503).json({ success: false, error: 'Draft service unavailable' });
      }
      try {
        const draft = this.manager.editDraft(req.params.emailId, req.body || {});
        res.json({ success: true, draft });
      } catch (error) {
        res.status(400).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/emails/drafts/:emailId/approve', (req, res) => {
      if (!this.manager || typeof this.manager.approveDraft !== 'function') {
        return res.status(503).json({ success: false, error: 'Draft service unavailable' });
      }
      try {
        const draft = this.manager.approveDraft(req.params.emailId, req.body && req.body.approvedBy);
        res.json({ success: true, draft });
      } catch (error) {
        res.status(400).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/emails/drafts/:emailId/reject', (req, res) => {
      if (!this.manager || typeof this.manager.rejectDraft !== 'function') {
        return res.status(503).json({ success: false, error: 'Draft service unavailable' });
      }
      try {
        const draft = this.manager.rejectDraft(req.params.emailId, req.body && req.body.reason);
        res.json({ success: true, draft });
      } catch (error) {
        res.status(400).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/emails/drafts/:emailId/send', async (req, res) => {
      if (!this.manager || typeof this.manager.sendDraft !== 'function') {
        return res.status(503).json({ success: false, error: 'Send service unavailable' });
      }
      try {
        const draft = await this.manager.sendDraft(req.params.emailId);
        res.json({ success: true, draft });
      } catch (error) {
        res.status(400).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/emails/:emailId/delete', async (req, res) => {
      if (!this.manager || typeof this.manager.deleteEmail !== 'function') {
        return res.status(503).json({ success: false, error: 'Mail service unavailable' });
      }
      try {
        const result = await this.manager.deleteEmail(req.params.emailId);
        res.json({ success: true, result });
      } catch (error) {
        res.status(400).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/emails/:emailId/archive', async (req, res) => {
      if (!this.manager || typeof this.manager.archiveEmail !== 'function') {
        return res.status(503).json({ success: false, error: 'Mail service unavailable' });
      }
      try {
        const result = await this.manager.archiveEmail(req.params.emailId);
        res.json({ success: true, result });
      } catch (error) {
        res.status(400).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/emails/:emailId/mark-read', async (req, res) => {
      if (!this.manager || typeof this.manager.markEmailRead !== 'function') {
        return res.status(503).json({ success: false, error: 'Mail service unavailable' });
      }
      try {
        const isRead = req.body && req.body.isRead;
        const result = await this.manager.markEmailRead(req.params.emailId, isRead);
        res.json({ success: true, result });
      } catch (error) {
        res.status(400).json({ success: false, error: error.message });
      }
    });

    // Graph authentication endpoint
    this.app.post('/api/graph-auth/start', async (req, res) => {
      try {
        const settings = loadSettings();
        const input = req.body && typeof req.body === 'object' ? req.body : {};
        const tenantId = String(input.tenantId || settings.graphTenantId || 'organizations').trim() || 'organizations';
        const clientId = String(input.clientId || settings.graphClientId || '').trim();
        const scope = String(input.scope || process.env.GRAPH_SCOPE || 'offline_access openid profile User.Read Mail.ReadWrite').trim();

        if (!clientId) {
          return res.status(400).json({
            success: false,
            error: 'Missing Graph Client ID. Set it in Settings before starting authentication.'
          });
        }

        const devicePayload = await requestDeviceCode({ tenantId, clientId, scope });
        const instructions = devicePayload.message
          || `Open ${devicePayload.verification_uri} and enter code ${devicePayload.user_code}`;

        const sessionId = typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : String(Date.now());
        const session = {
          sessionId,
          status: 'pending',
          startedAt: new Date().toISOString(),
          tenantId,
          verificationUri: String(devicePayload.verification_uri || ''),
          userCode: String(devicePayload.user_code || ''),
          instructions,
          error: '',
        };
        this.graphAuthSessions.set(sessionId, session);

        // Continue token polling in background so the UI request returns immediately.
        void (async () => {
          try {
            session.status = 'authorizing';
            const tokenPayload = await pollForToken({
              tenantId,
              clientId,
              deviceCode: String(devicePayload.device_code || ''),
              interval: Number(devicePayload.interval || 5),
              expiresIn: Number(devicePayload.expires_in || 900),
            });
            const tokenStore = new GraphTokenStore();
            const persisted = tokenStore.saveToken(tokenPayload);
            session.status = 'completed';
            session.completedAt = new Date().toISOString();
            session.tokenExpiresAt = persisted && persisted.expires_at ? persisted.expires_at : 0;
            session.error = '';
          } catch (error) {
            session.status = 'failed';
            session.error = error && error.message ? error.message : 'Graph authorization failed';
            session.completedAt = new Date().toISOString();
          }
        })();

        res.json({
          success: true,
          sessionId,
          status: session.status,
          instructions,
          verificationUri: devicePayload.verification_uri || '',
          userCode: devicePayload.user_code || '',
          expiresIn: Number(devicePayload.expires_in || 0),
          interval: Number(devicePayload.interval || 0)
        });
      } catch (error) {
        res.status(400).json({ success: false, error: error.message || 'Graph auth failed' });
      }
    });

    this.app.get('/api/graph-auth/status/:sessionId', (req, res) => {
      const sessionId = String(req.params.sessionId || '').trim();
      const session = this.graphAuthSessions.get(sessionId);
      if (!session) {
        return res.status(404).json({ success: false, error: 'Authentication session not found' });
      }

      res.json({
        success: true,
        sessionId: session.sessionId,
        status: session.status,
        startedAt: session.startedAt,
        completedAt: session.completedAt || '',
        tokenExpiresAt: session.tokenExpiresAt || 0,
        error: session.error || '',
      });
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

/**
 * Dashboard Router - provides RESTful API endpoints
 * Can be used standalone in tests or embedded in DashboardServer
 */
class Dashboard {
  constructor(manager, categorizationSettings) {
    this.manager = manager;
    this.categorizationSettings = categorizationSettings;
    this.router = express.Router();
    this.setupRoutes();
  }

  setupRoutes() {
    // GET /api/settings/categorisation
    this.router.get('/api/settings/categorisation', (req, res) => {
      try {
        const settings = this.categorizationSettings?.getSettings?.();
        res.json(settings || {});
      } catch (error) {
        console.error('[Dashboard] GET settings error:', error);
        res.status(500).json({ error: 'Failed to fetch settings' });
      }
    });

    // PUT /api/settings/categorisation
    this.router.put('/api/settings/categorisation', (req, res) => {
      try {
        const { validateSettingsStrict } = require('./src/categorization-settings');
        
        const validated = validateSettingsStrict(req.body);
        
        // Update cache in settings object
        this.categorizationSettings?.updateCache?.(validated);
        
        // Notify triage instance
        this.manager?.emailTriage?.setCategorizationSettings?.(validated);

        if (this.manager?.setCategorizationSettings) {
          this.manager.setCategorizationSettings(validated);
        }
        
        // Broadcast to all connected clients
        this.manager?.broadcast?.({
          type: 'settings_updated',
          key: 'categorisation',
          settings: validated,
        });
        
        res.json({ success: true, settings: validated });
      } catch (error) {
        console.error('[Dashboard] PUT settings error:', error);
        res.status(400).json({ error: error.message });
      }
    });

    this.router.post('/api/emails/:emailId/pin', async (req, res) => {
      const emailId = req.params.emailId;
      const { pinned = true } = req.body || {};

      try {
        const result = await this.manager.setEmailPinned(emailId, Boolean(pinned));
        res.json({
          success: true,
          emailId,
          pinned: Boolean(pinned),
          action: result.action,
        });
      } catch (error) {
        console.error('Error updating email pin state:', error.message);
        res.status(500).json({ error: error.message });
      }
    });
  }
}

module.exports = DashboardServer;
module.exports.buildSettingsUpdates = buildSettingsUpdates;
module.exports.formatTriageItemForApi = formatTriageItemForApi;
module.exports.Dashboard = Dashboard;
