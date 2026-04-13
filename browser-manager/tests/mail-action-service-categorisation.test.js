const MailActionService = require('../src/mail-action-service');

describe('MailActionService.applyActions', () => {
  let service, mockGraphAPI, folderCache;

  beforeEach(() => {
    folderCache = { 'Todo': 'folder_123', 'FYI': 'folder_456', 'Archive': 'folder_789' };
    mockGraphAPI = {
      patch: jest.fn(),
    };
    service = new MailActionService(mockGraphAPI);
    service.folderCache = folderCache;
  });

  describe('guards', () => {
    test('skipAutomation=true skips all actions', async () => {
      const email = { messageId: 'msg_1', senderEmail: 'x@y.com', categories: [] };
      const decision = { category: 'todo', skipAutomation: true, reasons: [] };
      const settings = { categories: { todo: { enabled: true, targetFolderName: 'Todo', outlookCategoryTag: 'Todo' } } };

      const result = await service.applyActions(email, decision, settings);

      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe('skip_automation');
      expect(mockGraphAPI.patch).not.toHaveBeenCalled();
    });

    test('category disabled skips all actions', async () => {
      const email = { messageId: 'msg_2', senderEmail: 'x@y.com', categories: [] };
      const decision = { category: 'todo', skipAutomation: false, reasons: [] };
      const settings = { categories: { todo: { enabled: false, targetFolderName: 'Todo', outlookCategoryTag: 'Todo' } } };

      const result = await service.applyActions(email, decision, settings);

      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe('category_disabled');
      expect(mockGraphAPI.patch).not.toHaveBeenCalled();
    });

    test('no actions configured skips all actions', async () => {
      const email = { messageId: 'msg_3', senderEmail: 'x@y.com', categories: [] };
      const decision = { category: 'todo', skipAutomation: false, reasons: [] };
      const settings = { categories: { todo: { enabled: true } } }; // no targetFolderName, no tag

      const result = await service.applyActions(email, decision, settings);

      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe('no_actions_configured');
      expect(mockGraphAPI.patch).not.toHaveBeenCalled();
    });
  });

  describe('move action', () => {
    test('moves email to target folder when configured', async () => {
      mockGraphAPI.patch.mockResolvedValueOnce({ id: 'msg_1' });

      const email = { messageId: 'msg_1', senderEmail: 'sender@x.com', categories: [] };
      const decision = { category: 'todo', skipAutomation: false, reasons: [] };
      const settings = { categories: { todo: { enabled: true, targetFolderName: 'Todo' } } };

      const result = await service.applyActions(email, decision, settings);

      expect(mockGraphAPI.patch).toHaveBeenCalledWith(
        '/me/messages/msg_1',
        expect.objectContaining({ parentFolderId: 'folder_123' })
      );
      expect(result.actionsApplied).toContain('move');
      expect(result.errors).toHaveLength(0);
    });

    test('skips move if email already in target folder', async () => {
      const email = { messageId: 'msg_1', senderEmail: 'sender@x.com', folderId: 'folder_123', categories: [] };
      const decision = { category: 'todo', skipAutomation: false, reasons: [] };
      const settings = { categories: { todo: { enabled: true, targetFolderName: 'Todo' } } };

      const result = await service.applyActions(email, decision, settings);

      expect(mockGraphAPI.patch).not.toHaveBeenCalled();
      expect(result.actionsSkipped).toContainEqual(expect.objectContaining({ action: 'move' }));
    });

    test('skips move if targetFolderName not in cache', async () => {
      const email = { messageId: 'msg_1', senderEmail: 'sender@x.com', categories: [] };
      const decision = { category: 'todo', skipAutomation: false, reasons: [] };
      const settings = { categories: { todo: { enabled: true, targetFolderName: 'UnknownFolder' } } };

      const result = await service.applyActions(email, decision, settings);

      expect(result.actionsSkipped).toContainEqual(expect.objectContaining({ action: 'move' }));
      expect(result.errors).toHaveLength(0);
    });

    test('records error if move fails', async () => {
      const graphError = new Error('Graph API error');
      graphError.code = 'itemNotFound';
      mockGraphAPI.patch.mockRejectedValueOnce(graphError);

      const email = { messageId: 'msg_1', senderEmail: 'sender@x.com', categories: [] };
      const decision = { category: 'todo', skipAutomation: false, reasons: [] };
      const settings = { categories: { todo: { enabled: true, targetFolderName: 'Todo' } } };

      const result = await service.applyActions(email, decision, settings);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        action: 'move',
        code: 'itemNotFound',
        message: 'Graph API error'
      });
    });
  });

  describe('tag action', () => {
    test('applies Outlook category tag when configured', async () => {
      mockGraphAPI.patch.mockResolvedValueOnce({ id: 'msg_2' });

      const email = { messageId: 'msg_2', senderEmail: 'sender@x.com', categories: [] };
      const decision = { category: 'todo', skipAutomation: false, reasons: [] };
      const settings = { categories: { todo: { enabled: true, outlookCategoryTag: 'Todo' } } };

      const result = await service.applyActions(email, decision, settings);

      expect(mockGraphAPI.patch).toHaveBeenCalledWith(
        '/me/messages/msg_2',
        expect.objectContaining({ categories: ['Todo'] })
      );
      expect(result.actionsApplied).toContain('tag');
    });

    test('skips tag if email already has target category', async () => {
      const email = { messageId: 'msg_2', senderEmail: 'sender@x.com', categories: ['Todo', 'Important'] };
      const decision = { category: 'todo', skipAutomation: false, reasons: [] };
      const settings = { categories: { todo: { enabled: true, outlookCategoryTag: 'Todo' } } };

      const result = await service.applyActions(email, decision, settings);

      expect(mockGraphAPI.patch).not.toHaveBeenCalled();
      expect(result.actionsSkipped).toContainEqual(expect.objectContaining({ action: 'tag' }));
    });

    test('records error if tag fails', async () => {
      const graphError = new Error('Permission denied');
      graphError.code = 'Authorization_RequestDenied';
      mockGraphAPI.patch.mockRejectedValueOnce(graphError);

      const email = { messageId: 'msg_2', senderEmail: 'sender@x.com', categories: [] };
      const decision = { category: 'todo', skipAutomation: false, reasons: [] };
      const settings = { categories: { todo: { enabled: true, outlookCategoryTag: 'Todo' } } };

      const result = await service.applyActions(email, decision, settings);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe('Authorization_RequestDenied');
    });
  });

  describe('combined actions', () => {
    test('executes both move and tag when both configured', async () => {
      mockGraphAPI.patch
        .mockResolvedValueOnce({ id: 'msg_1' })
        .mockResolvedValueOnce({ id: 'msg_1' });

      const email = { messageId: 'msg_1', senderEmail: 'sender@x.com', categories: [] };
      const decision = { category: 'todo', skipAutomation: false, reasons: [] };
      const settings = { categories: { todo: { enabled: true, targetFolderName: 'Todo', outlookCategoryTag: 'Todo' } } };

      const result = await service.applyActions(email, decision, settings);

      expect(mockGraphAPI.patch).toHaveBeenCalledTimes(2);
      expect(result.actionsApplied).toContain('move');
      expect(result.actionsApplied).toContain('tag');
    });

    test('moves if move succeeds even if tag fails', async () => {
      mockGraphAPI.patch
        .mockResolvedValueOnce({ id: 'msg_1' })
        .mockRejectedValueOnce(new Error('Tag failed'));

      const email = { messageId: 'msg_1', senderEmail: 'sender@x.com', categories: [] };
      const decision = { category: 'todo', skipAutomation: false, reasons: [] };
      const settings = { categories: { todo: { enabled: true, targetFolderName: 'Todo', outlookCategoryTag: 'Todo' } } };

      const result = await service.applyActions(email, decision, settings);

      expect(result.actionsApplied).toContain('move');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].action).toBe('tag');
    });
  });

  describe('result shape', () => {
    test('returns complete ActionResult shape on success', async () => {
      mockGraphAPI.patch.mockResolvedValueOnce({ id: 'msg_1' });

      const email = { messageId: 'msg_1', senderEmail: 'sender@x.com', categories: [] };
      const decision = { category: 'fyi', skipAutomation: false, reasons: [] };
      const settings = { categories: { fyi: { enabled: true, targetFolderName: 'FYI' } } };

      const result = await service.applyActions(email, decision, settings);

      expect(result).toHaveProperty('category', 'fyi');
      expect(result).toHaveProperty('skipped');
      expect(result).toHaveProperty('actionsAttempted', expect.any(Array));
      expect(result).toHaveProperty('actionsApplied', expect.any(Array));
      expect(result).toHaveProperty('actionsSkipped', expect.any(Array));
      expect(result).toHaveProperty('errors', expect.any(Array));
    });

    test('returns skipped result with skipReason', async () => {
      const email = { messageId: 'msg_1', senderEmail: 'sender@x.com', categories: [] };
      const decision = { category: 'todo', skipAutomation: true, reasons: [] };
      const settings = { categories: { todo: { enabled: true } } };

      const result = await service.applyActions(email, decision, settings);

      expect(result.skipped).toBe(true);
      expect(result).toHaveProperty('skipReason');
    });
  });
});
