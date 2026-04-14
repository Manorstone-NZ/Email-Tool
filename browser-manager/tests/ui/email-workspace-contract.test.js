const fs = require('fs');
const path = require('path');

describe('Email workspace contract', () => {
  test('index declares inbox list and reader pane regions', () => {
    const indexPath = path.join(__dirname, '../../public/index.html');
    const html = fs.readFileSync(indexPath, 'utf8');

    expect(html).toContain('data-region="inbox-list"');
    expect(html).toContain('data-region="reader-pane"');
  });

  test('selects first visible email when there is no current selection', () => {
    const { resolveSelectedEmailId } = require('../../public/app.js');
    const selected = resolveSelectedEmailId(null, [{ id: 'email-1' }, { id: 'email-2' }]);
    expect(selected).toBe('email-1');
  });

  test('reselects first visible email when current selection is no longer visible', () => {
    const { resolveSelectedEmailId } = require('../../public/app.js');
    const selected = resolveSelectedEmailId('email-3', [{ id: 'email-1' }, { id: 'email-2' }]);
    expect(selected).toBe('email-1');
  });

  test('clears selection when visible list is empty', () => {
    const { resolveSelectedEmailId } = require('../../public/app.js');
    const selected = resolveSelectedEmailId('email-1', []);
    expect(selected).toBe(null);
  });

  test('applies search before category/state filters on same dataset', () => {
    const { applyEmailFilters } = require('../../public/app.js');
    const items = [
      {
        id: '1',
        subject: 'Invoice requires review',
        primaryCategory: 'Needs Reply',
        stateLabel: 'Pinned',
      },
      {
        id: '2',
        subject: 'Team offsite',
        primaryCategory: 'Needs Reply',
        stateLabel: 'Pinned',
      },
      {
        id: '3',
        subject: 'Invoice paid confirmation',
        primaryCategory: 'FYI',
        stateLabel: 'Pinned',
      },
    ];

    const result = applyEmailFilters(items, {
      search: 'invoice',
      category: 'Needs Reply',
      state: 'Pinned',
      tag: null,
    });

    expect(result.map((item) => item.id)).toEqual(['1']);
    expect(result.every((item) => item.subject.toLowerCase().includes('invoice'))).toBe(true);
  });

  test('renders distinct fetch-error state from no-results state', () => {
    const { resolveEmptyStateMessage } = require('../../public/app.js');

    const errorText = resolveEmptyStateMessage({
      triageError: 'Unable to load messages',
      filters: { search: 'invoice', category: null, state: null, tag: null },
    });
    const noResultsText = resolveEmptyStateMessage({
      triageError: null,
      filters: { search: 'invoice', category: null, state: null, tag: null },
    });

    expect(errorText).toContain('Unable to load messages');
    expect(errorText).not.toContain('No messages match current filters');
    expect(noResultsText).toBe('No messages match current filters');
  });

  test('reader metadata strip is wrap-based and constrained to two lines on desktop', () => {
    const { createReaderMetadataStrip } = require('../../public/app.js');
    const strip = createReaderMetadataStrip({
      primaryCategory: 'Needs Reply',
      recommendedAction: 'Review / Respond',
      urgency: 'High',
      categorySource: 'heuristic',
      scoreMeta: { confidenceText: '92%' },
    });

    expect(strip.classList.contains('reader-meta-strip')).toBe(true);
    expect(strip.dataset.maxLines).toBe('2');
    expect(strip.querySelectorAll('.meta-priority-high').length).toBeGreaterThan(0);
  });

  test('reader metadata keeps category and recommended action visible before lower-priority keys', () => {
    const { getVisibleMetadataKeys } = require('../../public/app.js');
    const keys = getVisibleMetadataKeys({
      primaryCategory: 'Needs Reply',
      recommendedAction: 'Review / Respond',
      urgency: 'High',
      categorySource: 'heuristic',
      scoreMeta: { confidenceText: '92%' },
    }, { maxEntries: 2 });

    expect(keys).toContain('category');
    expect(keys).toContain('recommendedAction');
    expect(keys).not.toContain('urgency');
  });

  test('mobile row tap opens full-screen reader and hides list/rail via workspace state', async () => {
    const harness = await bootstrapEmailWorkspaceApp(390);

    harness.refreshBtn.click();
    await flushMicrotasks();

    const firstRow = harness.triageList.querySelector('.email-row');
    expect(firstRow).toBeTruthy();

    firstRow.click();

    expect(harness.workspace.classList.contains('is-reader-open')).toBe(true);
    expect(harness.readerPane.querySelector('.mobile-reader-back')).toBeTruthy();
  });

  test('preserves list filters, list scroll, and selection when returning from mobile reader', async () => {
    const harness = await bootstrapEmailWorkspaceApp(390);

    harness.refreshBtn.click();
    await flushMicrotasks();

    harness.searchInput.value = 'invoice';
    harness.searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flushMicrotasks();

    harness.triageList.scrollTop = 44;

    const firstRow = harness.triageList.querySelector('.email-row');
    firstRow.click();
    expect(harness.workspace.classList.contains('is-reader-open')).toBe(true);

    const selectedBefore = harness.triageList.querySelector('.email-row.is-selected')?.dataset.id;

    const backBtn = harness.readerPane.querySelector('.mobile-reader-back');
    expect(backBtn).toBeTruthy();
    backBtn.click();

    expect(harness.workspace.classList.contains('is-reader-open')).toBe(false);
    expect(harness.searchInput.value).toBe('invoice');
    expect(harness.triageList.scrollTop).toBe(44);
    expect(harness.triageList.querySelector('.email-row.is-selected')?.dataset.id).toBe(selectedBefore);
  });
});

