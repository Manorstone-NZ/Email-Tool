const request = require('supertest');

describe('Dashboard graph auth endpoint', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('returns 400 when graph client id is missing', async () => {
    jest.doMock('../src/settings-store', () => ({
      loadSettings: jest.fn(() => ({ graphTenantId: 'organizations', graphClientId: '' })),
      saveSettings: jest.fn(),
    }));

    jest.doMock('../src/graph-device-auth', () => ({
      requestDeviceCode: jest.fn(),
      pollForToken: jest.fn(),
    }));

    const DashboardServer = require('../dashboard');
    const server = new DashboardServer(0);
    server.setup();

    const response = await request(server.app).post('/api/graph-auth/start').send({});

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toMatch(/Missing Graph Client ID/i);
  });

  test('returns device code instructions immediately', async () => {
    const requestDeviceCode = jest.fn(async () => ({
      verification_uri: 'https://microsoft.com/devicelogin',
      user_code: 'ABCD-EFGH',
      device_code: 'device-code-1',
      expires_in: 900,
      interval: 5,
      message: 'Open https://microsoft.com/devicelogin and enter code ABCD-EFGH',
    }));
    const pollForToken = jest.fn(async () => ({
      access_token: 'token-123',
      expires_in: 3600,
    }));
    const saveToken = jest.fn(() => ({ expires_at: 1710000000000 }));

    jest.doMock('../src/settings-store', () => ({
      loadSettings: jest.fn(() => ({ graphTenantId: 'organizations', graphClientId: 'client-123' })),
      saveSettings: jest.fn(),
    }));

    jest.doMock('../src/graph-device-auth', () => ({
      requestDeviceCode,
      pollForToken,
    }));

    jest.doMock('../src/graph-token-store', () => {
      return jest.fn().mockImplementation(() => ({
        saveToken,
      }));
    });

    const DashboardServer = require('../dashboard');
    const server = new DashboardServer(0);
    server.setup();

    const response = await request(server.app).post('/api/graph-auth/start').send({});

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      sessionId: expect.any(String),
      status: 'authorizing',
      verificationUri: 'https://microsoft.com/devicelogin',
      userCode: 'ABCD-EFGH',
      expiresIn: 900,
      interval: 5,
    });
    expect(response.body.instructions).toMatch(/devicelogin/i);
    expect(requestDeviceCode).toHaveBeenCalledWith({
      tenantId: 'organizations',
      clientId: 'client-123',
      scope: expect.stringMatching(/offline_access/),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const statusResponse = await request(server.app)
      .get(`/api/graph-auth/status/${encodeURIComponent(response.body.sessionId)}`);

    expect(statusResponse.status).toBe(200);
    expect(statusResponse.body.success).toBe(true);
    expect(statusResponse.body.status).toBe('completed');
    expect(pollForToken).toHaveBeenCalledWith({
      tenantId: 'organizations',
      clientId: 'client-123',
      deviceCode: 'device-code-1',
      interval: 5,
      expiresIn: 900,
    });
    expect(saveToken).toHaveBeenCalled();
  });

  test('returns 404 for unknown auth session status', async () => {
    const DashboardServer = require('../dashboard');
    const server = new DashboardServer(0);
    server.setup();

    const response = await request(server.app).get('/api/graph-auth/status/unknown-session');
    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
  });
});
