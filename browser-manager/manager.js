const EventLogger = require('./event-logger');
const ChromeController = require('./chrome-controller');
const ChromeListener = require('./chrome-listener');
const DashboardServer = require('./dashboard');
const EmailScorer = require('./src/email-scorer');
const EmailTriage = require('./src/email-triage');
const { createExtractor } = require('./src/email-extractor-factory');
const { loadVipSenders } = require('./src/vip-config');
const { loadSettings } = require('./src/settings-store');
const categorizationSettings = require('./src/categorization-settings');
const { PriorityService } = require('./src/priority-service');
const DraftService = require('./src/draft-service');
const SendService = require('./src/send-service');
const MailActionService = require('./src/mail-action-service');
const { buildEmailId } = require('./src/email-id');
const { resolveAiProviders } = require('./src/ai-provider-factory');

function buildRuntimeEnv(baseEnv, settings) {
  const env = { ...baseEnv };
  const safe = settings && typeof settings === 'object' ? settings : {};

  if (safe.emailProvider && safe.emailProvider !== 'auto') {
    env.EMAIL_PROVIDER = String(safe.emailProvider);
  }

  if (safe.graphClientId) {
    env.GRAPH_CLIENT_ID = String(safe.graphClientId);
  }

  if (safe.graphTenantId) {
    env.GRAPH_TENANT_ID = String(safe.graphTenantId);
  }

  if (safe.lookbackDays !== undefined) {
    env.GRAPH_LOOKBACK_DAYS = String(safe.lookbackDays);
  }

  if (safe.aiProviderPrimary) {
    env.AI_PROVIDER_PRIMARY = String(safe.aiProviderPrimary);
  }
  if (safe.aiProviderFallback) {
    env.AI_PROVIDER_FALLBACK = String(safe.aiProviderFallback);
  }
  if (safe.anthropicApiKey) {
    env.ANTHROPIC_API_KEY = String(safe.anthropicApiKey);
  }
  if (safe.openaiApiKey) {
    env.OPENAI_API_KEY = String(safe.openaiApiKey);
  }
  if (safe.aiClaudeModel) {
    env.CLAUDE_MODEL = String(safe.aiClaudeModel);
  }
  if (safe.aiOpenAiModel) {
    env.OPENAI_MODEL = String(safe.aiOpenAiModel);
  }
  if (safe.aiGemmaModel) {
    env.LMSTUDIO_MODEL = String(safe.aiGemmaModel);
  }

  return env;
}

function resolveDashboardPort() {
  const rawPort = process.env.DASHBOARD_PORT;
  const parsed = Number(rawPort);
  const defaultPort = 4100;

  if (!rawPort) {
    return defaultPort;
  }

  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    console.warn(`Invalid DASHBOARD_PORT value "${rawPort}". Falling back to ${defaultPort}.`);
    return defaultPort;
  }

  // Keep the entire 3000 block free (3000-3999) as requested.
  if (parsed >= 3000 && parsed <= 3999) {
    console.warn(`DASHBOARD_PORT=${parsed} is in the 3000 range. Falling back to ${defaultPort}.`);
    return defaultPort;
  }

  return parsed;
}

