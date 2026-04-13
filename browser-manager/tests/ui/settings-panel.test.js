describe('Settings Panel UI', () => {
  let container, mockApi;

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'settings-panel';
    document.body.appendChild(container);

    mockApi = {
      getSettings: jest.fn().mockResolvedValue({
        topicLabelsGloballyEnabled: true,
        categories: {
          todo: { enabled: true, targetFolderName: 'Todo', outlookCategoryTag: 'Todo', topicLabelsEnabled: true },
          fyi: { enabled: false, targetFolderName: '', outlookCategoryTag: '', topicLabelsEnabled: true },
          to_follow_up: { enabled: true, targetFolderName: 'Follow Up', outlookCategoryTag: '', topicLabelsEnabled: true },
          notification: { enabled: false, targetFolderName: '', outlookCategoryTag: '', topicLabelsEnabled: true },
          marketing: { enabled: false, targetFolderName: '', outlookCategoryTag: '', topicLabelsEnabled: true },
        },
        topicLabels: [{ id: 'l1', key: 'billing', patterns: ['invoice'], mapsToCategory: 'notification', enabled: true }],
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
      expect(rulesList.textContent).toContain('boss@example.com');
    });

    test('fetches settings on load', async () => {
      const { renderSettingsPanel } = require('../../public/app.js');

      await renderSettingsPanel(container, mockApi);

      expect(mockApi.getSettings).toHaveBeenCalled();
    });
  });

  describe('Category Card Interactions', () => {
    test('toggling category enabled/disabled sends update', async () => {
      const { renderSettingsPanel } = require('../../public/app.js');

      await renderSettingsPanel(container, mockApi);

      const fyiCard = Array.from(container.querySelectorAll('.category-card')).find(c => c.textContent.includes('fyi'));
      const checkbox = fyiCard.querySelector('input[type="checkbox"][name*="enabled"]');

      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));

      // Wait for async update
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockApi.putSettings).toHaveBeenCalled();
    });

    test('changing folder name sends update', async () => {
      const { renderSettingsPanel } = require('../../public/app.js');

      await renderSettingsPanel(container, mockApi);

      const todoCard = Array.from(container.querySelectorAll('.category-card')).find(c => c.textContent.includes('todo'));
      const folderInput = todoCard.querySelector('input[name*="targetFolderName"]');

      folderInput.value = 'NewTodoFolder';
      folderInput.dispatchEvent(new Event('change'));

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockApi.putSettings).toHaveBeenCalled();
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

      const labelItem = container.querySelector('.label-item');
      const deleteBtn = labelItem.querySelector('.delete-button');

      deleteBtn.click();

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockApi.putSettings).toHaveBeenCalled();
      const putCall = mockApi.putSettings.mock.calls[0][0];
      expect(putCall.topicLabels).toHaveLength(0);
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

      const ruleItem = container.querySelector('.rule-item');
      const deleteBtn = ruleItem.querySelector('.delete-button');

      deleteBtn.click();

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockApi.putSettings).toHaveBeenCalled();
      const putCall = mockApi.putSettings.mock.calls[0][0];
      expect(putCall.customRules).toHaveLength(0);
    });
  });

  describe('WebSocket Updates', () => {
    test('handleSettingsUpdated refreshes panel on message', async () => {
      const { renderSettingsPanel, handleSettingsUpdated } = require('../../public/app.js');

      await renderSettingsPanel(container, mockApi);

      const newSettings = {
        topicLabelsGloballyEnabled: false,
        categories: { ...mockApi.getSettings() },
        topicLabels: [],
        customRules: [],
      };

      handleSettingsUpdated({ settings: newSettings });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Panel should re-render with new settings
      expect(container.querySelector('.global-settings')).toBeTruthy();
    });
  });
});
