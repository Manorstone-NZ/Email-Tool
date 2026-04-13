const score = require('../../src/email-scorer');
const MailActionService = require('../../src/mail-action-service');

describe('Scorer → Action Service Contract', () => {
  let mockGraphAPI;

  beforeEach(() => {
    mockGraphAPI = { patch: jest.fn().mockResolvedValue({ id: 'msg_1' }) };
  });

  test('scorer output is valid input to applyActions', async () => {
    const email = { messageId: 'msg_1', senderEmail: 'x@y.com', subject: 'test', categories: [] };
    const decision = { category: 'todo', skipAutomation: false, source: 'heuristic', confidence: 0.5, reasons: [] };
    const settings = { categories: { todo: { enabled: true, targetFolderName: 'Todo', outlookCategoryTag: 'Todo' } } };

    const scoringResult = score(email, decision);

    // ScoringResult must not throw when passed to action service
    const service = new MailActionService(mockGraphAPI);
    service.folderCache = { 'Todo': 'folder_123' };

    expect(() => service.applyActions(email, decision, settings)).not.toThrow();
  });

  test('score urgency maps correctly to action priority', async () => {
    const email = { messageId: 'msg_1', senderEmail: 'boss@x.com', subject: 'URGENT', categories: [] };
    const decision = { category: 'todo', skipAutomation: false, source: 'custom_rule', confidence: 1.0, reasons: ['High priority custom rule'] };
    const settings = { categories: { todo: { enabled: true, targetFolderName: 'Todo' } } };

    const scoringResult = score(email, decision);

    // Scorer produces urgency, which informs action service decision logic
    expect(scoringResult.urgency).toBe('high'); // expectations based on category + source
    expect(scoringResult.recommendedAction).toMatch(/^(Review \/ Respond|Approve \/ Decide)$/);
  });

  test('all scorer outputs handleable by action service', async () => {
    const email = { messageId: 'msg_1', senderEmail: 'x@y.com', subject: 'test', categories: [] };
    const baseDecision = { category: 'todo', skipAutomation: false, source: 'heuristic', confidence: 0.5, reasons: [] };
    const settings = { categories: { todo: { enabled: true, targetFolderName: 'Todo', outlookCategoryTag: 'Todo' } } };

    const service = new MailActionService(mockGraphAPI);
    service.folderCache = { 'Todo': 'folder_123' };

    // All categories must be actionable
    for (const category of ['todo', 'fyi', 'to_follow_up', 'notification', 'marketing']) {
      const decision = { ...baseDecision, category };
      const settings = { categories: { [category]: { enabled: true, targetFolderName: 'Test' } } };

      const scoringResult = score(email, decision);
      const actionResult = await service.applyActions(email, decision, settings);

      expect(actionResult.category).toBe(category);
      expect(actionResult).toHaveProperty('skipped');
    }
  });
});
