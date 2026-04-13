const categorize = require('../../src/email-categorizer');
const score = require('../../src/email-scorer');

describe('Categoriser → Scorer Contract', () => {
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

  test('categorizer output is valid input to scorer', () => {
    const email = { senderEmail: 'boss@example.com', subject: 'Meeting', preview: '', isReply: false, isNotification: false };
    const settings = emptySettings();
    settings.customRules = [{ id: 'r1', enabled: true, type: 'sender_email', value: 'boss@example.com', action: 'todo' }];

    const decision = categorize(email, settings);

    // Categorizer must return valid CategorizationDecision
    expect(decision).toHaveProperty('category');
    expect(['todo', 'fyi', 'to_follow_up', 'notification', 'marketing']).toContain(decision.category);
    expect(decision).toHaveProperty('source');
    expect(['custom_rule', 'reply_transition', 'topic_label', 'heuristic']).toContain(decision.source);
    expect(decision).toHaveProperty('confidence');
    expect(decision.confidence).toBeGreaterThanOrEqual(0);
    expect(decision.confidence).toBeLessThanOrEqual(1);
    expect(decision).toHaveProperty('reasons');
    expect(Array.isArray(decision.reasons)).toBe(true);

    // This becomes input to scorer - must not throw
    expect(() => score(email, decision)).not.toThrow();
    
    const scoringResult = score(email, decision);
    expect(scoringResult.urgency).toBeDefined();
    expect(scoringResult.score).toBeDefined();
  });

  test('reasons array is preserved through scorer', () => {
    const email = { senderEmail: 'boss@example.com', subject: 'Meeting', preview: '', isReply: false, isNotification: false };
    const settings = emptySettings();
    settings.customRules = [{ id: 'r1', enabled: true, type: 'sender_email', value: 'boss@example.com', action: 'todo' }];

    const decision = categorize(email, settings);
    const result = score(email, decision);

    // Scorer must preserve categorizer's reasons
    for (const reason of decision.reasons) {
      expect(result.reasons).toContain(reason);
    }
  });

  test('all categorizer sources produce valid scorer input', () => {
    const testCases = [
      { name: 'custom_rule', setup: (s) => { s.customRules = [{ id: 'r1', enabled: true, type: 'sender_email', value: 'x@y.com', action: 'todo' }]; } },
      { name: 'reply_transition', setup: (s) => {}, emailOverride: { senderEmail: 'x@y.com', subject: 'RE: test', preview: '', isReply: true, isNotification: false } },
      { name: 'topic_label', setup: (s) => { s.topicLabels = [{ id: 'l1', key: 'test', patterns: ['urgent'], mapsToCategory: 'todo', enabled: true }]; } },
      { name: 'heuristic', setup: (s) => {}, emailOverride: { senderEmail: 'noreply@service.com', subject: 'notification', preview: '', isReply: false, isNotification: false } },
    ];

    for (const tc of testCases) {
      const email = tc.emailOverride || { senderEmail: 'x@y.com', subject: 'urgent task', preview: '', isReply: false, isNotification: false };
      const settings = emptySettings();
      tc.setup(settings);

      const decision = categorize(email, settings);
      const result = score(email, decision);

      expect(result.urgency).toMatch(/^(low|medium|high)$/);
      expect(result.score).toBeGreaterThanOrEqual(20);
      expect(result.score).toBeLessThanOrEqual(100);
    }
  });

  test('optional fields (matchedRuleId, matchedTopicLabel) handled correctly', () => {
    const email = { senderEmail: 'x@y.com', subject: 'generic', preview: '', isReply: false, isNotification: false };
    const settings = emptySettings();

    const decision = categorize(email, settings); // via heuristic - no matchedRuleId/matchedTopicLabel

    expect(decision.matchedRuleId).toBeUndefined();
    expect(decision.matchedTopicLabel).toBeUndefined();

    // Heuristic decision must still be valid scorer input
    const result = score(email, decision);
    expect(result).toHaveProperty('urgency');
  });
});
