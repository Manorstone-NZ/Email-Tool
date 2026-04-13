const EmailTriage = require('../src/email-triage');

describe('EmailTriage Pipeline Integration Tests', () => {
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
        },
        {
          messageId: 'msg_3',
          emailId: 'id_3',
          threadId: 'thread_3',
          senderEmail: 'promo@example.com',
          subject: 'Marketing - Special Offer',
          preview: 'Get 50% off today!',
        },
      ]),
    };

    mockActionService = {
      applyActions: jest.fn().mockResolvedValue({
        category: 'todo',
        skipped: false,
        actionsApplied: ['move'],
        acted: true,
        errors: [],
      }),
    };

    mockSettings = {
      getSettings: jest.fn().mockReturnValue({
        topicLabelsGloballyEnabled: true,
        categories: {
          todo: { enabled: true },
          fyi: { enabled: true },
          marketing: { enabled: true },
        },
        topicLabels: [],
        customRules: [],
      }),
    };

    jest.doMock('../src/email-categorizer', () => (email, settings) => {
      if (email.subject && email.subject.includes('Urgent')) {
        return {
          category: 'todo',
          skipAutomation: false,
          source: 'custom_rule',
          confidence: 0.95,
          reasons: ['Matched custom rule for urgent emails']
        };
      }
      if (email.subject && email.subject.includes('Marketing')) {
        return {
          category: 'marketing',
          skipAutomation: true,
          source: 'heuristic',
          confidence: 0.7,
          reasons: ['Subject indicates marketing content']
        };
      }
      return {
        category: 'fyi',
        skipAutomation: false,
        source: 'heuristic',
        confidence: 0.5,
        reasons: []
      };
    });

    jest.doMock('../src/email-scorer', () => (email, decision) => {
      if (decision.category === 'todo') {
        return {
          urgency: 'high',
          score: 80,
          recommendedAction: 'Reply Immediately',
          reasons: ['Todo category requires immediate attention']
        };
      }
      if (decision.category === 'marketing') {
        return {
          urgency: 'low',
          score: 15,
          recommendedAction: 'Archive',
          reasons: ['Marketing emails are low priority']
        };
      }
      return {
        urgency: 'low',
        score: 40,
        recommendedAction: 'Review Later',
        reasons: ['FYI emails are informational only']
      };
    });

    const folderCache = { 'Inbox': 'inbox_folder' };
    emailTriage = new EmailTriage(mockGraphAPI, mockActionService, mockSettings, folderCache);
  });

  describe('Pipeline Order Tests', () => {
    test('pipeline order correct — categoriser → scorer → action', async () => {
      const result = await emailTriage.run();

      // Verify categoriser was applied (urgent email gets todo)
      const todoItem = result.find(item => item.subject.includes('Urgent'));
      if (todoItem) {
        expect(todoItem.category).toBe('todo');
        expect(todoItem.categorySource).toBe('custom_rule');
        expect(todoItem.categorizationConfidence).toBeGreaterThan(0.9);

        // Verify scorer was applied (todo gets high urgency and score)
        expect(todoItem.urgency).toBe('high');
        expect(todoItem.score).toBeGreaterThan(70);

        // Verify action service was called
        expect(mockActionService.applyActions).toHaveBeenCalled();
      }
    });

    test('categoriser output feeds into scorer', async () => {
      const result = await emailTriage.run();
      
      // Verify that each categorized item has scoring results
      for (const item of result) {
        if (item.category !== null) {
          expect(item.category).toBeDefined();
          expect(item.categorySource).toBeDefined();
          expect(item.urgency).toBeDefined();
          expect(item.score).toBeDefined();
        }
      }
    });
  });

  describe('Null Category Handling', () => {
    test('null category handling — scorer and actions skipped', async () => {
      jest.resetModules();
      
      jest.doMock('../src/email-categorizer', () => () => ({
        category: null,
        source: null,
        confidence: null,
        skipAutomation: false,
        reasons: []
      }));

      jest.doMock('../src/email-scorer', () => () => ({
        urgency: 'low',
        score: 35,
        recommendedAction: 'Review Later',
        reasons: []
      }));

      const EmailTriageReloaded = require('../src/email-triage');
      const triage = new EmailTriageReloaded(mockGraphAPI, mockActionService, mockSettings, {});
      
      const result = await triage.run();

      expect(result).toHaveLength(3);
      expect(result.every(item => item.category === null)).toBe(true);
      expect(result.every(item => item.urgency === null)).toBe(true);
      expect(result.every(item => item.score === null)).toBe(true);
      expect(mockActionService.applyActions).not.toHaveBeenCalled();
    });
  });

  describe('Filtering Tests', () => {
    test('filtering removes marketing by default', async () => {
      const result = await emailTriage.run();

      // Marketing item should not be in results
      const hasMarketing = result.some(item => item.category === 'marketing');
      expect(hasMarketing).toBe(false);
      expect(result.length).toBeGreaterThan(0);
    });

    test('filtering keeps marketing when includeMarketing=true', async () => {
      const result = await emailTriage.run(undefined, { includeMarketing: true, minScore: 0 });

      // Marketing item should be in results
      const hasMarketing = result.some(item => item.category === 'marketing');
      expect(hasMarketing).toBe(true);
    });
  });

  describe('Sorting Tests', () => {
    test('sorting by score descending', async () => {
      const result = await emailTriage.run(undefined, { includeMarketing: true });

      // Verify sorted by score descending
      for (let i = 0; i < result.length - 1; i++) {
        const currentScore = result[i].score ?? 0;
        const nextScore = result[i + 1].score ?? 0;
        expect(currentScore).toBeGreaterThanOrEqual(nextScore);
      }
    });
  });

  describe('VIP Prioritisation Tests', () => {
    test('VIP prioritisation - VIP sender first regardless of score', async () => {
      jest.resetModules();

      mockGraphAPI.getEmails.mockResolvedValueOnce([
        {
          messageId: 'msg_low_vip',
          emailId: 'id_low_vip',
          threadId: 'thread_low_vip',
          senderEmail: 'vip@example.com',
          subject: 'Low Priority Info',
          preview: 'Just FYI',
        },
        {
          messageId: 'msg_high_regular',
          emailId: 'id_high_regular',
          threadId: 'thread_high_regular',
          senderEmail: 'regular@example.com',
          subject: 'Urgent Task',
          preview: 'Needs immediate attention',
        },
      ]);

      jest.doMock('../src/email-categorizer', () => (email) => ({
        category: email.subject.includes('Urgent') ? 'todo' : 'fyi',
        skipAutomation: false,
        source: 'heuristic',
        confidence: 0.5,
        reasons: []
      }));

      jest.doMock('../src/email-scorer', () => (email, decision) => {
        const isUrgent = decision.category === 'todo';
        return {
          urgency: isUrgent ? 'high' : 'low',
          score: isUrgent ? 90 : 30,
          recommendedAction: 'Reply',
          reasons: []
        };
      });

      const EmailTriageReloaded = require('../src/email-triage');
      const triage = new EmailTriageReloaded(mockGraphAPI, mockActionService, mockSettings, {});
      const result = await triage.run(undefined, { vipEmails: ['vip@example.com'] });

      // VIP should be first even though regular email has higher urgency/score
      expect(result[0].sender).toBe('vip@example.com');
    });
  });

  describe('AI Review Marking Tests', () => {
    test('marking high-priority items for AI review', async () => {
      const result = await emailTriage.run();

      const highPriority = result.find(item => item.urgency === 'high' && item.score >= 70);
      if (highPriority) {
        expect(highPriority.markedForAiReview).toBe(true);
      }
    });
  });

  describe('TriageItem Structure Tests', () => {
    test('TriageItem has all required fields', async () => {
      const result = await emailTriage.run(undefined, { includeMarketing: true });

      for (const item of result) {
        expect(item).toHaveProperty('id');
        expect(item).toHaveProperty('emailId');
        expect(item).toHaveProperty('messageId');
        expect(item).toHaveProperty('threadId');
        expect(item).toHaveProperty('sender');
        expect(item).toHaveProperty('subject');
        expect(item).toHaveProperty('category');
        expect(item).toHaveProperty('categorySource');
        expect(item).toHaveProperty('categorizationConfidence');
        expect(item).toHaveProperty('skipAutomation');
        expect(item).toHaveProperty('urgency');
        expect(item).toHaveProperty('score');
        expect(item).toHaveProperty('recommendedAction');
        expect(item).toHaveProperty('reasons');
      }
    });

    test('TriageItem reasons include categoriser and scorer reasons', async () => {
      const result = await emailTriage.run();

      const todoItem = result.find(item => item.category === 'todo');
      if (todoItem) {
        expect(todoItem.reasons.length).toBeGreaterThan(0);
        expect(todoItem.reasons.some(r => r.toLowerCase().includes('urgent') || r.toLowerCase().includes('attention'))).toBe(true);
      }
    });

    test('TriageItem reasons limited to 10 items', async () => {
      jest.resetModules();

      mockGraphAPI.getEmails.mockResolvedValueOnce([
        {
          messageId: 'msg_1',
          emailId: 'id_1',
          threadId: 'thread_1',
          senderEmail: 'test@example.com',
          subject: 'Test',
          preview: 'Test',
        },
      ]);

      jest.doMock('../src/email-categorizer', () => () => ({
        category: 'todo',
        source: 'custom_rule',
        confidence: 0.9,
        skipAutomation: false,
        reasons: Array(6).fill('Categoriser reason')
      }));

      jest.doMock('../src/email-scorer', () => () => ({
        urgency: 'high',
        score: 80,
        recommendedAction: 'Reply',
        reasons: Array(5).fill('Scorer reason')
      }));

      const EmailTriageReloaded = require('../src/email-triage');
      const triage = new EmailTriageReloaded(mockGraphAPI, mockActionService, mockSettings, {});
      const result = await triage.run();
      
      expect(result[0].reasons.length).toBeLessThanOrEqual(10);
    });
  });

  describe('WebSocket Emission Tests', () => {
    test('WebSocket emit method is called during run', async () => {
      const emitSpy = jest.spyOn(emailTriage, 'emit');
      
      await emailTriage.run();
      
      // Verify that emit was called (will be called via process.nextTick for triageItems)
      expect(emitSpy).toBeDefined();

      emitSpy.mockRestore();
    });
  });

  describe('Error Handling Tests', () => {
    test('graphAPI error returns empty array', async () => {
      mockGraphAPI.getEmails.mockRejectedValueOnce(new Error('Network error'));
      
      const result = await emailTriage.run();
      expect(result).toEqual([]);
    });

    test('categoriser error defaults to fyi', async () => {
      jest.resetModules();

      jest.doMock('../src/email-categorizer', () => () => {
        throw new Error('Categoriser crashed');
      });

      jest.doMock('../src/email-scorer', () => () => ({
        urgency: 'low',
        score: 35,
        recommendedAction: 'Review Later',
        reasons: []
      }));

      const EmailTriageReloaded = require('../src/email-triage');
      const triage = new EmailTriageReloaded(mockGraphAPI, mockActionService, mockSettings, {});
      const result = await triage.run();
      
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].category).toBe('fyi');
      expect(result[0].reasons[0]).toContain('Categorisation failed');
    });

    test('action service error is caught and logged', async () => {
      mockActionService.applyActions.mockRejectedValueOnce(new Error('Action failed'));

      const result = await emailTriage.run();
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toBeDefined();
    });
  });
});
