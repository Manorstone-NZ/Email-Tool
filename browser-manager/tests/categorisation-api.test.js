const request = require('supertest');
const express = require('express');

describe('Categorisation Settings API', () => {
  let app, dashboard, mockManager, mockCategorisationSettings;

  beforeEach(() => {
    mockCategorisationSettings = {
      getSettings: jest.fn().mockReturnValue({
        topicLabelsGloballyEnabled: true,
        categories: {
          todo: { enabled: true, topicLabelsEnabled: true },
          fyi: { enabled: false, topicLabelsEnabled: true },
          to_follow_up: { enabled: true, topicLabelsEnabled: true },
          notification: { enabled: false, topicLabelsEnabled: true },
          marketing: { enabled: false, topicLabelsEnabled: true },
        },
        topicLabels: [{ id: 'l1', key: 'billing', patterns: ['invoice'], mapsToCategory: 'notification', enabled: true }],
        customRules: [{ id: 'r1', enabled: true, type: 'sender_email', value: 'boss@example.com', action: 'todo' }],
      }),
      updateCache: jest.fn(),
    };

    mockManager = {
      emailTriage: {
        setCategorizationSettings: jest.fn(),
      },
      broadcast: jest.fn(),
    };

    const Dashboard = require('../dashboard').Dashboard;
    app = express();
    dashboard = new Dashboard(mockManager, mockCategorisationSettings);
    app.use(express.json());
    app.use('/', dashboard.router);
  });

  describe('GET /api/settings/categorisation', () => {
    test('returns current settings', async () => {
      const res = await request(app).get('/api/settings/categorisation');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('topicLabelsGloballyEnabled');
      expect(res.body).toHaveProperty('categories');
      expect(res.body).toHaveProperty('topicLabels');
      expect(res.body).toHaveProperty('customRules');
    });

    test('returns default settings if not configured', async () => {
      mockCategorisationSettings.getSettings.mockReturnValueOnce({
        topicLabelsGloballyEnabled: true,
        categories: {
          todo: { enabled: false, topicLabelsEnabled: true },
          fyi: { enabled: false, topicLabelsEnabled: true },
          to_follow_up: { enabled: false, topicLabelsEnabled: true },
          notification: { enabled: false, topicLabelsEnabled: true },
          marketing: { enabled: false, topicLabelsEnabled: true },
        },
        topicLabels: [],
        customRules: [],
      });

      const res = await request(app).get('/api/settings/categorisation');

      expect(res.status).toBe(200);
      expect(res.body.topicLabels).toEqual([]);
      expect(res.body.customRules).toEqual([]);
    });
  });

  describe('PUT /api/settings/categorisation', () => {
    test('updates settings with valid data', async () => {
      const newSettings = {
        topicLabelsGloballyEnabled: false,
        categories: {
          todo: { enabled: true, topicLabelsEnabled: false },
          fyi: { enabled: true, topicLabelsEnabled: true },
          to_follow_up: { enabled: false, topicLabelsEnabled: true },
          notification: { enabled: false, topicLabelsEnabled: true },
          marketing: { enabled: false, topicLabelsEnabled: true },
        },
        topicLabels: [],
        customRules: [],
      };

      const res = await request(app).put('/api/settings/categorisation').send(newSettings);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockCategorisationSettings.updateCache).toHaveBeenCalled();
      expect(mockManager.emailTriage.setCategorizationSettings).toHaveBeenCalled();
    });

    test('returns 400 for unknown top-level key', async () => {
      const invalidSettings = {
        topicLabelsGloballyEnabled: true,
        unknownKey: 'invalid',
        categories: {
          todo: { enabled: true, topicLabelsEnabled: true },
          fyi: { enabled: false, topicLabelsEnabled: true },
          to_follow_up: { enabled: false, topicLabelsEnabled: true },
          notification: { enabled: false, topicLabelsEnabled: true },
          marketing: { enabled: false, topicLabelsEnabled: true },
        },
        topicLabels: [],
        customRules: [],
      };

      const res = await request(app).put('/api/settings/categorisation').send(invalidSettings);

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toMatch(/unknownKey/);
    });

    test('returns 400 for missing required fields', async () => {
      const incompleteSettings = {
        topicLabelsGloballyEnabled: true,
        // missing categories
      };

      const res = await request(app).put('/api/settings/categorisation').send(incompleteSettings);

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    test('broadcasts settings_updated message via WebSocket', async () => {
      const newSettings = {
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
      };

      await request(app).put('/api/settings/categorisation').send(newSettings);

      expect(mockManager.broadcast).toHaveBeenCalledWith({
        type: 'settings_updated',
        key: 'categorisation',
        settings: expect.any(Object),
      });
    });

    test('calls setCategorizationSettings on triage instance', async () => {
      const newSettings = {
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
      };

      await request(app).put('/api/settings/categorisation').send(newSettings);

      expect(mockManager.emailTriage.setCategorizationSettings).toHaveBeenCalledWith(expect.any(Object));
    });
  });
});
