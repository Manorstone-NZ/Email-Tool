const EmailTriage = require('../src/email-triage');

describe('EmailTriage', () => {
  let emailTriage, mockGraphAPI, mockActionService, mockSettings;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    mockGraphAPI = {
      getEmails: jest.fn().mockResolvedValue([
        {
          messageId: 'msg_1',
          emailId: 'id_1',
          threadId: 'thread_1',
          senderEmail: 'boss@example.com',
          subject: 'Urgent - Budget Approval',
          preview: 'Can you approve the Q2 budget?',
        },
        {
          messageId: 'msg_2',
          emailId: 'id_2',
          threadId: 'thread_2',
          senderEmail: 'newsletter@example.com',
          subject: 'Weekly Digest',
          preview: 'Here are this week\'s stories',
        }
      ]),
    };

    mockActionService = {
      applyActions: jest.fn().mockResolvedValue({
        category: 'todo',
        skipped: false,
        actionsApplied: [],
      }),
    };

    mockSettings = {
      getSettings: jest.fn().mockReturnValue({
        topicLabelsGloballyEnabled: true,
        categories: { todo: { enabled: true }, fyi: { enabled: true } },
        topicLabels: [],
        customRules: [],
      }),
    };

    jest.doMock('../src/email-categorizer', () => (email) => {
      if (email.subject && email.subject.toLowerCase().includes('urgent')) {
        return { category: 'todo', skipAutomation: false, source: 'heuristic', confidence: 0.8, reasons: [] };
      }
      return { category: 'fyi', skipAutomation: false, source: 'heuristic', confidence: 0.5, reasons: [] };
    });

    jest.doMock('../src/email-scorer', () => (email, decision) => {
      if (decision.category === 'todo') {
        return { urgency: 'high', score: 75, recommendedAction: 'Reply', reasons: [] };
      }
      return { urgency: 'low', score: 35, recommendedAction: 'Review Later', reasons: [] };
    });

    const folderCache = { 'Inbox': 'inbox_folder' };
    emailTriage = new EmailTriage(mockGraphAPI, mockActionService, mockSettings, folderCache);
  });

  test('run() returns TriageItems with all required fields', async () => {
    const result = await emailTriage.run();
    expect(result.length).toBeGreaterThan(0);
    const item = result[0];
    expect(item).toHaveProperty('id');
    expect(item).toHaveProperty('category');
    expect(item).toHaveProperty('urgency');
    expect(item).toHaveProperty('score');
    expect(item).toHaveProperty('reasons');
  });

  test('run() should filter out marketing by default', async () => {
    jest.resetModules();
    mockGraphAPI.getEmails.mockResolvedValueOnce([
      { messageId: 'msg_1', emailId: 'id_1', threadId: 'thread_1', senderEmail: 'x@y.com', subject: 'Test', preview: '' },
      { messageId: 'msg_2', emailId: 'id_2', threadId: 'thread_2', senderEmail: 'z@y.com', subject: 'Promo', preview: '' },
    ]);

    jest.doMock('../src/email-categorizer', () => (email) => {
      if (email.subject === 'Promo') {
        return { category: 'marketing', skipAutomation: false, source: 'heuristic', confidence: 0.5, reasons: [] };
      }
      return { category: 'fyi', skipAutomation: false, source: 'heuristic', confidence: 0.5, reasons: [] };
    });

    jest.doMock('../src/email-scorer', () => () => ({ urgency: 'low', score: 35, recommendedAction: 'Review Later', reasons: [] }));

    const EmailTriageReloaded = require('../src/email-triage');
    const triage = new EmailTriageReloaded(mockGraphAPI, mockActionService, mockSettings, {});
    const result = await triage.run();
    expect(result.some(item => item.category === 'marketing')).toBe(false);
  });

  test('run() should prioritise VIP senders', async () => {
    mockGraphAPI.getEmails.mockResolvedValueOnce([
      { messageId: 'msg_1', emailId: 'id_1', threadId: 'thread_1', senderEmail: 'regular@y.com', subject: 'Info', preview: '' },
      { messageId: 'msg_2', emailId: 'id_2', threadId: 'thread_2', senderEmail: 'vip@y.com', subject: 'VIP', preview: '' },
    ]);

    const result = await emailTriage.run(undefined, { vipEmails: ['vip@y.com'] });
    expect(result[0].sender).toBe('vip@y.com');
  });

  test('run() should filter items below minScore and report minScore in run meta', async () => {
    const result = await emailTriage.run(undefined, { minScore: 50 });

    expect(result).toHaveLength(1);
    expect(result[0].messageId).toBe('msg_1');
    expect(emailTriage.getLastRunMeta().minScore).toBe(50);
  });

  test('run() should handle null category', async () => {
    jest.resetModules();
    mockGraphAPI.getEmails.mockResolvedValueOnce([
      { messageId: 'msg_1', emailId: 'id_1', threadId: 'thread_1', senderEmail: 'test@y.com', subject: 'Test', preview: '' },
    ]);

    jest.doMock('../src/email-categorizer', () => () => ({ category: null, source: null, confidence: null, skipAutomation: false, reasons: [] }));
    jest.doMock('../src/email-scorer', () => () => ({ urgency: 'low', score: 35, recommendedAction: 'Review Later', reasons: [] }));

    const EmailTriageReloaded = require('../src/email-triage');
    const triage = new EmailTriageReloaded(mockGraphAPI, mockActionService, mockSettings, {});
    const result = await triage.run();
    expect(result[0].category).toBe(null);
    expect(result[0].urgency).toBe(null);
    expect(result[0].score).toBe(null);
  });

  test('run() should use getInboxEmails when getEmails is unavailable', async () => {
    const inboxOnlyApi = {
      getInboxEmails: jest.fn().mockResolvedValue([
        {
          messageId: 'msg_1',
          emailId: 'id_1',
          threadId: 'thread_1',
          senderEmail: 'boss@example.com',
          subject: 'Urgent - Budget Approval',
          preview: 'Can you approve the Q2 budget?',
        },
      ]),
    };

    const triage = new EmailTriage(inboxOnlyApi, mockActionService, mockSettings, {});
    const result = await triage.run();

    expect(inboxOnlyApi.getInboxEmails).toHaveBeenCalledTimes(1);
    expect(result.length).toBe(1);
  });

  test('run() should fail clearly when Graph token is missing/expired', async () => {
    const graphApi = {
      providerName: 'graph',
      getAccessToken: jest.fn().mockReturnValue(''),
      getInboxEmails: jest.fn(),
    };

    const triage = new EmailTriage(graphApi, mockActionService, mockSettings, {});
    const result = await triage.run();

    expect(result).toEqual([]);
    expect(graphApi.getInboxEmails).not.toHaveBeenCalled();
  });
});
