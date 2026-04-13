const ClaudeProvider = require('./ai-claude-provider');
const LmStudioProvider = require('./ai-lmstudio-provider');
const OpenAiProvider = require('./ai-openai-provider');

const DEFAULT_PRIMARY = 'claude-opus';
const DEFAULT_FALLBACK = 'gemma-lmstudio';

const PROVIDER_ALIASES = Object.freeze({
  'openai-gpt41': 'openai-gpt54',
});

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
  const rawValue = String(name || '').trim();
  const value = PROVIDER_ALIASES[rawValue] || rawValue;
  if (value === 'claude-opus' || value === 'gemma-lmstudio' || value === 'openai-gpt54') {
    return value;
  }
  return fallbackName;
}

function pickSafeFallbackProviderName(primaryName) {
  return primaryName === 'gemma-lmstudio' ? 'claude-opus' : 'gemma-lmstudio';
}

function resolveAiProviders(settings = {}) {
  const primaryName = normalizeProviderName(settings.aiProviderPrimary, DEFAULT_PRIMARY);
  const fallbackName = normalizeProviderName(settings.aiProviderFallback, DEFAULT_FALLBACK);

  let primaryProvider = buildProvider(primaryName, settings);
  let fallbackProvider = buildProvider(fallbackName, settings);

  // Prefer a configured provider first so draft generation does not always fail on primary.
  if (!primaryProvider.isConfigured() && fallbackProvider.isConfigured()) {
    const temp = primaryProvider;
    primaryProvider = fallbackProvider;
    fallbackProvider = temp;
  }

  // If both selected providers are unconfigured (typically missing API keys), force
  // an LM Studio fallback path instead of duplicating the same failing provider.
  if (!primaryProvider.isConfigured() && !fallbackProvider.isConfigured()) {
    const safeFallbackName = pickSafeFallbackProviderName(primaryProvider.name);
    fallbackProvider = buildProvider(safeFallbackName, settings);
  }

  return {
    primaryProvider,
    fallbackProvider,
  };
}

module.exports = {
  resolveAiProviders,
};