describe('Shell layout route contract', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  afterEach(() => {
    window.location.hash = '';
  });

  test('defaults unknown hash to email route', async () => {
    window.location.hash = '#unknown';
    await bootstrapApp();
    expect(getActiveRoute()).toBe('email');
  });

  test('sidebar contains email/settings/logs only', async () => {
    await bootstrapApp();
    const labels = getSidebarRouteLabels();
    expect(labels).toEqual(['Email', 'Settings', 'Logs']);
  });
});

async function bootstrapApp() {
  jest.resetModules();

  document.body.innerHTML = `
    <nav class="portal-nav">
      <button type="button" data-route="email" class="portal-nav-link">Email</button>
      <button type="button" data-route="logs" class="portal-nav-link">Logs</button>
      <button type="button" data-route="settings" class="portal-nav-link">Settings</button>
    </nav>

    <main class="portal-main">
      <section data-view="email"></section>
      <section data-view="settings" hidden></section>
      <section data-view="logs" hidden></section>
    </main>

    <button id="triageRefreshBtn" type="button">Refresh</button>
    <input id="emailSearch" type="search">
    <ul id="tagList"></ul>
    <form id="settingsForm"></form>
    <div id="settings-panel"></div>
  `;

  global.fetch = jest.fn(async (url) => {
    if (String(url).includes('/api/settings/categorisation')) {
      return {
        json: async () => ({
          topicLabelsGloballyEnabled: true,
          categories: {
            todo: { enabled: true, targetFolderName: '', outlookCategoryTag: '', topicLabelsEnabled: true },
            fyi: { enabled: true, targetFolderName: '', outlookCategoryTag: '', topicLabelsEnabled: true },
            to_follow_up: { enabled: true, targetFolderName: '', outlookCategoryTag: '', topicLabelsEnabled: true },
            notification: { enabled: true, targetFolderName: '', outlookCategoryTag: '', topicLabelsEnabled: true },
            marketing: { enabled: true, targetFolderName: '', outlookCategoryTag: '', topicLabelsEnabled: true },
          },
          topicLabels: [],
          customRules: [],
        }),
      };
    }

    if (String(url).includes('/api/settings')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, settings: {} }),
      };
    }

    if (String(url).includes('/api/graph/mail-folders')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, folders: [] }),
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, events: [], items: [] }),
    };
  });

  global.WebSocket = class MockWebSocket {
    constructor() {
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
    }

    send() {}
  };

  global.setInterval = jest.fn(() => 1);

  require('../../public/app.js');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await Promise.resolve();
}

function getActiveRoute() {
  return document.querySelector('[data-region="app-sidebar"] [data-route].is-active')?.dataset.route || null;
}

function getSidebarRouteLabels() {
  return Array.from(document.querySelectorAll('[data-region="app-sidebar"] [data-route]')).map((node) => node.textContent.trim());
}