class BrowserManager {
  constructor() {
    this.settings = loadSettings();
    this.categorizationSettings = categorizationSettings;
    this.categorizationSettings.loadSettings?.();
    this.runtimeEnv = buildRuntimeEnv(process.env, this.settings);
    this.dashboardPort = resolveDashboardPort();
    this.eventLogger = new EventLogger();
    this.chromeController = new ChromeController();
    this.chromeListener = new ChromeListener(this.chromeController, this.eventLogger);
    this.dashboardServer = new DashboardServer(this.dashboardPort);
    this.dashboardServer.setEventLogger(this.eventLogger);
    this.dashboardServer.setManager(this);
    this.dashboardServer.setCategorizationSettings?.(this.categorizationSettings);
    this.emailExtractor = createExtractor(this.runtimeEnv);
    this.emailScorer = new EmailScorer({
      vipSenders: Array.isArray(this.settings.vipSenders) ? this.settings.vipSenders : loadVipSenders(this.runtimeEnv)
    });
    this.refreshAiServices();
    this.sendService = new SendService({
      eventLogger: this.eventLogger,
      user: this.runtimeEnv.GRAPH_USER,
      baseUrl: this.runtimeEnv.GRAPH_BASE_URL,
    });
    this.mailActionService = new MailActionService({
      eventLogger: this.eventLogger,
      user: this.runtimeEnv.GRAPH_USER,
      baseUrl: this.runtimeEnv.GRAPH_BASE_URL,
    });
    this.emailTriage = new EmailTriage(this.emailExtractor, this.mailActionService, this.categorizationSettings);
    this.lastTriageById = new Map();
    this.isRunning = false;

    // Stream all newly logged events to connected dashboard clients.
    this.eventLogger.on('event', (event) => {
      this.dashboardServer.broadcast({ type: 'event', event });
    });

    this.eventLogger.on('cleared', () => {
      this.dashboardServer.broadcast({ type: 'events', events: [] });
    });

    // Wire triage events to event logger
    this.emailTriage.on('triage-complete', (result) => {
      this.eventLogger.logAutomationEvent('email-triage-complete', {
        totalExtracted: result.totalExtracted,
        actionableCount: result.actionableCount,
        topItems: result.topItems.map(item => ({
          sender: item.email.sender,
          subject: item.email.subject,
          score: item.score,
          action: item.action
        }))
      });
    });

    this.emailTriage.on('triage-error', (error) => {
      this.eventLogger.logAutomationEvent('email-triage-error', { error: error.error });
    });
  }

  refreshAiServices() {
    const providers = resolveAiProviders(this.settings);

    this.priorityService = new PriorityService({
      primaryProvider: providers.primaryProvider,
      fallbackProvider: providers.fallbackProvider,
      claudeModel: this.settings.aiClaudeModel,
      gemmaModel: this.settings.aiGemmaModel,
      eventLogger: this.eventLogger,
    });

    this.draftService = new DraftService({
      primaryProvider: providers.primaryProvider,
      fallbackProvider: providers.fallbackProvider,
      claudeModel: this.settings.aiClaudeModel,
      gemmaModel: this.settings.aiGemmaModel,
      maxDraftLength: this.settings.maxDraftLength,
      eventLogger: this.eventLogger,
    });
  }

