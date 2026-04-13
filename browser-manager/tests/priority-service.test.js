const { PriorityService } = require('../src/priority-service');

test('uses primary provider when output is valid', async () => {
  const primary = {
    name: 'claude-opus',
    completeJson: async () => ({
      priority: 'respond-now',
      category: 'Needs Reply',
      reason: 'Customer requested immediate update',
      draftTone: 'professional-direct',
      confidence: 0.9,
    }),
  };
  const fallback = {
    name: 'gemma-lmstudio',
    completeJson: async () => {
      throw new Error('should not be called');
    },
  };

  const service = new PriorityService({ primaryProvider: primary, fallbackProvider: fallback });
  const result = await service.prioritize({ subject: 'Urgent ask', body: 'Please reply today.' }, { score: 50 });

  expect(result.available).toBe(true);
  expect(result.priority).toBe('respond-now');
  expect(result.category).toBe('Needs Reply');
  expect(result.providerUsed).toBe('claude-opus');
  expect(result.responseRecommended).toBe(true);
});

test('falls back when primary output is invalid', async () => {
  const primary = {
    name: 'claude-opus',
    completeJson: async () => ({ priority: 'bad-priority', category: 'Needs Reply' }),
  };
  const fallback = {
    name: 'gemma-lmstudio',
    completeJson: async () => ({
      priority: 'review-later',
      category: 'FYI',
      reason: 'Not urgent',
      draftTone: 'neutral',
      confidence: 0.4,
    }),
  };

  const service = new PriorityService({ primaryProvider: primary, fallbackProvider: fallback });
  const result = await service.prioritize({ subject: 'FYI', body: 'No action needed.' }, { score: 15 });

  expect(result.available).toBe(true);
  expect(result.priority).toBe('review-later');
  expect(result.category).toBe('FYI');
  expect(result.providerUsed).toBe('gemma-lmstudio');
  expect(result.responseRecommended).toBe(false);
});

test('returns unavailable when both providers are invalid', async () => {
  const primary = {
    name: 'claude-opus',
    completeJson: async () => ({ priority: 'wrong', category: 'Needs Reply' }),
  };
  const fallback = {
    name: 'gemma-lmstudio',
    completeJson: async () => ({ priority: 'still-wrong', category: 'FYI' }),
  };

  const service = new PriorityService({ primaryProvider: primary, fallbackProvider: fallback });
  const result = await service.prioritize({ subject: 'Hello', body: 'Body' }, { score: 20 });

  expect(result.available).toBe(false);
  expect(result.priority).toBeNull();
  expect(result.category).toBeNull();
  expect(result.providerUsed).toBeNull();
});

test('falls back when primary category is missing', async () => {
  const primary = {
    name: 'claude-opus',
    completeJson: async () => ({
      priority: 'respond-today',
      reason: 'Needs a response today',
      draftTone: 'professional-direct',
      confidence: 0.8,
    }),
  };
  const fallback = {
    name: 'gemma-lmstudio',
    completeJson: async () => ({
      priority: 'respond-today',
      category: 'Needs Reply',
      reason: 'Needs a response today',
      draftTone: 'professional-direct',
      confidence: 0.8,
    }),
  };

  const service = new PriorityService({ primaryProvider: primary, fallbackProvider: fallback });
  const result = await service.prioritize({ subject: 'Follow-up', body: 'Please confirm today.' }, { score: 50 });

  expect(result.available).toBe(true);
  expect(result.category).toBe('Needs Reply');
  expect(result.providerUsed).toBe('gemma-lmstudio');
});

test('returns unavailable when both providers return invalid categories', async () => {
  const primary = {
    name: 'claude-opus',
    completeJson: async () => ({
      priority: 'respond-now',
      category: 'Urgent',
      reason: 'Immediate reply needed',
      draftTone: 'professional-direct',
      confidence: 0.9,
    }),
  };
  const fallback = {
    name: 'gemma-lmstudio',
    completeJson: async () => ({
      priority: 'review-later',
      category: 'Other',
      reason: 'Low urgency',
      draftTone: 'neutral',
      confidence: 0.3,
    }),
  };

  const service = new PriorityService({ primaryProvider: primary, fallbackProvider: fallback });
  const result = await service.prioritize({ subject: 'Hello', body: 'Body' }, { score: 20 });

  expect(result.available).toBe(false);
  expect(result.category).toBeNull();
});
