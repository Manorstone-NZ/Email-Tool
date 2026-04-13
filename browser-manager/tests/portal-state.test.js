const { normalizeRoute, writeEmailUiState, mergeEmailUiState } = require('../public/portal-state');

test('normalizeRoute falls back to email', () => {
  expect(normalizeRoute('#unknown')).toBe('email');
});

test('mergeEmailUiState overlays pinned and done by id', () => {
  const items = [{ id: 'a', flagged: true }, { id: 'b' }];
  const persisted = { a: { pinned: true, done: false, updatedAt: '2026-04-12T00:00:00.000Z' } };
  expect(mergeEmailUiState(items, persisted)[0].uiState.pinned).toBe(true);
  expect(mergeEmailUiState(items, persisted)[0].uiState.flagged).toBe(true);
  expect(mergeEmailUiState(items, persisted)[1].uiState.done).toBe(false);
  expect(mergeEmailUiState(items, persisted)[1].uiState.flagged).toBe(false);
});

test('mergeEmailUiState treats flagged server items as pinned when no local pin exists', () => {
  const items = [{ id: 'a', flagged: true }];
  const persisted = {};

  const merged = mergeEmailUiState(items, persisted);
  expect(merged[0].uiState.flagged).toBe(true);
  expect(merged[0].uiState.pinned).toBe(true);
});

test('mergeEmailUiState never writes flagged state from persisted storage', () => {
  const items = [{ id: 'a', flagged: false }];
  const persisted = { a: { pinned: false, done: false, flagged: true, updatedAt: '2026-04-12T00:00:00.000Z' } };
  expect(mergeEmailUiState(items, persisted)[0].uiState.flagged).toBe(false);
});

test('writeEmailUiState does not throw when localStorage setItem fails', () => {
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const originalLocalStorage = global.localStorage;

  global.localStorage = {
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  };

  expect(() => writeEmailUiState({ a: { pinned: true } })).not.toThrow();
  expect(warnSpy).toHaveBeenCalled();

  global.localStorage = originalLocalStorage;
  warnSpy.mockRestore();
});

describe('route session state', () => {
  let state;

  beforeEach(() => {
    jest.resetModules();
    state = require('../public/portal-state');
  });

  test('active route defaults to email', () => {
    expect(state.getActiveRoute()).toBe('email');
  });

  test('setActiveRoute updates active route', () => {
    state.setActiveRoute('settings');
    expect(state.getActiveRoute()).toBe('settings');
  });

  test('setActiveRoute falls back to email for unknown routes', () => {
    state.setActiveRoute('unknown');
    expect(state.getActiveRoute()).toBe('email');
  });

  test('settings tab defaults to general', () => {
    expect(state.getSettingsTab()).toBe('general');
  });

  test('setSettingsTab persists across route changes', () => {
    state.setSettingsTab('categorization');
    state.setActiveRoute('email');
    state.setActiveRoute('settings');
    expect(state.getSettingsTab()).toBe('categorization');
  });
});
