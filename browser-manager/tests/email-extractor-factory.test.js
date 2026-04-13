const {
  createExtractor,
  resolveProvider
} = require('../src/email-extractor-factory');

describe('email-extractor-factory', () => {
  const emptyTokenStore = {
    getAccessToken: () => ''
  };

  test('resolveProvider should choose graph when EMAIL_PROVIDER=graph', () => {
    const provider = resolveProvider({
      EMAIL_PROVIDER: 'graph'
    });

    expect(provider).toBe('graph');
  });

  test('resolveProvider should choose graph when GRAPH_ACCESS_TOKEN is present', () => {
    const provider = resolveProvider({
      GRAPH_ACCESS_TOKEN: 'token-123'
    });

    expect(provider).toBe('graph');
  });

  test('resolveProvider should default to chrome extractor', () => {
    const provider = resolveProvider({}, emptyTokenStore);

    expect(provider).toBe('chrome');
  });

  test('resolveProvider should choose graph when token store has token', () => {
    const provider = resolveProvider({}, {
      getAccessToken: () => 'token-abc'
    });

    expect(provider).toBe('graph');
  });

  test('createExtractor should return graph extractor for graph provider', () => {
    const extractor = createExtractor({
      EMAIL_PROVIDER: 'graph',
      GRAPH_ACCESS_TOKEN: 'token-123'
    });

    expect(extractor.getInboxEmails).toBeDefined();
    expect(extractor.providerName).toBe('graph');
  });

  test('createExtractor should return chrome extractor by default', () => {
    const extractor = createExtractor({}, {
      tokenStore: emptyTokenStore
    });

    expect(extractor.getInboxEmails).toBeDefined();
    expect(extractor.providerName).toBe('chrome');
  });
});
