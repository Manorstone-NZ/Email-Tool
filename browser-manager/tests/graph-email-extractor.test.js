const GraphEmailExtractor = require('../src/graph-email-extractor');

describe('GraphEmailExtractor', () => {
  test('normalizeMessage should map Graph payload to triage shape', () => {
    const extractor = new GraphEmailExtractor({
      accessToken: 'token-123'
    });

    const message = {
      id: 'msg-1',
      subject: 'Approval Needed',
      bodyPreview: 'Can you approve this today?',
      body: {
        contentType: 'text',
        content: 'Can you approve this today? Full context: this is tied to Q2 planning and board review.'
      },
      webLink: 'https://outlook.office.com/mail/inbox/id/msg-1',
      from: {
        emailAddress: {
          address: 'ceo@company.com'
        }
      },
      isRead: false,
      flag: {
        flagStatus: 'flagged'
      },
      receivedDateTime: '2026-04-12T08:00:00.000Z',
      conversationId: 'conv-1'
    };

    const normalized = extractor.normalizeMessage(message);

    expect(normalized).toEqual({
      messageId: 'msg-1',
      sender: 'ceo@company.com',
      senderEmail: 'ceo@company.com',
      senderDomain: 'company.com',
      subject: 'Approval Needed',
      body: 'Can you approve this today? Full context: this is tied to Q2 planning and board review.',
      preview: 'Can you approve this today?',
      flagged: true,
      read: false,
      timestamp: '2026-04-12T08:00:00.000Z',
      threadId: 'conv-1',
      openUrl: 'https://outlook.office.com/mail/inbox/id/msg-1'
    });
  });

  test('normalizeMessage should strip HTML body for draft-safe plain text', () => {
    const extractor = new GraphEmailExtractor({ accessToken: 'token-123' });

    const message = {
      id: 'msg-2',
      subject: 'HTML Message',
      bodyPreview: 'Line 1 preview',
      body: {
        contentType: 'html',
        content: '<div>Hello <b>team</b>.</div><script>bad()</script><style>.x{}</style><p>Thanks.</p>'
      },
      from: { emailAddress: { address: 'ops@company.com' } }
    };

    const normalized = extractor.normalizeMessage(message);

    expect(normalized.body).toBe('Hello team.\nThanks.');
    expect(normalized.preview).toBe('Line 1 preview');
  });

  test('normalizeMessage should preserve readable line breaks and decode HTML entities', () => {
    const extractor = new GraphEmailExtractor({ accessToken: 'token-123' });

    const message = {
      id: 'msg-3',
      subject: 'Formatting check',
      bodyPreview: 'Hey Team, Another gem we found today.',
      body: {
        contentType: 'html',
        content: '<p>Hey Team,&nbsp;</p><p>Another gem we found today.</p><p>Kind regards,&nbsp;<br/>Maveek Bhai</p>'
      },
      from: { emailAddress: { address: 'ops@company.com' } }
    };

    const normalized = extractor.normalizeMessage(message);

    expect(normalized.body).toContain('Hey Team,');
    expect(normalized.body).toContain('Another gem we found today.');
    expect(normalized.body).toContain('Kind regards,\nMaveek Bhai');
    expect(normalized.body.includes('&nbsp;')).toBe(false);
  });

  test('getInboxEmails should return empty array if access token missing', async () => {
    const extractor = new GraphEmailExtractor({
      accessToken: '',
      tokenStore: {
        getAccessToken: () => ''
      }
    });

    const emails = await extractor.getInboxEmails();

    expect(emails).toEqual([]);
  });

  test('getAccessToken should fall back to tokenStore token', () => {
    const extractor = new GraphEmailExtractor({
      accessToken: '',
      tokenStore: {
        getAccessToken: () => 'stored-token'
      }
    });

    expect(extractor.getAccessToken()).toBe('stored-token');
  });

  test('lookbackDays should default to 3 when not provided', () => {
    const extractor = new GraphEmailExtractor({
      accessToken: 'token-123'
    });

    expect(extractor.lookbackDays).toBe(3);
  });

  test('isWithinLookbackDays honors configured day window', () => {
    const extractor = new GraphEmailExtractor({
      accessToken: 'token-123',
      lookbackDays: 14
    });
    const now = new Date('2026-04-12T12:00:00.000Z').getTime();

    expect(extractor.isWithinLookbackDays('2026-04-01T12:00:00.000Z', now)).toBe(true);
    expect(extractor.isWithinLookbackDays('2026-03-28T11:59:59.000Z', now)).toBe(false);
  });
});
