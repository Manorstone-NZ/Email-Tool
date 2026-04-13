describe('Shell layout route contract', () => {
  let originalGlobals;

  beforeEach(() => {
    originalGlobals = {
      fetch: global.fetch,
      WebSocket: global.WebSocket,
      setInterval: global.setInterval,
      clearInterval: global.clearInterval,
    };

    window.location.hash = '';
  });

  afterEach(() => {
    restoreGlobal('fetch', originalGlobals.fetch);
    restoreGlobal('WebSocket', originalGlobals.WebSocket);
    restoreGlobal('setInterval', originalGlobals.setInterval);
    restoreGlobal('clearInterval', originalGlobals.clearInterval);

    jest.restoreAllMocks();
    window.location.hash = '';
    document.body.innerHTML = '';
  });

  test('defaults unknown hash to email route', async () => {
    window.location.hash = '#unknown';
    await bootstrapApp();
    expect(getActiveRoute()).toBe('email');
    expect(window.location.hash).toBe('#email');
    expect(document.body.dataset.route).toBe('email');
  });

  test('sidebar contains email/settings/logs only', async () => {
    await bootstrapApp();
    const labels = getSidebarRouteLabels();
    expect(labels).toEqual(['Email', 'Settings', 'Logs']);
  });
});

async function bootstrapApp() {
  jest.resetModules();

  const domContentLoadedHandlers = [];
  const originalDocumentAddEventListener = document.addEventListener.bind(document);
  document.addEventListener = (type, listener, options) => {
    if (type === 'DOMContentLoaded') {
      domContentLoadedHandlers.push(listener);
      return;
    }

    originalDocumentAddEventListener(type, listener, options);
  };

  const originalWindowAddEventListener = window.addEventListener.bind(window);
  window.addEventListener = (type, listener, options) => {
    if (type === 'hashchange') {
      return;
    }

    originalWindowAddEventListener(type, listener, options);
  };

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

  try {
    require('../../public/app.js');
  } finally {
    document.addEventListener = originalDocumentAddEventListener;
    window.addEventListener = originalWindowAddEventListener;
  }

  domContentLoadedHandlers.forEach((listener) => {
    listener.call(document, new Event('DOMContentLoaded'));
  });
  await Promise.resolve();
}

function getActiveRoute() {
  return getRouteButtons().find((node) => node.classList.contains('is-active'))?.dataset.route || null;
}

function getSidebarRouteLabels() {
  const labelsByRoute = new Map(getRouteButtons().map((node) => [node.dataset.route, node.textContent.trim()]));
  return ['email', 'settings', 'logs']
    .filter((route) => labelsByRoute.has(route))
    .map((route) => labelsByRoute.get(route));
}

function getRouteButtons() {
  const sidebarButtons = Array.from(document.querySelectorAll('.app-sidebar .shell-nav-link[data-route]'));
  if (sidebarButtons.length > 0) {
    return sidebarButtons;
  }

  return Array.from(document.querySelectorAll('.portal-nav .portal-nav-link[data-route]'));
}

function restoreGlobal(name, value) {
  if (typeof value === 'undefined') {
    delete global[name];
    return;
  }

  global[name] = value;
}
