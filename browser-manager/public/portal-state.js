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
        pinned: Boolean(localState && localState.pinned),
        done: Boolean(localState && localState.done),
      },
    };
  });
}

const api = {
  normalizeRoute,
  readEmailUiState,
  writeEmailUiState,
  mergeEmailUiState,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof window !== 'undefined') {
  window.PortalState = api;
}
