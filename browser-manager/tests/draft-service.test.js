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

test('accepts wrapped provider output shapes from primary provider', async () => {
  const primary = {
    name: 'claude-opus',
    completeJson: async () => ({
      draft: {
        subjectLine: 'Re: Update requested',
        email_body: 'Thanks, I can take this today.',
        tone: 'professional-direct',
        follow_up_questions: ['Can you confirm deadline?'],
      },
    }),
  };
  const fallback = {
    name: 'gemma-lmstudio',
    completeJson: async () => {
      throw new Error('should not run');
    },
  };

  const service = new DraftService({ primaryProvider: primary, fallbackProvider: fallback });
  const draft = await service.generateDraft('email-3', { sender: 'a@b.com', subject: 'Update', body: 'Body' }, null);

  expect(draft.providerUsed).toBe('claude-opus');
  expect(draft.subject).toBe('Re: Update requested');
  expect(draft.body).toContain('take this today');
  expect(draft.followUpQuestions).toEqual(['Can you confirm deadline?']);
});

test('generates fallback subject when provider returns body-only draft', async () => {
  const primary = {
    name: 'claude-opus',
    completeJson: async () => ({
      body: 'I can handle this and will follow up shortly.',
      draftTone: 'neutral',
    }),
  };
  const fallback = {
    name: 'gemma-lmstudio',
    completeJson: async () => {
      throw new Error('should not run');
    },
  };

  const service = new DraftService({ primaryProvider: primary, fallbackProvider: fallback });
  const draft = await service.generateDraft('email-4', { sender: 'a@b.com', subject: 'Status update', body: 'Body' }, null);

  expect(draft.subject).toBe('Re: Status update');
  expect(draft.body).toContain('follow up shortly');
});

test('uses local fallback template when both providers fail', async () => {
  const primary = {
    name: 'claude-opus',
    completeJson: async () => {
      throw new Error('primary provider timeout');
    },
  };
  const fallback = {
    name: 'gemma-lmstudio',
    completeJson: async () => {
      throw new Error('fallback provider invalid output');
    },
  };

  const service = new DraftService({ primaryProvider: primary, fallbackProvider: fallback });
  const draft = await service.generateDraft('email-5', {
    sender: 'ops@example.com',
    subject: 'Need ETA',
    body: 'Can you confirm timeline?',
  }, null);

  expect(draft.providerUsed).toBe('local-fallback-template');
  expect(draft.subject).toBe('Re: Need ETA');
  expect(draft.body).toContain('follow up shortly');
  expect(draft.status).toBe('pending_review');
});

test('appends configured global email signature to generated drafts', async () => {
  const primary = {
    name: 'claude-opus',
    completeJson: async () => ({
      subject: 'Re: Signature check',
      body: 'Thanks for the update. I will review and respond shortly.',
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

  const service = new DraftService({
    primaryProvider: primary,
    fallbackProvider: fallback,
    emailSignature: 'Kind regards,\nDamian',
  });
  const draft = await service.generateDraft('email-6', {
    sender: 'ops@example.com',
    subject: 'Signature check',
    body: 'Body',
  }, null);

  expect(draft.body).toContain('Thanks for the update. I will review and respond shortly.');
  expect(draft.body).toMatch(/Kind regards,\nDamian$/);
});

test('replaces model-authored trailing sign-off with configured global signature', async () => {
  const primary = {
    name: 'claude-opus',
    completeJson: async () => ({
      subject: 'Re: Onsite follow-up',
      body: [
        'Hi Akshay,',
        '',
        'Thanks for your email and the onsite walkthrough today.',
        '',
        'Kind regards,',
        'Chetan',
      ].join('\n'),
      draftTone: 'professional-direct',
      followUpQuestions: [],
    }),
  };

  const service = new DraftService({
    primaryProvider: primary,
    fallbackProvider: { name: 'gemma-lmstudio', completeJson: async () => ({}) },
    emailSignature: 'Kind regards,\nDamian',
  });

  const draft = await service.generateDraft('email-7', {
    sender: 'akshay@milktest.co.nz',
    subject: 'Onsite follow-up',
    body: 'Body',
  }, null);

  expect(draft.body).toContain('Thanks for your email and the onsite walkthrough today.');
  expect(draft.body).toMatch(/Kind regards,\nDamian$/);
  expect(draft.body.includes('Chetan')).toBe(false);
});

test('builds prompts that enforce recipient perspective instead of sender voice', async () => {
  let capturedSystemPrompt = '';
  let capturedUserPrompt = '';

  const primary = {
    name: 'claude-opus',
    completeJson: async (systemPrompt, userPrompt) => {
      capturedSystemPrompt = systemPrompt;
      capturedUserPrompt = userPrompt;
      return {
        subject: 'Re: Onsite follow-up',
        body: 'Thanks for sharing the onsite notes. I will review and come back with next steps.',
        draftTone: 'professional-direct',
        followUpQuestions: [],
      };
    },
  };

  const service = new DraftService({
    primaryProvider: primary,
    fallbackProvider: { name: 'gemma-lmstudio', completeJson: async () => ({}) },
    emailSignature: 'Kind regards,\nDamian',
  });

  await service.generateDraft('email-8', {
    sender: 'akshay@milktest.co.nz',
    subject: 'Onsite follow-up',
    body: 'Hi Akshay,\n\nNice meeting you onsite today.\n\nKind regards,\nChetan',
  }, { priority: 'respond-today' });

  expect(capturedSystemPrompt).toContain('Write from the mailbox owner perspective (the recipient), never as the original sender.');
  expect(capturedSystemPrompt).toContain('If the inbound email describes meetings, onsite visits, or completed work, do not claim you personally performed those actions unless explicitly stated in context.');
  expect(capturedUserPrompt).toContain('"sender":"akshay@milktest.co.nz"');
  expect(capturedUserPrompt).toContain('"mailboxOwnerSignature":"Kind regards,\\nDamian"');
});
