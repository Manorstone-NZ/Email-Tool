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

// Time window filtering tests
test('filterLogs respects 15m window - includes logs within 15 minutes', () => {
  const now = new Date('2026-04-12T10:30:00.000Z');
  const logs = [
    { type: 'automation', action: 'action1', details: {}, timestamp: '2026-04-12T10:20:00.000Z' }, // 10m old - within 15m
    { type: 'automation', action: 'action2', details: {}, timestamp: '2026-04-12T10:16:00.000Z' }, // 14m old - within 15m
  ];
  const result = filterLogs(logs, { window: '15m' }, now);
  expect(result).toHaveLength(2);
});

test('filterLogs respects 15m window - excludes logs older than 15 minutes', () => {
  const now = new Date('2026-04-12T10:30:00.000Z');
  const logs = [
    { type: 'automation', action: 'action1', details: {}, timestamp: '2026-04-12T10:14:00.000Z' }, // 16m old - outside 15m
    { type: 'automation', action: 'action2', details: {}, timestamp: '2026-04-12T10:10:00.000Z' }, // 20m old - outside 15m
  ];
  const result = filterLogs(logs, { window: '15m' }, now);
  expect(result).toHaveLength(0);
});

test('filterLogs respects 1h window - includes logs within 1 hour', () => {
  const now = new Date('2026-04-12T10:30:00.000Z');
  const logs = [
    { type: 'user', action: 'action1', details: {}, timestamp: '2026-04-12T10:00:00.000Z' }, // 30m old - within 1h
    { type: 'user', action: 'action2', details: {}, timestamp: '2026-04-12T09:31:00.000Z' }, // 59m old - within 1h
  ];
  const result = filterLogs(logs, { window: '1h' }, now);
  expect(result).toHaveLength(2);
});

test('filterLogs respects 1h window - excludes logs older than 1 hour', () => {
  const now = new Date('2026-04-12T10:30:00.000Z');
  const logs = [
    { type: 'user', action: 'action1', details: {}, timestamp: '2026-04-12T09:29:00.000Z' }, // 61m old - outside 1h
    { type: 'user', action: 'action2', details: {}, timestamp: '2026-04-12T09:00:00.000Z' }, // 90m old - outside 1h
  ];
  const result = filterLogs(logs, { window: '1h' }, now);
  expect(result).toHaveLength(0);
});

test('filterLogs respects 24h window - includes logs within 24 hours', () => {
  const now = new Date('2026-04-12T10:30:00.000Z');
  const logs = [
    { type: 'automation', action: 'action1', details: {}, timestamp: '2026-04-11T10:30:00.000Z' }, // exactly 24h old - within 24h
    { type: 'automation', action: 'action2', details: {}, timestamp: '2026-04-11T11:00:00.000Z' }, // 23.5h old - within 24h
  ];
  const result = filterLogs(logs, { window: '24h' }, now);
  expect(result).toHaveLength(2);
});

test('filterLogs respects 24h window - excludes logs older than 24 hours', () => {
  const now = new Date('2026-04-12T10:30:00.000Z');
  const logs = [
    { type: 'automation', action: 'action1', details: {}, timestamp: '2026-04-11T10:29:00.000Z' }, // 24h 1m old - outside 24h
    { type: 'automation', action: 'action2', details: {}, timestamp: '2026-04-10T12:00:00.000Z' }, // 46.5h old - outside 24h
  ];
  const result = filterLogs(logs, { window: '24h' }, now);
  expect(result).toHaveLength(0);
});

test('filterLogs with "all" window includes all timestamps within valid range', () => {
  const now = new Date('2026-04-12T10:30:00.000Z');
  const logs = [
    { type: 'automation', action: 'action1', details: {}, timestamp: '2026-04-12T10:30:00.000Z' }, // now
    { type: 'user', action: 'action2', details: {}, timestamp: '2026-04-01T00:00:00.000Z' }, // 11 days old
    { type: 'automation', action: 'action3', details: {}, timestamp: '2025-01-01T00:00:00.000Z' }, // very old
  ];
  const result = filterLogs(logs, { window: 'all' }, now);
  expect(result).toHaveLength(3);
});
