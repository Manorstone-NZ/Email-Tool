const EventLogger = require('./event-logger');
const ChromeController = require('./chrome-controller');
const ChromeListener = require('./chrome-listener');
const DashboardServer = require('./dashboard');
const EmailScorer = require('./src/email-scorer');
const EmailTriage = require('./src/email-triage');
const { createExtractor } = require('./src/email-extractor-factory');
const { loadVipSenders } = require('./src/vip-config');
const { loadSettings } = require('./src/settings-store');

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
    this.runtimeEnv = buildRuntimeEnv(process.env, this.settings);
    this.dashboardPort = resolveDashboardPort();
    this.eventLogger = new EventLogger();
    this.chromeController = new ChromeController();
    this.chromeListener = new ChromeListener(this.chromeController, this.eventLogger);
    this.dashboardServer = new DashboardServer(this.dashboardPort);
    this.dashboardServer.setEventLogger(this.eventLogger);
    this.dashboardServer.setManager(this);
    this.emailExtractor = createExtractor(this.runtimeEnv);
    this.emailScorer = new EmailScorer({
      vipSenders: Array.isArray(this.settings.vipSenders) ? this.settings.vipSenders : loadVipSenders(this.runtimeEnv)
    });
    this.emailTriage = new EmailTriage(this.emailExtractor, this.emailScorer, {
      minScore: this.settings.minScore
    });
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
    return await this.emailTriage.run();
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

    this.emailTriage.scorer = this.emailScorer;
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
