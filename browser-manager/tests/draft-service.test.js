const DraftService = require('../src/draft-service');

test('edits invalidate approval by bumping version and clearing approval', async () => {
  const primary = {
    name: 'claude-opus',
    completeJson: async () => ({
      subject: 'Re: Hello',
      body: 'Thanks for reaching out.',
      draftTone: 'professional-direct',
      followUpQuestions: [],
    }),
  };
  const fallback = {
    name: 'gemma-lmstudio',
    completeJson: async () => {
      throw new Error('should not run');
    },
  };

  const service = new DraftService({ primaryProvider: primary, fallbackProvider: fallback });
  const generated = await service.generateDraft('email-1', { sender: 'a@b.com', subject: 'Hello', body: 'Question' }, null);
  const approved = service.approveDraft('email-1', 'user');
  const edited = service.editDraft('email-1', { body: 'Updated body' });

  expect(generated.version).toBe(1);
  expect(approved.status).toBe('approved');
  expect(edited.version).toBe(2);
  expect(edited.status).toBe('pending_review');
  expect(edited.approvedVersion).toBeNull();
  expect(edited.approvedContentHash).toBeNull();
});

test('fallback provider is used when primary returns invalid output', async () => {
  const primary = {
    name: 'claude-opus',
    completeJson: async () => ({ subject: '', body: '' }),
  };
  const fallback = {
    name: 'gemma-lmstudio',
    completeJson: async () => ({
      subject: 'Re: Update',
      body: 'Here is the update.',
      draftTone: 'neutral',
      followUpQuestions: [],
    }),
  };

  const service = new DraftService({ primaryProvider: primary, fallbackProvider: fallback });
  const draft = await service.generateDraft('email-2', { sender: 'a@b.com', subject: 'Update', body: 'Body' }, null);

  expect(draft.providerUsed).toBe('gemma-lmstudio');
  expect(draft.status).toBe('pending_review');
});
