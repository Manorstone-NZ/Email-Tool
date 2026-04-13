const fs = require('fs');
const os = require('os');
const path = require('path');
const GraphTokenStore = require('../src/graph-token-store');

describe('GraphTokenStore', () => {
  let dir;
  let filePath;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-token-store-'));
    filePath = path.join(dir, 'graph-token.json');
  });

  test('saveToken writes token with expiresAt', () => {
    const store = new GraphTokenStore({ filePath });
    store.saveToken({
      access_token: 'access-123',
      refresh_token: 'refresh-123',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'Mail.Read'
    });

    const loaded = store.loadToken();
    expect(loaded.access_token).toBe('access-123');
    expect(loaded.refresh_token).toBe('refresh-123');
    expect(typeof loaded.expires_at).toBe('number');
    expect(loaded.expires_at).toBeGreaterThan(Date.now());
  });

  test('getAccessToken returns empty string for missing file', () => {
    const store = new GraphTokenStore({ filePath });
    expect(store.getAccessToken()).toBe('');
  });

  test('getAccessToken returns token when not expired', () => {
    const store = new GraphTokenStore({ filePath });
    store.saveToken({
      access_token: 'access-123',
      expires_in: 3600
    });

    expect(store.getAccessToken()).toBe('access-123');
  });

  test('getAccessToken returns empty string when expired', () => {
    const store = new GraphTokenStore({ filePath });
    fs.writeFileSync(filePath, JSON.stringify({
      access_token: 'access-123',
      expires_at: Date.now() - 1000
    }));

    expect(store.getAccessToken()).toBe('');
  });
});
