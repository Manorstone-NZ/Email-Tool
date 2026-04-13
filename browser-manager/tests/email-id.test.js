const { buildEmailId } = require('../src/email-id');

describe('buildEmailId', () => {
  test('prefers messageId over threadId when both are present', () => {
    expect(buildEmailId({
      messageId: 'msg-123',
      threadId: 'conv-456',
      openUrl: 'https://example.test/mail/1',
    })).toBe('msg-123');
  });
});