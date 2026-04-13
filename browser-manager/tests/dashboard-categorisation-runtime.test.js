const request = require('supertest');

describe('DashboardServer categorisation runtime routes', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('serves categorisation settings routes from the live dashboard server', async () => {
    const DashboardServer = require('../dashboard');
    const server = new DashboardServer(0);
    const categorizationSettings = {
      getSettings: jest.fn(() => ({
        topicLabelsGloballyEnabled: true,
        categories: {
          todo: { enabled: true, topicLabelsEnabled: true },
          fyi: { enabled: false, topicLabelsEnabled: true },
          to_follow_up: { enabled: false, topicLabelsEnabled: true },
          notification: { enabled: false, topicLabelsEnabled: true },
          marketing: { enabled: false, topicLabelsEnabled: true },
        },
        topicLabels: [],
        customRules: [],
      })),
      updateCache: jest.fn(),
    };
    const manager = {
      emailTriage: {
        setCategorizationSettings: jest.fn(),
      },
      broadcast: jest.fn(),
    };

    server.setManager(manager);
    server.setCategorizationSettings(categorizationSettings);
    server.setup();

    const getResponse = await request(server.app).get('/api/settings/categorisation');
    expect(getResponse.status).toBe(200);
    expect(getResponse.body).toHaveProperty('categories');

    const putResponse = await request(server.app)
      .put('/api/settings/categorisation')
      .send({
        topicLabelsGloballyEnabled: true,
        categories: {
          todo: { enabled: true, topicLabelsEnabled: true },
          fyi: { enabled: false, topicLabelsEnabled: true },
          to_follow_up: { enabled: false, topicLabelsEnabled: true },
          notification: { enabled: false, topicLabelsEnabled: true },
          marketing: { enabled: false, topicLabelsEnabled: true },
        },
        topicLabels: [],
        customRules: [],
      });

    expect(putResponse.status).toBe(200);
    expect(categorizationSettings.updateCache).toHaveBeenCalled();
    expect(manager.emailTriage.setCategorizationSettings).toHaveBeenCalled();
    expect(manager.broadcast).toHaveBeenCalledWith({
      type: 'settings_updated',
      key: 'categorisation',
      settings: expect.any(Object),
    });
  });
});