async function bootstrapEmailWorkspaceApp(viewportWidth) {
  jest.resetModules();

  setViewport(viewportWidth);

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
    <button type="button" id="sidebarToggleBtn" aria-expanded="false">Menu</button>
    <aside class="app-sidebar">
      <button type="button" data-route="email" class="shell-nav-link is-active">Email</button>
      <button type="button" data-route="settings" class="shell-nav-link">Settings</button>
      <button type="button" data-route="logs" class="shell-nav-link">Logs</button>
    </aside>

    <section data-view="email" class="email-workspace">
      <div class="email-list-panel" data-region="inbox-list">
        <button type="button" id="triageRefreshBtn">Refresh</button>
        <input id="emailSearch" type="search">
        <button type="button" id="emailSearchClear" hidden>&times;</button>
        <div id="categoryPills"></div>
        <div id="statePills"></div>
        <p id="triageStatus"></p>
        <div id="triageList" class="email-list"></div>
        <div id="emailEmptyState" hidden></div>
      </div>
      <section id="readerPane" class="reader-pane" data-region="reader-pane"></section>
    </section>

    <section data-view="settings" hidden>
      <form id="settingsForm"></form>
      <div id="settings-panel"></div>
    </section>
    <section data-view="logs" hidden>
      <tbody id="logsTableBody"></tbody>
      <div id="logsEmptyState" hidden></div>
      <span id="logsResultCount"></span>
      <input id="logsSearchInput" type="search">
      <select id="logsTypeSelect"><option value="all" selected>all</option></select>
      <select id="logsWindowSelect"><option value="15m" selected>15m</option></select>
      <button id="logsClearFiltersBtn" type="button">clear</button>
      <input id="logsLiveToggle" type="checkbox">
      <span id="logsLivePausedBadge"></span>
    </section>
  `;

  global.fetch = jest.fn(async (url) => {
    if (String(url).includes('/api/settings/categorisation')) {
      return {
        ok: true,
        status: 200,
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

    if (String(url).includes('/api/emails/triage')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          extractedCount: 2,
          minScore: 35,
          items: [
            {
              id: 'email-1',
              sender: 'Billing Team',
              subject: 'Invoice requires review',
              preview: 'Please review this invoice',
              body: 'Invoice details',
              primaryCategory: 'Needs Reply',
              recommendedAction: 'Reply',
              tags: ['Approval'],
              stateLabel: 'Pinned',
            },
            {
              id: 'email-2',
              sender: 'Ops Team',
              subject: 'Launch update',
              preview: 'FYI update',
              body: 'Status report',
              primaryCategory: 'FYI',
              recommendedAction: 'Read',
              tags: ['Vendor'],
              stateLabel: 'Done',
            },
          ],
        }),
      };
    }

    if (String(url).includes('/api/settings') || String(url).includes('/api/graph/mail-folders')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, settings: {}, folders: [] }),
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, events: [], items: [] }),
    };
  });

  global.WebSocket = class MockWebSocket {
    send() {}
  };
  global.setInterval = jest.fn(() => 1);
  global.clearInterval = jest.fn();

  try {
    require('../../public/app.js');
  } finally {
    document.addEventListener = originalDocumentAddEventListener;
    window.addEventListener = originalWindowAddEventListener;
  }

  domContentLoadedHandlers.forEach((listener) => {
    listener.call(document, new Event('DOMContentLoaded'));
  });
  await flushMicrotasks();

  return {
    workspace: document.querySelector('.email-workspace'),
    triageList: document.getElementById('triageList'),
    refreshBtn: document.getElementById('triageRefreshBtn'),
    searchInput: document.getElementById('emailSearch'),
    readerPane: document.getElementById('readerPane'),
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

function setViewport(width) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });

  window.matchMedia = (query) => ({
    matches: query.includes('767px') ? width <= 767 : width <= 1099,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}