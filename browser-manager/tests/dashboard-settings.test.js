const { buildSettingsUpdates, formatTriageItemForApi } = require('../dashboard');

test('buildSettingsUpdates maps known settings fields', () => {
  const updates = buildSettingsUpdates({
    emailProvider: 'graph',
    graphClientId: ' client-id ',
    graphTenantId: '',
    archiveFolderId: ' AAMkAG123 ',
    anthropicApiKey: ' sk-ant-test ',
    openaiApiKey: ' sk-openai-test ',
    aiOpenAiModel: ' gpt-4.1 ',
    lookbackDays: '14',
    minScore: '35',
    vipSenders: 'ceo@, vp@'
  });

  expect(updates).toEqual({
    emailProvider: 'graph',
    graphClientId: 'client-id',
    graphTenantId: 'organizations',
    archiveFolderId: 'AAMkAG123',
    anthropicApiKey: 'sk-ant-test',
    openaiApiKey: 'sk-openai-test',
    aiOpenAiModel: 'gpt-4.1',
    lookbackDays: 14,
    minScore: 35,
    vipSenders: ['ceo@', 'vp@']
  });
});

test('buildSettingsUpdates merges custom extra settings keys', () => {
  const updates = buildSettingsUpdates({
    minScore: 40,
    lookbackDays: 21,
    extraSettings: {
      graphScopes: ['Mail.Read', 'User.Read'],
      graphAuthorityHost: 'https://login.microsoftonline.com',
      mailboxFolder: 'Inbox'
    }
  });

  expect(updates).toEqual({
    minScore: 40,
    lookbackDays: 21,
    graphScopes: ['Mail.Read', 'User.Read'],
    graphAuthorityHost: 'https://login.microsoftonline.com',
    mailboxFolder: 'Inbox'
  });
});

test('buildSettingsUpdates ignores invalid extra settings payloads', () => {
  const updates = buildSettingsUpdates({
    emailProvider: 'auto',
    extraSettings: 'not-an-object'
  });

  expect(updates).toEqual({ emailProvider: 'auto' });
});

test('formatTriageItemForApi keeps AI category fields for frontend filters', () => {
  const item = {
    email: {
      sender: 'ops@example.com',
      subject: 'Need decision today',
      body: 'Can you approve this today?',
      threadId: 'thread-1',
      openUrl: 'https://mail.example.com/thread-1',
      timestamp: '2026-04-12T00:00:00Z',
      flagged: true,
      read: false,
    },
    category: 'todo',
    categorySource: 'ai',
    score: 88,
    recommendedAction: 'Review / Respond',
    urgency: 'high',
    reason: 'Direct ask for approval',
    aiReason: 'Asks for a same-day decision',
    aiDraftTone: 'professional-direct',
    aiConfidence: 0.94,
    aiProviderUsed: 'openai-gpt41',
    responseRecommended: true,
  };

  const formatted = formatTriageItemForApi(item);

  // primaryCategory is NOT in the API response — it's derived frontend-side from category + recommendedAction
  expect(formatted.category).toBe('todo');
  expect(formatted.recommendedAction).toBe('Review / Respond');
  expect(formatted.categorySource).toBe('ai');
  expect(formatted.responseRecommended).toBe(true);
});

test('formatTriageItemForApi preserves combined reasons and exposes a display reason', () => {
  const item = {
    email: {
      sender: 'ops@example.com',
      subject: 'Monthly report',
      body: 'Attached are the monthly reports.',
      threadId: 'thread-2',
    },
    category: 'fyi',
    categorySource: 'custom_rule',
    score: 70,
    recommendedAction: 'Review Later',
    urgency: 'low',
    reasons: ['Matched custom rule: sender_domain=spark.co.nz', 'Scored 70/100 based on category "fyi" + source "custom_rule"'],
    matchedRuleId: 'rule_spark',
  };

  const formatted = formatTriageItemForApi(item);

  expect(formatted.reasons).toEqual(item.reasons);
  expect(formatted.reason).toBe('Matched custom rule: sender_domain=spark.co.nz');
  expect(formatted.matchedSignals).toContain('Rule: rule_spark');
});