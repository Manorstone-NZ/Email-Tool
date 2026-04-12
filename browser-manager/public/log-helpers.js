function shouldAppendLiveEvent(liveEnabled) {
  return Boolean(liveEnabled);
}

function matchesLogWindow(log, windowValue, now) {
  if (windowValue === 'all') {
    return true;
  }

  const dateNow = now instanceof Date ? now : new Date();
  const timestamp = new Date(log && log.timestamp);

  if (Number.isNaN(timestamp.getTime())) {
    return false;
  }

  const ageMs = dateNow.getTime() - timestamp.getTime();
  const windowToMs = {
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
  };

  const limit = windowToMs[windowValue] || windowToMs['24h'];
  return ageMs <= limit;
}

function filterLogs(logs, filters, now) {
  const safeLogs = Array.isArray(logs) ? logs : [];
  const safeFilters = filters || {};
  const searchText = String(safeFilters.search || '').toLowerCase().trim();
  const windowValue = safeFilters.window || '24h';
  const nowDate = now instanceof Date ? now : new Date();

  return safeLogs
    .filter((log) => {
      if (!searchText) {
        return true;
      }
      const action = String((log && log.action) || '').toLowerCase();
      const details = JSON.stringify((log && log.details) || {}).toLowerCase();
      return `${action} ${details}`.includes(searchText);
    })
    .filter((log) => {
      if (!safeFilters.type || safeFilters.type === 'all') {
        return true;
      }
      return (log && log.type) === safeFilters.type;
    })
    .filter((log) => matchesLogWindow(log, windowValue, nowDate));
}

const api = {
  filterLogs,
  matchesLogWindow,
  shouldAppendLiveEvent,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof window !== 'undefined') {
  window.LogHelpers = api;
}