  async start() {
    try {
      console.log('Starting Browser Manager...');

      // Start Chrome controller
      await this.chromeController.start();
      this.eventLogger.logAutomationEvent('chrome-started', {
        message: 'Chrome controller initialized'
      });
      console.log('✅ Chrome controller started');

      // Start Chrome listener
      this.chromeListener.start();
      this.eventLogger.logAutomationEvent('listener-started', {
        message: 'Chrome listener polling started'
      });
      console.log('✅ Chrome listener started');

      // Start dashboard server
      await this.dashboardServer.start();
      this.eventLogger.logAutomationEvent('dashboard-started', {
        message: 'Dashboard server initialized',
        port: this.dashboardPort
      });
      console.log('✅ Dashboard server started');

      this.isRunning = true;
      return {
        success: true,
        message: 'Browser Manager started successfully'
      };
    } catch (error) {
      console.error('Failed to start Browser Manager:', error.message);
      this.eventLogger.logAutomationEvent('startup-error', {
        error: error.message
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  async stop() {
    try {
      console.log('Stopping Browser Manager...');

      // Stop Chrome listener
      this.chromeListener.stop();
      this.eventLogger.logAutomationEvent('listener-stopped', {
        message: 'Chrome listener polling stopped'
      });
      console.log('✅ Chrome listener stopped');

      // Stop Chrome controller
      await this.chromeController.stop();
      this.eventLogger.logAutomationEvent('chrome-stopped', {
        message: 'Chrome controller stopped'
      });
      console.log('✅ Chrome controller stopped');

      // Stop dashboard server
      await this.dashboardServer.stop();
      this.eventLogger.logAutomationEvent('dashboard-stopped', {
        message: 'Dashboard server stopped'
      });
      console.log('✅ Dashboard server stopped');

      this.isRunning = false;
      return {
        success: true,
        message: 'Browser Manager stopped successfully'
      };
    } catch (error) {
      console.error('Failed to stop Browser Manager:', error.message);
      this.eventLogger.logAutomationEvent('shutdown-error', {
        error: error.message
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      events: this.eventLogger.getEvents(),
      chromeURL: this.chromeController.getCurrentURL()
    };
  }

  async triageEmails() {
    const minScore = Number(this.settings.minScore);
    const results = await this.emailTriage.run(undefined, {
      minScore: Number.isFinite(minScore) ? minScore : undefined,
      vipEmails: Array.isArray(this.emailScorer?.vipSenders) ? this.emailScorer.vipSenders : [],
    });
    this.lastTriageById.clear();
    results.forEach((result) => {
      const email = result && result.email;
      const id = buildEmailId(email || result);
      this.lastTriageById.set(id, email || result);
    });
    return results;
  }

  getEmailById(emailId) {
    return this.lastTriageById.get(String(emailId)) || null;
  }

  getDraft(emailId) {
    return this.draftService.getDraft(String(emailId));
  }

  listDrafts() {
    return this.draftService.listDrafts();
  }

  async generateDraft(emailId) {
    const email = this.getEmailById(emailId);
    if (!email) {
      throw new Error('Email not found in current triage result. Run triage first.');
    }

    const draft = await this.draftService.generateDraft(String(emailId), email, null);
    this.eventLogger.logAutomationEvent('email-draft-generated', {
      emailId: String(emailId),
      providerUsed: draft.providerUsed,
      version: draft.version,
    });
    return draft;
  }

  editDraft(emailId, updates) {
    const draft = this.draftService.editDraft(String(emailId), updates || {});
    this.eventLogger.logUserEvent('email-draft-edited', {
      emailId: String(emailId),
      version: draft.version,
    });
    return draft;
  }

  approveDraft(emailId, approvedBy) {
    const draft = this.draftService.approveDraft(String(emailId), approvedBy || 'user');
    this.eventLogger.logUserEvent('email-draft-approved', {
      emailId: String(emailId),
      approvedVersion: draft.approvedVersion,
      approvedBy: draft.approvedBy,
    });
    return draft;
  }

  rejectDraft(emailId, reason) {
    const draft = this.draftService.rejectDraft(String(emailId), reason || '');
    this.eventLogger.logUserEvent('email-draft-rejected', {
      emailId: String(emailId),
      reason: draft.rejectionReason || '',
    });
    return draft;
  }

  async sendDraft(emailId) {
    const id = String(emailId);
    const draft = this.getDraft(id);
    if (!draft) {
      throw new Error('Draft not found');
    }

    const email = this.getEmailById(id);
    if (!email) {
      throw new Error('Email not found in triage cache');
    }

    const result = await this.sendService.sendApprovedDraft(draft, email);
    const sentDraft = this.draftService.markSent(id);
    this.eventLogger.logUserEvent('email-draft-sent', {
      emailId: id,
      statusCode: result.statusCode,
      recipient: result.recipient,
    });
    return sentDraft;
  }

  async deleteEmail(emailId) {
    const id = String(emailId);
    const email = this.getEmailById(id);
    const graphMessageId = (email && email.messageId) ? email.messageId : id;

    const result = await this.mailActionService.deleteEmail(graphMessageId);
    this.eventLogger.logUserEvent('email-deleted', {
      emailId: id,
      graphMessageId,
      statusCode: result.statusCode,
    });
    return result;
  }

  async archiveEmail(emailId) {
    const id = String(emailId);
    const email = this.getEmailById(id);
    const graphMessageId = (email && email.messageId) ? email.messageId : id;

    const result = await this.mailActionService.archiveEmail(graphMessageId, {
      archiveFolderId: this.settings.archiveFolderId,
    });
    this.eventLogger.logUserEvent('email-archived', {
      emailId: id,
      graphMessageId,
      statusCode: result.statusCode,
    });
    return result;
  }

  async listMailFolders() {
    return this.mailActionService.listMailFolders();
  }

  async markEmailRead(emailId, isRead = true) {
    const id = String(emailId);
    const result = await this.mailActionService.markAsRead(id, isRead);
    this.eventLogger.logUserEvent('email-mark-read', {
      emailId: id,
      isRead,
      statusCode: result.statusCode,
    });
    return result;
  }

  async setEmailPinned(emailId, pinned = true) {
    const id = String(emailId);
    const email = this.getEmailById(id);
    const graphMessageId = (email && email.messageId) ? email.messageId : id;

    const result = await this.mailActionService.setPinned(graphMessageId, pinned);
    this.eventLogger.logUserEvent('email-pin-updated', {
      emailId: id,
      graphMessageId,
      pinned: Boolean(pinned),
      statusCode: result.statusCode,
    });
    return result;
  }

  applySettings(settings) {
    const next = settings && typeof settings === 'object' ? settings : {};
    this.settings = { ...this.settings, ...next };
    this.runtimeEnv = buildRuntimeEnv(process.env, this.settings);

    this.emailExtractor = createExtractor(this.runtimeEnv);
    this.emailTriage.extractor = this.emailExtractor;

    if (next.minScore !== undefined) {
      const parsedMin = Number(next.minScore);
      if (Number.isFinite(parsedMin)) {
        this.emailTriage.minScore = parsedMin;
        this.emailTriage.lastRunMeta = {
          ...this.emailTriage.getLastRunMeta(),
          minScore: parsedMin
        };
      }
    }

    if (Array.isArray(next.vipSenders)) {
      this.emailScorer.vipSenders = next.vipSenders
        .map((item) => String(item).toLowerCase())
        .filter(Boolean);
    }

    if (next.categorizationSettings && typeof next.categorizationSettings === 'object') {
      this.categorizationSettings.updateCache?.(next.categorizationSettings);
      this.emailTriage.setCategorizationSettings?.(next.categorizationSettings);
    }

    if (
      next.aiProviderPrimary !== undefined ||
      next.aiProviderFallback !== undefined ||
      next.anthropicApiKey !== undefined ||
      next.openaiApiKey !== undefined ||
      next.aiClaudeModel !== undefined ||
      next.aiOpenAiModel !== undefined ||
      next.aiGemmaModel !== undefined ||
      next.maxDraftLength !== undefined
    ) {
      this.refreshAiServices();
      this.emailTriage.priorityService = this.priorityService;
    }

    this.emailTriage.scorer = this.emailScorer;
  }

  setCategorizationSettings(settings) {
    const next = settings && typeof settings === 'object' ? settings : {};
    this.categorizationSettings.updateCache?.(next);
    this.emailTriage.setCategorizationSettings?.(next);
  }
}

// Singleton instance
const manager = new BrowserManager();

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT, shutting down gracefully...');
  const result = await manager.stop();
  if (result.success) {
    console.log('Browser Manager stopped successfully');
    process.exit(0);
  } else {
    console.error('Error stopping Browser Manager:', result.error);
    process.exit(1);
  }
});

// Main execution
if (require.main === module) {
  manager.start().then(result => {
    if (result.success) {
      console.log('\n🚀 Browser Manager is running!');
      console.log(`Dashboard: http://localhost:${manager.dashboardPort}`);
    } else {
      console.error('Failed to start:', result.error);
      process.exit(1);
    }
  });
}

module.exports = manager;
