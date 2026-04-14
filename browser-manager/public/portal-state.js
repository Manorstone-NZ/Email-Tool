(() => {
let constants = {
  ROUTES: ['email', 'logs', 'settings'],
  EMAIL_STATE_STORAGE_KEY: 'portal.email.state.v1',
};

if (typeof module !== 'undefined' && module.exports) {
  constants = require('./portal-constants');
} else if (typeof window !== 'undefined' && window.PortalConstants) {
  constants = window.PortalConstants;
}

function normalizeRoute(hash) {
  const route = String(hash || '').replace(/^#/, '');
  return constants.ROUTES.includes(route) ? route : 'email';
}

// ── Session route state (in-memory, not persisted) ─────────────────────────
const routeSession = {
  active: 'email',
  settingsTab: 'general',
  categorizationTab: 'general',
  settingsDirty: false,
};

function setActiveRoute(route) {
  routeSession.active = constants.ROUTES.includes(route) ? route : 'email';
}

function getActiveRoute() {
  return routeSession.active;
}

function setSettingsTab(tab) {
  routeSession.settingsTab = String(tab || 'general');
}

function getSettingsTab() {
  return routeSession.settingsTab;
}

function setCategorizationTab(tab) {
  routeSession.categorizationTab = String(tab || 'general');
}

function getCategorizationTab() {
  return routeSession.categorizationTab;
}

function setSettingsDirty(value) {
  routeSession.settingsDirty = Boolean(value);
}

function isSettingsDirty() {
  return Boolean(routeSession.settingsDirty);
}

function readEmailUiState() {
  if (typeof localStorage === 'undefined') {
    return {};
  }

  try {
    const raw = localStorage.getItem(constants.EMAIL_STATE_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_err) {
    return {};
  }
}

function writeEmailUiState(state) {
  if (typeof localStorage === 'undefined') {
    return;
  }

  const raw = state && typeof state === 'object' ? state : {};
  const safeState = {};
  for (const id of Object.keys(raw)) {
    const e = raw[id];
    safeState[id] = {
      pinned: Boolean(e.pinned),
      done: Boolean(e.done),
      updatedAt: e.updatedAt || new Date().toISOString()
    };
  }
  try {
    localStorage.setItem(constants.EMAIL_STATE_STORAGE_KEY, JSON.stringify(safeState));
  } catch (err) {
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn('Unable to persist email UI state', err);
    }
  }
}

function mergeEmailUiState(items, persisted) {
  const safeItems = Array.isArray(items) ? items : [];
  const safePersisted = persisted && typeof persisted === 'object' ? persisted : {};

  return safeItems.map((item) => {
    const localState = item && item.id ? safePersisted[item.id] : null;
    return {
      ...item,
      uiState: {
        flagged: Boolean(item && item.flagged),
        pinned: Boolean(
          (localState && localState.pinned)
          || (item && item.pinned)
          || (item && item.flagged)
        ),
        done: Boolean(localState && localState.done),
      },
    };
  });
}

function getGroupByPriority() {
  try { return localStorage.getItem('portal.groupByPriority') !== 'false'; } catch { return true; }
}

function setGroupByPriority(value) {
  try { localStorage.setItem('portal.groupByPriority', value ? 'true' : 'false'); } catch {}
}

const api = {
  normalizeRoute,
  readEmailUiState,
  writeEmailUiState,
  mergeEmailUiState,
  setActiveRoute,
  getActiveRoute,
  setSettingsTab,
  getSettingsTab,
  setCategorizationTab,
  getCategorizationTab,
  setSettingsDirty,
  isSettingsDirty,
  getGroupByPriority,
  setGroupByPriority,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof window !== 'undefined') {
  window.PortalState = api;
}
})();
