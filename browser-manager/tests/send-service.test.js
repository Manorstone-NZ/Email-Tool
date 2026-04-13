const SendService = require('../src/send-service');

describe('send-service', () => {
  const approvedDraft = {
    emailId: 'email-1',
    status: 'approved',
    version: 1,
    approvedVersion: 1,
    subject: 'Re: Service update',
    body: 'Thanks for the update.',
  };

  beforeEach(() => {
    approvedDraft.approvedContentHash = require('../src/approval-service').computeContentHash(
      approvedDraft.subject,
      approvedDraft.body
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('returns actionable guidance when Graph denies sendMail with 403', async () => {
    const service = new SendService({
      tokenStore: { getAccessToken: () => 'token-123' },
      user: 'me',
      baseUrl: 'https://graph.microsoft.com/v1.0',
    });

    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({
        error: {
          code: 'ErrorAccessDenied',
          message: 'Access is denied. Check credentials and try again.'
        }
      })
    });

    await expect(service.sendApprovedDraft(approvedDraft, { sender: 'ops@example.com' }))
      .rejects
      .toThrow(/Mail\.Send|npm run graph-auth/i);
  });
});
