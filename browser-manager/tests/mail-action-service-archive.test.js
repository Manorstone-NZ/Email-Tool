const MailActionService = require('../src/mail-action-service');

describe('MailActionService.deleteEmail', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('moves email to deleteditems folder via Graph move API', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: 'deleted-msg-1' }),
      text: async () => '',
    });

    const tokenStore = { getAccessToken: () => 'token-123' };
    const service = new MailActionService({ tokenStore, user: 'me', baseUrl: 'https://graph.microsoft.com/v1.0' });

    const result = await service.deleteEmail('msg-1');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/me/messages/msg-1/move',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ destinationId: 'deleteditems' }),
      })
    );
    expect(result.success).toBe(true);
    expect(result.action).toBe('delete');
    expect(result.movedMessageId).toBe('deleted-msg-1');
  });
});

describe('MailActionService.archiveEmail', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('moves email to configured archive folder when archiveFolderId is set', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: 'moved-msg-1' }),
      text: async () => '',
    });

    const tokenStore = { getAccessToken: () => 'token-123' };
    const service = new MailActionService({ tokenStore, user: 'me', baseUrl: 'https://graph.microsoft.com/v1.0' });

    const result = await service.archiveEmail('msg-1', { archiveFolderId: 'folder-archive-1' });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/me/messages/msg-1/move',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ destinationId: 'folder-archive-1' }),
      })
    );
    expect(result.success).toBe(true);
    expect(result.action).toBe('archive');
    expect(result.movedMessageId).toBe('moved-msg-1');
  });

  test('falls back to Archive category when archiveFolderId is not set', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    });

    const tokenStore = { getAccessToken: () => 'token-123' };
    const service = new MailActionService({ tokenStore, user: 'me', baseUrl: 'https://graph.microsoft.com/v1.0' });

    await service.archiveEmail('msg-2');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/me/messages/msg-2',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ categories: ['Archive'] }),
      })
    );
  });

  test('lists mail folders using supported Graph fields only', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        value: [
          { id: 'folder-2', displayName: 'Projects', parentFolderId: 'root' },
          { id: 'folder-1', displayName: 'Archive', parentFolderId: 'root' },
        ],
      }),
    });

    const tokenStore = { getAccessToken: () => 'token-123' };
    const service = new MailActionService({ tokenStore, user: 'me', baseUrl: 'https://graph.microsoft.com/v1.0' });

    const folders = await service.listMailFolders();

    expect(global.fetch).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/me/mailFolders?$top=200&$select=id,displayName,parentFolderId',
      expect.objectContaining({ method: 'GET' })
    );
    expect(folders).toEqual([
      { id: 'folder-1', displayName: 'Archive', parentFolderId: 'root', wellKnownName: null },
      { id: 'folder-2', displayName: 'Projects', parentFolderId: 'root', wellKnownName: null },
    ]);
  });
});

describe('MailActionService.setPinned', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('sets flagStatus=flagged when pinning', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    });

    const tokenStore = { getAccessToken: () => 'token-123' };
    const service = new MailActionService({ tokenStore, user: 'me', baseUrl: 'https://graph.microsoft.com/v1.0' });

    const result = await service.setPinned('msg-3', true);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/me/messages/msg-3',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ flag: { flagStatus: 'flagged' } }),
      })
    );
    expect(result.action).toBe('pin');
    expect(result.pinned).toBe(true);
  });

  test('sets flagStatus=notFlagged when unpinning', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    });

    const tokenStore = { getAccessToken: () => 'token-123' };
    const service = new MailActionService({ tokenStore, user: 'me', baseUrl: 'https://graph.microsoft.com/v1.0' });

    const result = await service.setPinned('msg-4', false);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/me/messages/msg-4',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ flag: { flagStatus: 'notFlagged' } }),
      })
    );
    expect(result.action).toBe('pin');
    expect(result.pinned).toBe(false);
  });
});
