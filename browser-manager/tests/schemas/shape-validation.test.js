const categorize = require('../../src/email-categorizer');
const score = require('../../src/email-scorer');
const MailActionService = require('../../src/mail-action-service');

describe('Shape Validation', () => {
  const emptySettings = () => ({
    topicLabelsGloballyEnabled: true,
    categories: {
      todo: { enabled: false, topicLabelsEnabled: true },
      fyi: { enabled: false, topicLabelsEnabled: true },
      to_follow_up: { enabled: false, topicLabelsEnabled: true },
      notification: { enabled: false, topicLabelsEnabled: true },
      marketing: { enabled: false, topicLabelsEnabled: true },
    },
    topicLabels: [],
    customRules: [],
  });

  describe('CategorizationDecision shape', () => {
    test('must include all required fields', () => {
      const email = { senderEmail: 'x@y.com', subject: 'test', preview: '', isReply: false, isNotification: false };
      const settings = emptySettings();

      const decision = categorize(email, settings);

      expect(decision).toHaveProperty('category');
      expect(decision).toHaveProperty('skipAutomation');
      expect(decision).toHaveProperty('source');
      expect(decision).toHaveProperty('confidence');
      expect(decision).toHaveProperty('reasons');
    });

    test('category must be canonical', () => {
      const email = { senderEmail: 'x@y.com', subject: 'test', preview: '', isReply: false, isNotification: false };
      const settings = emptySettings();

      const decision = categorize(email, settings);

      const validCategories = ['todo', 'fyi', 'to_follow_up', 'notification', 'marketing'];
      expect(validCategories).toContain(decision.category);
    });

    test('confidence must be between 0 and 1', () => {
      const email = { senderEmail: 'x@y.com', subject: 'test', preview: '', isReply: false, isNotification: false };
      const settings = emptySettings();

      const decision = categorize(email, settings);

      expect(decision.confidence).toBeGreaterThanOrEqual(0);
      expect(decision.confidence).toBeLessThanOrEqual(1);
    });

    test('reasons must be non-empty array', () => {
      const email = { senderEmail: 'x@y.com', subject: 'test', preview: '', isReply: false, isNotification: false };
      const settings = emptySettings();

      const decision = categorize(email, settings);

      expect(Array.isArray(decision.reasons)).toBe(true);
      expect(decision.reasons.length).toBeGreaterThan(0);
    });

    test('optional fields present only when applicable', () => {
      const email = { senderEmail: 'x@y.com', subject: 'test', preview: '', isReply: false, isNotification: false };
      const settings = emptySettings();
      settings.customRules = [{ id: 'r1', enabled: true, type: 'sender_email', value: 'x@y.com', action: 'todo' }];

      const decision = categorize(email, settings);

      if (decision.source === 'custom_rule') {
        expect(decision).toHaveProperty('matchedRuleId');
        expect(decision.matchedRuleId).toBeDefined();
      }
    });
  });

  describe('ScoringResult shape', () => {
    test('must include all required fields', () => {
      const email = { senderEmail: 'x@y.com', subject: 'test', categories: [] };
      const decision = { category: 'todo', skipAutomation: false, source: 'heuristic', confidence: 0.5, reasons: [] };

      const result = score(email, decision);

      expect(result).toHaveProperty('urgency');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('recommendedAction');
      expect(result).toHaveProperty('reasons');
    });

    test('urgency must be one of: low, medium, high', () => {
      const email = { senderEmail: 'x@y.com', subject: 'test', categories: [] };
      const decision = { category: 'todo', skipAutomation: false, source: 'heuristic', confidence: 0.5, reasons: [] };

      const result = score(email, decision);

      expect(['low', 'medium', 'high']).toContain(result.urgency);
    });

    test('score must be between 20 and 100', () => {
      const email = { senderEmail: 'x@y.com', subject: 'test', categories: [] };
      const decision = { category: 'todo', skipAutomation: false, source: 'heuristic', confidence: 0.5, reasons: [] };

      const result = score(email, decision);

      expect(result.score).toBeGreaterThanOrEqual(20);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    test('recommendedAction must be valid', () => {
      const email = { senderEmail: 'x@y.com', subject: 'test', categories: [] };
      const decision = { category: 'todo', skipAutomation: false, source: 'heuristic', confidence: 0.5, reasons: [] };

      const result = score(email, decision);

      const validActions = ['Review Later', 'Review / Respond', 'Approve / Decide', 'Review'];
      expect(validActions).toContain(result.recommendedAction);
    });

    test('reasons must be non-empty array', () => {
      const email = { senderEmail: 'x@y.com', subject: 'test', categories: [] };
      const decision = { category: 'todo', skipAutomation: false, source: 'heuristic', confidence: 0.5, reasons: ['Test reason'] };

      const result = score(email, decision);

      expect(Array.isArray(result.reasons)).toBe(true);
      expect(result.reasons.length).toBeGreaterThan(0);
    });
  });

  describe('ActionResult shape', () => {
    test('must include all required fields', async () => {
      const email = { messageId: 'msg_1', senderEmail: 'x@y.com', categories: [] };
      const decision = { category: 'todo', skipAutomation: false, source: 'heuristic', confidence: 0.5, reasons: [] };
      const settings = { categories: { todo: { enabled: true } } };

      const mockGraphAPI = { patch: jest.fn() };
      const service = new MailActionService(mockGraphAPI);
      const actionResult = await service.applyActions(email, decision, settings);

      expect(actionResult).toHaveProperty('category');
      expect(actionResult).toHaveProperty('skipped');
      expect(actionResult).toHaveProperty('actionsAttempted');
      expect(actionResult).toHaveProperty('actionsApplied');
      expect(actionResult).toHaveProperty('actionsSkipped');
      expect(actionResult).toHaveProperty('errors');
    });

    test('skipped result must include skipReason', async () => {
      const email = { messageId: 'msg_1', senderEmail: 'x@y.com', categories: [] };
      const decision = { category: 'todo', skipAutomation: true, source: 'heuristic', confidence: 0.5, reasons: [] };
      const settings = { categories: { todo: { enabled: true } } };

      const mockGraphAPI = { patch: jest.fn() };
      const service = new MailActionService(mockGraphAPI);
      const actionResult = await service.applyActions(email, decision, settings);

      expect(actionResult.skipped).toBe(true);
      expect(actionResult).toHaveProperty('skipReason');
      expect(['skip_automation', 'category_disabled', 'no_actions_configured']).toContain(actionResult.skipReason);
    });

    test('non-skipped result must have empty skipReason', async () => {
      const email = { messageId: 'msg_1', senderEmail: 'x@y.com', categories: [] };
      const decision = { category: 'todo', skipAutomation: false, source: 'heuristic', confidence: 0.5, reasons: [] };
      const settings = { categories: { todo: { enabled: true, targetFolderName: 'Todo' } } };

      const mockGraphAPI = { patch: jest.fn().mockResolvedValue({ id: 'msg_1' }) };
      const service = new MailActionService(mockGraphAPI);
      service.folderCache = { 'Todo': 'folder_123' };
      const actionResult = await service.applyActions(email, decision, settings);

      expect(actionResult.skipped).toBe(false);
      expect(actionResult.skipReason).toBeUndefined();
    });
  });
});
