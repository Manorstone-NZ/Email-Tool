const { filterLogs, shouldAppendLiveEvent } = require('../public/log-helpers');

test('shouldAppendLiveEvent returns false when live mode is disabled', () => {
  expect(shouldAppendLiveEvent(false)).toBe(false);
});

test('filterLogs filters by type and search', () => {
  const logs = [{ type: 'automation', action: 'triage', details: { subject: 'hello' }, timestamp: '2026-04-12T10:00:00.000Z' }];
  expect(filterLogs(logs, { search: 'hello', type: 'automation', window: '24h' })).toHaveLength(1);
  expect(filterLogs(logs, { search: 'missing', type: 'automation', window: '24h' })).toHaveLength(0);
});
