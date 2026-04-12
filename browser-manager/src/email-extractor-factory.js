const EmailExtractor = require('./email-extractor');
const GraphEmailExtractor = require('./graph-email-extractor');
const GraphTokenStore = require('./graph-token-store');

function resolveProvider(env = process.env, tokenStore = new GraphTokenStore()) {
  if ((env.EMAIL_PROVIDER || '').toLowerCase() === 'graph') {
    return 'graph';
  }

  if (env.GRAPH_ACCESS_TOKEN) {
    return 'graph';
  }

  if (tokenStore.getAccessToken()) {
    return 'graph';
  }

  return 'chrome';
}

function createExtractor(env = process.env, options = {}) {
  const tokenStore = options.tokenStore || new GraphTokenStore();
  const provider = resolveProvider(env, tokenStore);

  if (provider === 'graph') {
    return new GraphEmailExtractor({
      accessToken: env.GRAPH_ACCESS_TOKEN,
      user: env.GRAPH_USER,
      baseUrl: env.GRAPH_BASE_URL,
      maxItems: env.GRAPH_MAX_ITEMS,
      lookbackDays: env.GRAPH_LOOKBACK_DAYS,
      tokenStore
    });
  }

  return new EmailExtractor();
}

module.exports = {
  createExtractor,
  resolveProvider
};
