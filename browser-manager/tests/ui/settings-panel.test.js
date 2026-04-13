describe('Settings Panel UI', () => {
  let container, mockApi;

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'settings-panel';
    document.body.appendChild(container);

    mockApi = {
      getSettings: jest.fn().mockResolvedValue({
        topicLabelsGloballyEnabled: true,
        marketingStrategy: 'default',
        alternativeEmails: ['ops@example.com'],
        categories: {
          todo: { enabled: true, targetFolderName: 'Todo', outlookCategoryTag: 'Todo', topicLabelsEnabled: true },
          fyi: { enabled: false, targetFolderName: '', outlookCategoryTag: '', topicLabelsEnabled: true },
          to_follow_up: { enabled: true, targetFolderName: 'Follow Up', outlookCategoryTag: '', topicLabelsEnabled: true },
          notification: { enabled: false, targetFolderName: '', outlookCategoryTag: '', topicLabelsEnabled: true },
          marketing: { enabled: false, targetFolderName: '', outlookCategoryTag: '', topicLabelsEnabled: true },
        },
        topicLabels: [
          { id: 'l1', key: 'billing', patterns: ['invoice'], mapsToCategory: 'notification', enabled: true },
          { id: 'l2', key: 'important', patterns: ['important'], mapsToCategory: 'todo', enabled: true },
        ],
        customRules: [{ id: 'r1', enabled: true, type: 'sender_email', value: 'boss@example.com', action: 'todo' }],
      }),
      putSettings: jest.fn().mockResolvedValue({ success: true, settings: {} }),
    };
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('Settings Panel Rendering', () => {
    test('renders settings panel with all sections', async () => {
      const { renderSettingsPanel } = require('../../public/app.js');

      await renderSettingsPanel(container, mockApi);

      expect(container.querySelector('.global-settings')).toBeTruthy();
      expect(container.querySelector('.category-cards')).toBeTruthy();
      expect(container.querySelector('.topic-labels-section')).toBeTruthy();
      expect(container.querySelector('.custom-rules-section')).toBeTruthy();
    });

    test('renders 5 category cards', async () => {
      const { renderSettingsPanel } = require('../../public/app.js');

      await renderSettingsPanel(container, mockApi);

      const cards = container.querySelectorAll('.category-card');
      expect(cards.length).toBe(5);
    });

    test('category cards show enabled/disabled toggle', async () => {
      const { renderSettingsPanel } = require('../../public/app.js');

      await renderSettingsPanel(container, mockApi);

      const todoCard = Array.from(container.querySelectorAll('.category-card')).find(c => c.textContent.includes('todo'));
      const enabledCheckbox = todoCard.querySelector('input[type="checkbox"][name*="enabled"]');

      expect(enabledCheckbox).toBeTruthy();
      expect(enabledCheckbox.checked).toBe(true);
    });

    test('category cards show folder and tag inputs', async () => {
      const { renderSettingsPanel } = require('../../public/app.js');

      await renderSettingsPanel(container, mockApi);

      const todoCard = Array.from(container.querySelectorAll('.category-card')).find(c => c.textContent.includes('todo'));
      const folderInput = todoCard.querySelector('input[name*="targetFolderName"]');
      const tagInput = todoCard.querySelector('input[name*="outlookCategoryTag"]');

      expect(folderInput).toBeTruthy();
      expect(folderInput.value).toBe('Todo');
      expect(tagInput).toBeTruthy();
    });

    test('renders topic labels list', async () => {
      const { renderSettingsPanel } = require('../../public/app.js');

      await renderSettingsPanel(container, mockApi);

      const labelsList = container.querySelector('.topic-labels-list');
      expect(labelsList).toBeTruthy();
      expect(labelsList.textContent).toContain('billing');
    });

    test('renders custom rules list', async () => {
      const { renderSettingsPanel } = require('../../public/app.js');

      await renderSettingsPanel(container, mockApi);

      const rulesList = container.querySelector('.custom-rules-list');
      expect(rulesList).toBeTruthy();
      const firstRuleValue = rulesList.querySelector('.custom-rule-row [data-column="input"] input');
      expect(firstRuleValue.value).toBe('boss@example.com');
    });

    test('fetches settings on load', async () => {
      const { renderSettingsPanel } = require('../../public/app.js');

      await renderSettingsPanel(container, mockApi);

      expect(mockApi.getSettings).toHaveBeenCalled();
    });
  });

  describe('Category Card Interactions', () => {
    test('does not persist setting toggle changes until Update preferences', async () => {
      const { renderSettingsPanel } = require('../../public/app.js');

      await renderSettingsPanel(container, mockApi);
      mockApi.putSettings.mockClear();

      const fyiCard = Array.from(container.querySelectorAll('.category-card')).find(c => c.textContent.includes('fyi'));
      const checkbox = fyiCard.querySelector('input[type="checkbox"][name*="enabled"]');

      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));

      expect(mockApi.putSettings).not.toHaveBeenCalled();

      const updateBtn = container.querySelector('[data-settings-save-button]');
      updateBtn.click();
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(mockApi.putSettings).toHaveBeenCalled();
    });

    test('shows persistent unsaved-changes indicator when dirty', async () => {
      const { renderSettingsPanel } = require('../../public/app.js');

      await renderSettingsPanel(container, mockApi);
      const indicator = container.querySelector('[data-settings-dirty-indicator]');
      expect(indicator.hidden).toBe(true);

      const todoCard = Array.from(container.querySelectorAll('.category-card')).find(c => c.textContent.includes('todo'));
      const checkbox = todoCard.querySelector('input[type="checkbox"][name*="enabled"]');
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event('change'));

      expect(indicator.hidden).toBe(false);
      expect(indicator.textContent).toContain('Unsaved changes');
    });
  });

  describe('Categorization General Semantics', () => {
    test('shows secondary category controls only when category enabled', async () => {
      const { renderSettingsPanel } = require('../../public/app.js');

      await renderSettingsPanel(container, mockApi);

      const fyiCard = Array.from(container.querySelectorAll('.category-card')).find(c => c.textContent.includes('fyi'));
      const secondaryControls = fyiCard.querySelectorAll('[data-secondary-control]');
      expect(secondaryControls.length).toBeGreaterThan(0);
      expect(Array.from(secondaryControls).every((el) => el.hidden)).toBe(true);

      const todoCard = Array.from(container.querySelectorAll('.category-card')).find(c => c.textContent.includes('todo'));
      const todoSecondaryControls = todoCard.querySelectorAll('[data-secondary-control]');
      expect(Array.from(todoSecondaryControls).some((el) => !el.hidden)).toBe(true);
    });

    test('keeps Existing categories separate from Move/Keep behavior semantics', async () => {
      const { renderSettingsPanel } = require('../../public/app.js');

      await renderSettingsPanel(container, mockApi);

      expect(container.querySelector('[data-categorization-section="existing-categories"]')).toBeTruthy();
      expect(container.querySelector('[data-categorization-section="move-out"]')).toBeTruthy();
      expect(container.querySelector('[data-categorization-section="keep-in"]')).toBeTruthy();
    });

    test('renders fixed section order for categorization general tab', async () => {
      const { renderSettingsPanel } = require('../../public/app.js');

      await renderSettingsPanel(container, mockApi);

      const order = Array.from(container.querySelectorAll('[data-categorization-section]'))
        .map((node) => node.dataset.categorizationSection);

      expect(order).toEqual(['move-out', 'keep-in', 'existing-categories', 'topic-labels']);
    });
  });

  describe('Topic Labels Management', () => {
    test('renders add topic label button', async () => {
      const { renderSettingsPanel } = require('../../public/app.js');

      await renderSettingsPanel(container, mockApi);

      const addBtn = container.querySelector('.add-label-button');
      expect(addBtn).toBeTruthy();
    });

    test('delete label button removes label and updates settings', async () => {
      const { renderSettingsPanel } = require('../../public/app.js');

      await renderSettingsPanel(container, mockApi);
      mockApi.putSettings.mockClear();

      const labelItem = container.querySelector('[data-label-id="l1"]');
      const deleteBtn = labelItem.querySelector('.delete-button');

      deleteBtn.click();
      const updateBtn = container.querySelector('[data-settings-save-button]');
      updateBtn.click();

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockApi.putSettings).toHaveBeenCalled();
      const putCall = mockApi.putSettings.mock.calls[0][0];
      expect(putCall.topicLabels).toHaveLength(1);
    });
  });

  describe('Custom Rules Management', () => {
    test('renders add custom rule button', async () => {
      const { renderSettingsPanel } = require('../../public/app.js');

      await renderSettingsPanel(container, mockApi);

      const addBtn = container.querySelector('.add-rule-button');
      expect(addBtn).toBeTruthy();
    });

    test('delete rule button removes rule and updates settings', async () => {
      const { renderSettingsPanel } = require('../../public/app.js');

      await renderSettingsPanel(container, mockApi);
      mockApi.putSettings.mockClear();

      const ruleItem = container.querySelector('[data-rule-id="r1"]');
      const deleteBtn = ruleItem.querySelector('.delete-button');

      deleteBtn.click();
      const updateBtn = container.querySelector('[data-settings-save-button]');
      updateBtn.click();

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockApi.putSettings).toHaveBeenCalled();
      const putCall = mockApi.putSettings.mock.calls[0][0];
      expect(putCall.customRules).toHaveLength(0);
    });
  });

  describe('WebSocket Updates', () => {
    test('ignores websocket settings_updated while settings form is dirty', async () => {
      const { renderSettingsPanel, handleSettingsUpdated, isSettingsDirty } = require('../../public/app.js');

      await renderSettingsPanel(container, mockApi);
      const globalToggle = container.querySelector('#topicLabelsGloballyEnabled');
      const initialValue = globalToggle.checked;

      globalToggle.checked = !initialValue;
      globalToggle.dispatchEvent(new Event('change'));
      expect(isSettingsDirty()).toBe(true);

      const incoming = {
        topicLabelsGloballyEnabled: initialValue,
        categories: {
          todo: { enabled: false, targetFolderName: '', outlookCategoryTag: '', topicLabelsEnabled: false },
          fyi: { enabled: false, targetFolderName: '', outlookCategoryTag: '', topicLabelsEnabled: false },
          to_follow_up: { enabled: false, targetFolderName: '', outlookCategoryTag: '', topicLabelsEnabled: false },
          notification: { enabled: false, targetFolderName: '', outlookCategoryTag: '', topicLabelsEnabled: false },
          marketing: { enabled: false, targetFolderName: '', outlookCategoryTag: '', topicLabelsEnabled: false },
        },
        topicLabels: [],
        customRules: [],
      };

      handleSettingsUpdated({ key: 'categorisation', settings: incoming });
      expect(container.querySelector('#topicLabelsGloballyEnabled').checked).toBe(!initialValue);
      expect(container.querySelector('[data-settings-dirty-indicator]').hidden).toBe(false);
    });

    test('navigating away while dirty does not silently discard changes', async () => {
      const { renderSettingsPanel, guardUnsavedSettingsNavigation } = require('../../public/app.js');

      await renderSettingsPanel(container, mockApi);
      const globalToggle = container.querySelector('#topicLabelsGloballyEnabled');
      globalToggle.checked = !globalToggle.checked;
      globalToggle.dispatchEvent(new Event('change'));

      const allowed = guardUnsavedSettingsNavigation('email', () => false);
      expect(allowed).toBe(false);
    });

    test('settings page does not create nested scroll regions', async () => {
      const { renderSettingsPanel } = require('../../public/app.js');

      await renderSettingsPanel(container, mockApi);
      const nestedScrollables = Array.from(container.querySelectorAll('*')).filter((node) => {
        const style = (node.getAttribute('style') || '').toLowerCase();
        return style.includes('overflow:auto') || style.includes('overflow-y:auto');
      });
      expect(nestedScrollables).toHaveLength(0);
    });

    test('handleSettingsUpdated refreshes panel on message when clean', async () => {
      const { renderSettingsPanel, handleSettingsUpdated, setSettingsDirty } = require('../../public/app.js');

      await renderSettingsPanel(container, mockApi);
      setSettingsDirty(false);

      const newSettings = {
        topicLabelsGloballyEnabled: false,
        categories: {
          todo: { enabled: true, targetFolderName: '', outlookCategoryTag: '', topicLabelsEnabled: true },
          fyi: { enabled: true, targetFolderName: '', outlookCategoryTag: '', topicLabelsEnabled: true },
          to_follow_up: { enabled: true, targetFolderName: '', outlookCategoryTag: '', topicLabelsEnabled: true },
          notification: { enabled: true, targetFolderName: '', outlookCategoryTag: '', topicLabelsEnabled: true },
          marketing: { enabled: true, targetFolderName: '', outlookCategoryTag: '', topicLabelsEnabled: true },
        },
        topicLabels: [],
        customRules: [],
      };

      handleSettingsUpdated({ key: 'categorisation', settings: newSettings });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(container.querySelector('.global-settings')).toBeTruthy();
    });
  });

  describe('Advanced Categorization Tab', () => {
    async function openAdvanced() {
      const { renderSettingsPanel } = require('../../public/app.js');
      await renderSettingsPanel(container, mockApi);
      const trigger = container.querySelector('[data-categorization-tab-trigger="advanced"]');
      trigger.click();
    }

    test('renders custom rule row with enable/input/category/action columns', async () => {
      await openAdvanced();
      const firstRow = container.querySelector('.custom-rule-row');
      const columns = Array.from(firstRow.querySelectorAll('[data-column]')).map((el) => el.dataset.column);
      expect(columns).toEqual(['enabled', 'input', 'category', 'action']);
    });

    test('adding/removing rule rows does not shift unrelated row columns', async () => {
      await openAdvanced();
      const before = Array.from(container.querySelectorAll('.custom-rule-row'))
        .map((row) => Array.from(row.querySelectorAll('[data-column]')).map((el) => el.dataset.column));

      container.querySelector('.add-rule-button').click();
      const removable = container.querySelector('.custom-rule-row[data-rule-id="r1"] .delete-button');
      removable.click();

      const after = Array.from(container.querySelectorAll('.custom-rule-row'))
        .map((row) => Array.from(row.querySelectorAll('[data-column]')).map((el) => el.dataset.column));

      expect(after[0]).toEqual(before[0]);
    });

    test('topic labels render in saved order and append-only behavior', async () => {
      const { renderSettingsPanel } = require('../../public/app.js');
      await renderSettingsPanel(container, mockApi);

      const before = Array.from(container.querySelectorAll('.label-item span')).map((el) => el.textContent);
      expect(before[0]).toContain('billing');
      expect(before[1]).toContain('important');

      container.querySelector('.add-label-button').click();
      const after = Array.from(container.querySelectorAll('.label-item span')).map((el) => el.textContent);
      expect(after[after.length - 1]).toContain('vip');
    });

    test('renders marketing classification strategy controls in Advanced tab', async () => {
      await openAdvanced();
      expect(container.textContent).toContain('Marketing classification strategy');
      expect(container.querySelector('#marketingStrategyControl')).toBeTruthy();
    });

    test('renders alternative email identities collection in Advanced tab', async () => {
      await openAdvanced();
      expect(container.textContent).toContain('Alternative email identities');
      expect(container.querySelectorAll('.alternative-identity-row').length).toBeGreaterThan(0);
    });
  });
});
