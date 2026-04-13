describe('manager AI provider wiring', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('wires categorisation dependencies into triage and propagates categorisation settings updates', () => {
    jest.doMock('../event-logger', () => jest.fn().mockImplementation(() => ({
      on: jest.fn(),
      logAutomationEvent: jest.fn(),
      logUserEvent: jest.fn(),
      getEvents: jest.fn(() => []),
    })));
    jest.doMock('../chrome-controller', () => jest.fn().mockImplementation(() => ({
      start: jest.fn(),
      stop: jest.fn(),
      getCurrentURL: jest.fn(() => ''),
    })));
    jest.doMock('../chrome-listener', () => jest.fn().mockImplementation(() => ({
      start: jest.fn(),
      stop: jest.fn(),
    })));
    jest.doMock('../dashboard', () => jest.fn().mockImplementation(() => ({
      setEventLogger: jest.fn(),
      setManager: jest.fn(),
      broadcast: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
    })));
    jest.doMock('../src/email-scorer', () => jest.fn().mockImplementation(() => ({ vipSenders: [] })));
    const EmailTriage = jest.fn().mockImplementation(function triageCtor(extractor, mailActionService, categorizationSettings) {
      this.extractor = extractor;
      this.mailActionService = mailActionService;
      this.categorizationSettings = categorizationSettings;
      this.setCategorizationSettings = jest.fn((next) => {
        this.categorizationSettings = next;
      });
      this.on = jest.fn();
      this.getLastRunMeta = jest.fn(() => ({}));
    });
    jest.doMock('../src/email-triage', () => EmailTriage);
    const extractor = { providerName: 'graph', getEmails: jest.fn() };
    jest.doMock('../src/email-extractor-factory', () => ({
      createExtractor: jest.fn(() => extractor),
    }));
    jest.doMock('../src/vip-config', () => ({
      loadVipSenders: jest.fn(() => ['ceo@']),
    }));
    jest.doMock('../src/send-service', () => jest.fn().mockImplementation(() => ({
      sendApprovedDraft: jest.fn(),
    })));
    jest.doMock('../src/mail-action-service', () => jest.fn().mockImplementation(() => ({
      applyActions: jest.fn(),
    })));
    jest.doMock('../src/settings-store', () => ({
      loadSettings: jest.fn(() => ({
        minScore: 10,
        vipSenders: ['ceo@'],
      })),
    }));
    const categorizationSettings = {
      getSettings: jest.fn(() => ({ categories: { todo: { enabled: true } } })),
      updateCache: jest.fn(),
    };
    jest.doMock('../src/categorization-settings', () => categorizationSettings);

    const PriorityService = jest.fn().mockImplementation(function priorityCtor() {});
    const DraftService = jest.fn().mockImplementation(function draftCtor() {});

    jest.doMock('../src/priority-service', () => ({ PriorityService }));
    jest.doMock('../src/draft-service', () => DraftService);

    const manager = require('../manager');

    expect(EmailTriage).toHaveBeenCalledWith(extractor, manager.mailActionService, categorizationSettings);

    const nextCategorizationSettings = { categories: { fyi: { enabled: true } } };
    manager.applySettings({ categorizationSettings: nextCategorizationSettings });

    expect(manager.emailTriage.setCategorizationSettings).toHaveBeenCalledWith(nextCategorizationSettings);
  });

  test('injects configured providers into services and refreshes them on applySettings', () => {
    jest.doMock('../event-logger', () => jest.fn().mockImplementation(() => ({
      on: jest.fn(),
      logAutomationEvent: jest.fn(),
      logUserEvent: jest.fn(),
      getEvents: jest.fn(() => []),
    })));
    jest.doMock('../chrome-controller', () => jest.fn().mockImplementation(() => ({
      start: jest.fn(),
      stop: jest.fn(),
      getCurrentURL: jest.fn(() => ''),
    })));
    jest.doMock('../chrome-listener', () => jest.fn().mockImplementation(() => ({
      start: jest.fn(),
      stop: jest.fn(),
    })));
    jest.doMock('../dashboard', () => jest.fn().mockImplementation(() => ({
      setEventLogger: jest.fn(),
      setManager: jest.fn(),
      broadcast: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
    })));
    jest.doMock('../src/email-scorer', () => jest.fn().mockImplementation(() => ({ vipSenders: [] })));
    jest.doMock('../src/email-triage', () => jest.fn().mockImplementation(function extractorMock(extractor, scorer, options) {
      this.extractor = extractor;
      this.scorer = scorer;
      this.priorityService = options.priorityService;
      this.minScore = options.minScore;
      this.lastRunMeta = {};
      this.on = jest.fn();
      this.getLastRunMeta = jest.fn(() => this.lastRunMeta);
    }));
    jest.doMock('../src/email-extractor-factory', () => ({
      createExtractor: jest.fn(() => ({ providerName: 'graph', getInboxEmails: jest.fn() })),
    }));
    jest.doMock('../src/vip-config', () => ({
      loadVipSenders: jest.fn(() => ['ceo@']),
    }));
    jest.doMock('../src/send-service', () => jest.fn().mockImplementation(() => ({
      sendApprovedDraft: jest.fn(),
    })));
    jest.doMock('../src/settings-store', () => ({
      loadSettings: jest.fn(() => ({
        minScore: 10,
        vipSenders: ['ceo@'],
        aiProviderPrimary: 'openai-gpt54',
        aiProviderFallback: 'claude-opus',
        openaiApiKey: 'sk-openai-initial',
        aiOpenAiModel: 'gpt-5.4',
        aiClaudeModel: 'claude-custom',
        aiGemmaModel: 'gemma-custom',
        maxDraftLength: 3000,
      })),
    }));

    const PriorityService = jest.fn().mockImplementation(function priorityCtor(options) {
      this.options = options;
    });
    const DraftService = jest.fn().mockImplementation(function draftCtor(options) {
      this.options = options;
    });

    jest.doMock('../src/priority-service', () => ({ PriorityService }));
    jest.doMock('../src/draft-service', () => DraftService);

    const manager = require('../manager');

    expect(manager.priorityService.options.primaryProvider.name).toBe('openai-gpt54');
    expect(manager.priorityService.options.primaryProvider.apiKey).toBe('sk-openai-initial');
    expect(manager.priorityService.options.fallbackProvider.name).toBe('claude-opus');
    expect(manager.draftService.options.primaryProvider.name).toBe('openai-gpt54');
    expect(manager.draftService.options.fallbackProvider.name).toBe('claude-opus');

    manager.applySettings({
      aiProviderPrimary: 'claude-opus',
      aiProviderFallback: 'openai-gpt54',
      openaiApiKey: 'sk-openai-next',
      aiOpenAiModel: 'gpt-5.4',
      aiClaudeModel: 'claude-next',
      aiGemmaModel: 'gemma-next',
      maxDraftLength: 4500,
    });

    expect(manager.priorityService.options.primaryProvider.name).toBe('claude-opus');
    expect(manager.priorityService.options.fallbackProvider.name).toBe('openai-gpt54');
    expect(manager.priorityService.options.fallbackProvider.apiKey).toBe('sk-openai-next');
    expect(manager.priorityService.options.primaryProvider.model).toBe('claude-next');
    expect(manager.draftService.options.fallbackProvider.model).toBe('gpt-5.4');
  });

  test('passes configured minScore into triage runs', async () => {
    jest.doMock('../event-logger', () => jest.fn().mockImplementation(() => ({
      on: jest.fn(),
      logAutomationEvent: jest.fn(),
      logUserEvent: jest.fn(),
      getEvents: jest.fn(() => []),
    })));
    jest.doMock('../chrome-controller', () => jest.fn().mockImplementation(() => ({
      start: jest.fn(),
      stop: jest.fn(),
      getCurrentURL: jest.fn(() => ''),
    })));
    jest.doMock('../chrome-listener', () => jest.fn().mockImplementation(() => ({
      start: jest.fn(),
      stop: jest.fn(),
    })));
    jest.doMock('../dashboard', () => jest.fn().mockImplementation(() => ({
      setEventLogger: jest.fn(),
      setManager: jest.fn(),
      setCategorizationSettings: jest.fn(),
      broadcast: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
    })));

    const triageRun = jest.fn().mockResolvedValue([]);
    jest.doMock('../src/email-triage', () => jest.fn().mockImplementation(function triageCtor() {
      this.run = triageRun;
      this.on = jest.fn();
      this.getLastRunMeta = jest.fn(() => ({ minScore: 5 }));
      this.getLastResult = jest.fn(() => []);
    }));
    jest.doMock('../src/email-extractor-factory', () => ({
      createExtractor: jest.fn(() => ({ providerName: 'graph', getInboxEmails: jest.fn() })),
    }));
    jest.doMock('../src/email-scorer', () => jest.fn().mockImplementation(() => ({ vipSenders: [] })));
    jest.doMock('../src/vip-config', () => ({ loadVipSenders: jest.fn(() => ['ceo@']) }));
    jest.doMock('../src/send-service', () => jest.fn().mockImplementation(() => ({ sendApprovedDraft: jest.fn() })));
    jest.doMock('../src/mail-action-service', () => jest.fn().mockImplementation(() => ({
      applyActions: jest.fn(),
      listMailFolders: jest.fn(),
    })));
    jest.doMock('../src/settings-store', () => ({
      loadSettings: jest.fn(() => ({ minScore: 5, vipSenders: ['ceo@'] })),
    }));

    const manager = require('../manager');

    await manager.triageEmails();

    expect(triageRun).toHaveBeenCalledWith(undefined, expect.objectContaining({ minScore: 5 }));
  });

  test('setEmailPinned uses cached graph messageId when available', async () => {
    jest.resetModules();

    jest.doMock('../event-logger', () => jest.fn().mockImplementation(() => ({
      on: jest.fn(),
      logAutomationEvent: jest.fn(),
      logUserEvent: jest.fn(),
      getEvents: jest.fn(() => []),
    })));
    jest.doMock('../chrome-controller', () => jest.fn().mockImplementation(() => ({
      start: jest.fn(),
      stop: jest.fn(),
      getCurrentURL: jest.fn(() => ''),
    })));
    jest.doMock('../chrome-listener', () => jest.fn().mockImplementation(() => ({
      start: jest.fn(),
      stop: jest.fn(),
    })));
    jest.doMock('../dashboard', () => jest.fn().mockImplementation(() => ({
      setEventLogger: jest.fn(),
      setManager: jest.fn(),
      broadcast: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
    })));

    jest.doMock('../src/email-triage', () => jest.fn().mockImplementation(function triageCtor() {
      this.run = jest.fn().mockResolvedValue([]);
      this.on = jest.fn();
      this.getLastRunMeta = jest.fn(() => ({}));
      this.getLastResult = jest.fn(() => []);
    }));
    jest.doMock('../src/email-extractor-factory', () => ({
      createExtractor: jest.fn(() => ({ providerName: 'graph', getInboxEmails: jest.fn() })),
    }));
    jest.doMock('../src/email-scorer', () => jest.fn().mockImplementation(() => ({ vipSenders: [] })));
    jest.doMock('../src/vip-config', () => ({ loadVipSenders: jest.fn(() => []) }));
    jest.doMock('../src/send-service', () => jest.fn().mockImplementation(() => ({ sendApprovedDraft: jest.fn() })));
    jest.doMock('../src/settings-store', () => ({
      loadSettings: jest.fn(() => ({ minScore: 5, vipSenders: [] })),
    }));

    const setPinned = jest.fn().mockResolvedValue({ success: true, action: 'pin', statusCode: 200, pinned: true });
    jest.doMock('../src/mail-action-service', () => jest.fn().mockImplementation(() => ({
      applyActions: jest.fn(),
      listMailFolders: jest.fn(),
      setPinned,
    })));

    const manager = require('../manager');
    manager.lastTriageById.set('local-123', { messageId: 'graph-abc' });

    await manager.setEmailPinned('local-123', true);

    expect(setPinned).toHaveBeenCalledWith('graph-abc', true);
  });
});