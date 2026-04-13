const {
  resolveAiProviders,
} = require('../src/ai-provider-factory');

describe('ai-provider-factory', () => {
  test('resolves configured primary and fallback providers with model overrides', () => {
    const providers = resolveAiProviders({
      aiProviderPrimary: 'gemma-lmstudio',
      aiProviderFallback: 'claude-opus',
      anthropicApiKey: 'sk-ant-test',
      aiClaudeModel: 'claude-custom',
      aiGemmaModel: 'gemma-custom',
    });

    expect(providers.primaryProvider.name).toBe('gemma-lmstudio');
    expect(providers.primaryProvider.model).toBe('gemma-custom');
    expect(providers.fallbackProvider.name).toBe('claude-opus');
    expect(providers.fallbackProvider.apiKey).toBe('sk-ant-test');
    expect(providers.fallbackProvider.model).toBe('claude-custom');
  });

  test('falls back to defaults when provider names are invalid', () => {
    const providers = resolveAiProviders({
      aiProviderPrimary: 'not-real',
      aiProviderFallback: 'still-not-real',
      anthropicApiKey: 'sk-ant-test',
    });

    expect(providers.primaryProvider.name).toBe('claude-opus');
    expect(providers.fallbackProvider.name).toBe('gemma-lmstudio');
  });

  test('allows primary and fallback to resolve to the same provider type', () => {
    const providers = resolveAiProviders({
      aiProviderPrimary: 'gemma-lmstudio',
      aiProviderFallback: 'gemma-lmstudio',
      aiGemmaModel: 'gemma-4',
    });

    expect(providers.primaryProvider.name).toBe('gemma-lmstudio');
    expect(providers.fallbackProvider.name).toBe('gemma-lmstudio');
    expect(providers.primaryProvider).not.toBe(providers.fallbackProvider);
  });

  test('resolves OpenAI provider with key and model overrides', () => {
    const providers = resolveAiProviders({
      aiProviderPrimary: 'openai-gpt54',
      aiProviderFallback: 'claude-opus',
      openaiApiKey: 'sk-openai-test',
      aiOpenAiModel: 'gpt-5.4',
      anthropicApiKey: 'sk-ant-test',
    });

    expect(providers.primaryProvider.name).toBe('openai-gpt54');
    expect(providers.primaryProvider.apiKey).toBe('sk-openai-test');
    expect(providers.primaryProvider.model).toBe('gpt-5.4');
    expect(providers.fallbackProvider.name).toBe('claude-opus');
  });

  test('accepts legacy OpenAI provider alias from settings', () => {
    const providers = resolveAiProviders({
      aiProviderPrimary: 'openai-gpt41',
      aiProviderFallback: 'claude-opus',
      openaiApiKey: 'sk-openai-test',
      aiOpenAiModel: 'gpt-5.4-mini',
      anthropicApiKey: 'sk-ant-test',
    });

    expect(providers.primaryProvider.name).toBe('openai-gpt54');
    expect(providers.primaryProvider.apiKey).toBe('sk-openai-test');
  });

  test('promotes configured fallback when primary is not configured', () => {
    const providers = resolveAiProviders({
      aiProviderPrimary: 'claude-opus',
      aiProviderFallback: 'gemma-lmstudio',
      anthropicApiKey: '',
      aiGemmaModel: 'gemma-4',
    });

    expect(providers.primaryProvider.name).toBe('gemma-lmstudio');
    expect(providers.fallbackProvider.name).toBe('claude-opus');
  });

  test('forces LM Studio as fallback when both key-based providers are unconfigured', () => {
    const providers = resolveAiProviders({
      aiProviderPrimary: 'openai-gpt41',
      aiProviderFallback: 'claude-opus',
      openaiApiKey: '',
      anthropicApiKey: '',
      aiGemmaModel: 'gemma-4',
    });

    expect(providers.fallbackProvider.name).toBe('gemma-lmstudio');
  });
});