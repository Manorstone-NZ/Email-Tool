const {
  requestDeviceCode,
  pollForToken
} = require('../src/graph-device-auth');

describe('graph-device-auth', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('requestDeviceCode throws when clientId missing', async () => {
    await expect(requestDeviceCode({ tenantId: 'organizations', clientId: '' }))
      .rejects
      .toThrow('GRAPH_CLIENT_ID is required');
  });

  test('pollForToken returns token payload when authorization succeeds', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'access-123',
        refresh_token: 'refresh-123',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'Mail.Read'
      })
    });

    const sleep = jest.fn().mockResolvedValue(undefined);

    const result = await pollForToken({
      tenantId: 'organizations',
      clientId: 'client-123',
      deviceCode: 'device-code-123',
      interval: 0,
      expiresIn: 60,
      fetchImpl: fetchMock,
      sleepFn: sleep
    });

    expect(result.access_token).toBe('access-123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test('requestDeviceCode default scope includes Mail.Send for draft send flow', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        device_code: 'device-code-123',
        user_code: 'ABC-123',
        verification_uri: 'https://microsoft.com/devicelogin',
        expires_in: 900,
        interval: 5,
        message: 'Sign in',
      }),
    });

    await requestDeviceCode({
      tenantId: 'organizations',
      clientId: 'client-123',
      fetchImpl: fetchMock,
    });

    const body = fetchMock.mock.calls[0][1].body;
    expect(body).toContain('scope=');
    expect(decodeURIComponent(body)).toContain('Mail.Send');
  });
});
