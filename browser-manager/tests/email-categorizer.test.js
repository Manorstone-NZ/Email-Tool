const categorize = require('../src/email-categorizer');

describe('email-categorizer', () => {
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

  describe('custom rules (highest priority)', () => {
    test('sender_email match categorizes to rule action', () => {
      const settings = emptySettings();
      settings.customRules = [{ id: 'r1', enabled: true, type: 'sender_email', value: 'boss@example.com', action: 'todo' }];
      const result = categorize(
        { senderEmail: 'boss@example.com', subject: 'Meeting', preview: '', isReply: false, isNotification: false },
        settings
      );
      expect(result.category).toBe('todo');
      expect(result.source).toBe('custom_rule');
      expect(result.matchedRuleId).toBe('r1');
      expect(result.confidence).toBe(1.0);
      expect(result.skipAutomation).toBe(false);
      expect(result.reasons).toContain('Matched custom rule: sender_email=boss@example.com');
    });

    test('sender_domain match (uses senderDomain field)', () => {
      const settings = emptySettings();
      settings.customRules = [{ id: 'r2', enabled: true, type: 'sender_domain', value: 'example.com', action: 'fyi' }];
      const result = categorize(
        { senderEmail: 'anyone@other.com', senderDomain: 'example.com', subject: 'News', preview: '', isReply: false, isNotification: false },
        settings
      );
      expect(result.category).toBe('fyi');
      expect(result.source).toBe('custom_rule');
    });

    test('subject_contains match (case-insensitive)', () => {
      const settings = emptySettings();
      settings.customRules = [{ id: 'r3', enabled: true, type: 'subject_contains', value: 'URGENT', action: 'todo' }];
      const result = categorize(
        { senderEmail: 'x@y.com', subject: 'this is urgent news', preview: '', isReply: false, isNotification: false },
        settings
      );
      expect(result.category).toBe('todo');
      expect(result.source).toBe('custom_rule');
    });

    test('subject_exact match (case-insensitive)', () => {
      const settings = emptySettings();
      settings.customRules = [{ id: 'r4', enabled: true, type: 'subject_exact', value: 'timesheet', action: 'to_follow_up' }];
      const result = categorize(
        { senderEmail: 'admin@y.com', subject: 'TIMESHEET', preview: '', isReply: false, isNotification: false },
        settings
      );
      expect(result.category).toBe('to_follow_up');
      expect(result.source).toBe('custom_rule');
    });

    test('disabled rule is skipped', () => {
      const settings = emptySettings();
      settings.customRules = [{ id: 'r5', enabled: false, type: 'sender_email', value: 'boss@example.com', action: 'todo' }];
      const result = categorize(
        { senderEmail: 'boss@example.com', subject: 'Meeting', preview: '', isReply: false, isNotification: false },
        settings
      );
      expect(result.source).not.toBe('custom_rule');
    });

    test('action=skip_automation sets skipAutomation=true', () => {
      const settings = emptySettings();
      settings.customRules = [{ id: 'r6', enabled: true, type: 'sender_email', value: 'vip@example.com', action: 'skip_automation' }];
      const result = categorize(
        { senderEmail: 'vip@example.com', subject: 'Please review this today', preview: '', hasUserReplyInThread: false, isNotification: false },
        settings
      );
      expect(result.skipAutomation).toBe(true);
      expect(result.category).toBe('todo');
      expect(result.source).toBe('heuristic');
      expect(result.matchedRuleId).toBe('r6');
    });

    test('sender_domain uses email.senderDomain field, not senderEmail parsing', () => {
      const settings = emptySettings();
      settings.customRules = [{ id: 'r7', enabled: true, type: 'sender_domain', value: 'alerts.example.com', action: 'notification' }];
      const result = categorize(
        { senderEmail: 'someone@other-domain.com', senderDomain: 'alerts.example.com', subject: 'Status', preview: '' },
        settings
      );

      expect(result.source).toBe('custom_rule');
      expect(result.category).toBe('notification');
      expect(result.matchedRuleId).toBe('r7');
    });

    test('first matching rule wins (rule order matters)', () => {
      const settings = emptySettings();
      settings.customRules = [
        { id: 'r1', enabled: true, type: 'sender_email', value: 'shared@example.com', action: 'fyi' },
        { id: 'r2', enabled: true, type: 'sender_email', value: 'shared@example.com', action: 'todo' },
      ];
      const result = categorize(
        { senderEmail: 'shared@example.com', subject: 'News', preview: '', isReply: false, isNotification: false },
        settings
      );
      expect(result.matchedRuleId).toBe('r1');
      expect(result.category).toBe('fyi');
    });
  });

  describe('reply transition (2nd priority)', () => {
    test('hasUserReplyInThread=true promotes base todo to to_follow_up', () => {
      const settings = emptySettings();
      const result = categorize(
        {
          senderEmail: 'user@example.com',
          senderDomain: 'example.com',
          subject: 'Can you approve this?',
          preview: '',
          hasUserReplyInThread: true,
          isNotification: false,
        },
        settings
      );
      expect(result.category).toBe('to_follow_up');
      expect(result.source).toBe('reply_transition');
      expect(result.confidence).toBeCloseTo(0.95, 2);
    });

    test('reply transition does not override non-todo topic label', () => {
      const settings = emptySettings();
      settings.topicLabels = [
        {
          id: 'l-notify',
          key: 'billing',
          patterns: ['invoice'],
          mapsToCategory: 'notification',
          enabled: true,
        }
      ];
      const result = categorize(
        {
          senderEmail: 'alerts@example.com',
          senderDomain: 'example.com',
          subject: 'Invoice available',
          preview: '',
          hasUserReplyInThread: true,
          isNotification: false,
        },
        settings
      );
      expect(result.category).toBe('notification');
      expect(result.source).toBe('topic_label');
    });
  });

  describe('topic labels (3rd priority)', () => {
    test('topic label with matching pattern categorizes correctly', () => {
      const settings = emptySettings();
      settings.topicLabelsGloballyEnabled = true;
      settings.categories.notification.topicLabelsEnabled = true;
      settings.topicLabels = [
        { id: 'l1', key: 'billing', patterns: ['invoice', 'receipt', 'payment'], mapsToCategory: 'notification', enabled: true }
      ];
      const result = categorize(
        { senderEmail: 'finance@example.com', subject: 'Your Invoice #12345', preview: '', isReply: false, isNotification: false },
        settings
      );
      expect(result.category).toBe('notification');
      expect(result.source).toBe('topic_label');
      expect(result.matchedTopicLabel).toBe('billing');
      expect(result.confidence).toBeCloseTo(0.85, 1);
    });

    test('topic label matching uses normalized sender+subject+preview text', () => {
      const settings = emptySettings();
      settings.topicLabelsGloballyEnabled = true;
      settings.topicLabels = [
        { id: 'l2', key: 'vip-sender', patterns: ['founder@example.com'], mapsToCategory: 'todo', enabled: true }
      ];

      const result = categorize(
        {
          senderEmail: 'Founder@Example.com',
          senderDomain: 'example.com',
          subject: 'Weekly update',
          preview: 'No urgent content',
          hasUserReplyInThread: false,
        },
        settings
      );

      expect(result.category).toBe('todo');
      expect(result.source).toBe('topic_label');
      expect(result.matchedTopicLabel).toBe('vip-sender');
    });

    test('disabled topic label is skipped', () => {
      const settings = emptySettings();
      settings.topicLabelsGloballyEnabled = true;
      settings.topicLabels = [
        { id: 'l1', key: 'billing', patterns: ['invoice'], mapsToCategory: 'notification', enabled: false }
      ];
      const result = categorize(
        { senderEmail: 'finance@example.com', subject: 'Your Invoice', preview: '', isReply: false, isNotification: false },
        settings
      );
      expect(result.source).not.toBe('topic_label');
    });

    test('topicLabelsGloballyEnabled=false disables all topic labels', () => {
      const settings = emptySettings();
      settings.topicLabelsGloballyEnabled = false;
      settings.topicLabels = [
        { id: 'l1', key: 'billing', patterns: ['invoice'], mapsToCategory: 'notification', enabled: true }
      ];
      const result = categorize(
        { senderEmail: 'finance@example.com', subject: 'Your Invoice', preview: '', isReply: false, isNotification: false },
        settings
      );
      expect(result.source).not.toBe('topic_label');
    });

    test('category.topicLabelsEnabled=false disables for that category only', () => {
      const settings = emptySettings();
      settings.topicLabelsGloballyEnabled = true;
      settings.categories.notification.topicLabelsEnabled = false;
      settings.topicLabels = [
        { id: 'l1', key: 'billing', patterns: ['invoice'], mapsToCategory: 'notification', enabled: true }
      ];
      const result = categorize(
        { senderEmail: 'finance@example.com', subject: 'Your Invoice', preview: '', isReply: false, isNotification: false },
        settings
      );
      expect(result.source).not.toBe('topic_label');
    });

    test('first matching topic label wins', () => {
      const settings = emptySettings();
      settings.topicLabelsGloballyEnabled = true;
      settings.topicLabels = [
        { id: 'l1', key: 'billing', patterns: ['payment'], mapsToCategory: 'notification', enabled: true },
        { id: 'l2', key: 'important', patterns: ['payment'], mapsToCategory: 'todo', enabled: true },
      ];
      const result = categorize(
        { senderEmail: 'x@y.com', subject: 'Payment complete', preview: '', isReply: false, isNotification: false },
        settings
      );
      expect(result.matchedTopicLabel).toBe('billing');
      expect(result.category).toBe('notification');
    });
  });

  describe('heuristics (lowest priority)', () => {
    test('isNotification=true categorizes to notification', () => {
      const settings = emptySettings();
      const result = categorize(
        { senderEmail: 'noreply@service.com', subject: 'Order confirmation', preview: '', isReply: false, isNotification: true },
        settings
      );
      expect(result.category).toBe('notification');
      expect(result.source).toBe('heuristic');
      expect(result.confidence).toBeCloseTo(0.75, 1);
    });

    test('noreply/info sender domain goes to fyi', () => {
      const settings = emptySettings();
      const result = categorize(
        { senderEmail: 'noreply@company.com', subject: 'Weekly digest', preview: '', isReply: false, isNotification: false },
        settings
      );
      expect(result.category).toBe('fyi');
      expect(result.source).toBe('heuristic');
    });

    test('info@domain sender goes to fyi', () => {
      const settings = emptySettings();
      const result = categorize(
        { senderEmail: 'info@example.org', subject: 'News', preview: '', isReply: false, isNotification: false },
        settings
      );
      expect(result.category).toBe('fyi');
      expect(result.source).toBe('heuristic');
    });

    test('default category when no rules/transitions/labels/heuristics match is fyi', () => {
      const settings = emptySettings();
      const result = categorize(
        { senderEmail: 'random@example.com', subject: 'Random', preview: '', isReply: false, isNotification: false },
        settings
      );
      expect(result.category).toBe('fyi');
      expect(result.source).toBe('heuristic');
      expect(result.confidence).toBeCloseTo(0.5, 1);
    });
  });

  describe('error recovery', () => {
    test('null email defaults gracefully', () => {
      const settings = emptySettings();
      const result = categorize(
        { senderEmail: null, subject: 'Test', preview: '', isReply: false, isNotification: false },
        settings
      );
      expect(result.category).toBe('fyi');
      expect(result.skipAutomation).toBe(false);
    });

    test('missing settings property defaults gracefully', () => {
      const result = categorize(
        { senderEmail: 'x@y.com', subject: 'Test', preview: '', isReply: false, isNotification: false },
        {}
      );
      expect(result.category).toBe('fyi');
    });

    test('invalid settings shape logs warning and returns default', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const result = categorize(
        { senderEmail: 'x@y.com', subject: 'Test', preview: '', isReply: false, isNotification: false },
        null
      );
      expect(result.category).toBe('fyi');
      warn.mockRestore();
    });
  });
});
