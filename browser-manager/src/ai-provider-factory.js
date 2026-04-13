const ClaudeProvider = require('./ai-claude-provider');
const LmStudioProvider = require('./ai-lmstudio-provider');
const OpenAiProvider = require('./ai-openai-provider');

const DEFAULT_PRIMARY = 'claude-opus';
const DEFAULT_FALLBACK = 'gemma-lmstudio';

function buildProvider(name, settings = {}) {
  const resolvedName = String(name || '').trim();

  if (resolvedName === 'gemma-lmstudio') {
    return new LmStudioProvider({
      model: settings.aiGemmaModel,
    });
  }

  if (resolvedName === 'openai-gpt54') {
    return new OpenAiProvider({
      apiKey: settings.openaiApiKey,
      model: settings.aiOpenAiModel,
    });
  }

  return new ClaudeProvider({
    apiKey: settings.anthropicApiKey,
    model: settings.aiClaudeModel,
  });
}

function normalizeProviderName(name, fallbackName) {
  const value = String(name || '').trim();
  if (value === 'claude-opus' || value === 'gemma-lmstudio' || value === 'openai-gpt54') {
    return value;
  }
  return fallbackName;
}

function resolveAiProviders(settings = {}) {
  const primaryName = normalizeProviderName(settings.aiProviderPrimary, DEFAULT_PRIMARY);
  const fallbackName = normalizeProviderName(settings.aiProviderFallback, DEFAULT_FALLBACK);

  return {
    primaryProvider: buildProvider(primaryName, settings),
    fallbackProvider: buildProvider(fallbackName, settings),
  };
}

module.exports = {
  resolveAiProviders,
};