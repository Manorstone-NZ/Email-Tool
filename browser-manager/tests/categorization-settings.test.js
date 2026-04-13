let loadSettings, validateSettings, validateSettingsStrict;
beforeEach(() => {
  jest.resetModules();
  ({ loadSettings, validateSettings, validateSettingsStrict } = require('../src/categorization-settings'));
});

describe('validateSettings', () => {
  const validSettings = () => ({
    topicLabelsGloballyEnabled: true,
    categories: {
      todo: { enabled: true, topicLabelsEnabled: true },
      fyi: { enabled: true, topicLabelsEnabled: true },
      to_follow_up: { enabled: true, topicLabelsEnabled: true },
      notification: { enabled: false, topicLabelsEnabled: true },
      marketing: { enabled: false, topicLabelsEnabled: true },
    },
    topicLabels: [],
    customRules: [],
  });

  test('valid settings loads without error', () => {
    expect(() => validateSettings(validSettings())).not.toThrow();
  });

  test('missing required key throws', () => {
    const s = validSettings();
    delete s.categories;
    expect(() => validateSettings(s)).toThrow();
  });

  test('unknown top-level key is ignored with warning (lenient mode)', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const s = { ...validSettings(), unknownKey: 'oops' };
    expect(() => validateSettings(s)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknownKey'));
    warn.mockRestore();
  });

  test('validateSettingsStrict: unknown top-level key throws', () => {
    const s = { ...validSettings(), unknownKey: 'oops' };
    expect(() => validateSettingsStrict(s)).toThrow(/unknownKey/);
  });

  test('invalid category name in customRules is skipped with warning', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const s = validSettings();
    s.customRules = [{ id: 'rule_1', enabled: true, type: 'sender_email', value: 'x@y.com', action: 'badcategory' }];
    const result = validateSettings(s);
    expect(result.customRules).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test('custom rule with empty value is skipped with warning', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const s = validSettings();
    s.customRules = [{ id: 'rule_1', enabled: true, type: 'sender_email', value: '  ', action: 'todo' }];
    const result = validateSettings(s);
    expect(result.customRules).toHaveLength(0);
    warn.mockRestore();
  });

  test('duplicate custom rule ID: second entry skipped with warning', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const s = validSettings();
    s.customRules = [
      { id: 'rule_1', enabled: true, type: 'sender_email', value: 'a@b.com', action: 'todo' },
      { id: 'rule_1', enabled: true, type: 'sender_email', value: 'c@d.com', action: 'fyi' },
    ];
    const result = validateSettings(s);
    expect(result.customRules).toHaveLength(1);
    expect(result.customRules[0].value).toBe('a@b.com');
    warn.mockRestore();
  });

  test('topic label with empty patterns skipped with warning', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const s = validSettings();
    s.topicLabels = [{ id: 'l1', key: 'billing', patterns: [], mapsToCategory: 'notification', enabled: true }];
    const result = validateSettings(s);
    expect(result.topicLabels).toHaveLength(0);
    warn.mockRestore();
  });

  test('duplicate topic label key: second skipped with warning', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const s = validSettings();
    s.topicLabels = [
      { id: 'l1', key: 'billing', patterns: ['invoice'], mapsToCategory: 'notification', enabled: true },
      { id: 'l2', key: 'billing', patterns: ['payment'], mapsToCategory: 'marketing', enabled: true },
    ];
    const result = validateSettings(s);
    expect(result.topicLabels).toHaveLength(1);
    warn.mockRestore();
  });

  test('topicLabelsGloballyEnabled absent defaults to true', () => {
    const s = validSettings();
    delete s.topicLabelsGloballyEnabled;
    const result = validateSettings(s);
    expect(result.topicLabelsGloballyEnabled).toBe(true);
  });
});
