const { filterLogs, matchesLogWindow, shouldAppendLiveEvent } = require('../public/log-helpers');

test('shouldAppendLiveEvent returns false when live mode is disabled', () => {
  expect(shouldAppendLiveEvent(false)).toBe(false);
});

test('filterLogs filters by type and search', () => {
  const now = new Date('2026-04-12T11:00:00.000Z');
  const logs = [{ type: 'automation', action: 'triage', details: { subject: 'hello' }, timestamp: '2026-04-12T10:00:00.000Z' }];
  expect(filterLogs(logs, { search: 'hello', type: 'automation', window: '24h' }, now)).toHaveLength(1);
  expect(filterLogs(logs, { search: 'missing', type: 'automation', window: '24h' }, now)).toHaveLength(0);
});

test('matchesLogWindow excludes future timestamps', () => {
  const now = new Date('2026-04-12T10:00:00.000Z');
  const futureLog = { timestamp: '2026-04-12T10:05:00.000Z' };
  expect(matchesLogWindow(futureLog, '24h', now)).toBe(false);
});

test('filterLogs tolerates circular details during search', () => {
  const now = new Date('2026-04-12T10:10:00.000Z');
  const circularDetails = {};
  circularDetails.self = circularDetails;

  const logs = [{ type: 'automation', action: 'triage', details: circularDetails, timestamp: '2026-04-12T10:00:00.000Z' }];

  expect(() => filterLogs(logs, { search: 'triage', type: 'automation', window: '24h' }, now)).not.toThrow();
  expect(filterLogs(logs, { search: 'triage', type: 'automation', window: '24h' }, now)).toHaveLength(1);
});
