const {
  mapEmailItem,
  deriveRecommendedAction,
  derivePrimaryCategory,
  deriveEmailTags,
  deriveScoreMeta,
  filterEmailItems,
  resolveDisplayTimestamp,
  warnIfLargeEmailList,
  countEmailBuckets,
} = require('../public/email-helpers');

test('deriveRecommendedAction falls back to Review', () => {
  expect(deriveRecommendedAction({ action: 'Weird Value' })).toBe('Review');
});

test('deriveScoreMeta returns secondary confidence display from numeric score', () => {
  expect(deriveScoreMeta({ score: 41 })).toEqual({ score: 41, confidenceText: '41%' });
});

test('mapEmailItem uses stable id fallback from sender and subject', () => {
  const mapped = mapEmailItem({ sender: 'a@b.com', subject: 'Hello', body: 'x', score: 41, reason: 'Unread' }, '2026-04-12T09:00:00.000Z');
  expect(mapped.id).toBeDefined();
  expect(mapped.ingestedAt).toBe('2026-04-12T09:00:00.000Z');
});

test('mapEmailItem generates the same fallback id for the same sender and subject', () => {
  const first = mapEmailItem({ sender: 'a@b.com', subject: 'Hello', body: 'x', score: 41, reason: 'Unread' }, '2026-04-12T09:00:00.000Z');
  const second = mapEmailItem({ sender: 'a@b.com', subject: 'Hello', body: 'changed', score: 41, reason: 'Unread' }, '2026-04-12T09:30:00.000Z');
  expect(first.id).toBe(second.id);
});

test('resolveDisplayTimestamp prefers source timestamp over ingestedAt', () => {
  const resolved = resolveDisplayTimestamp({ timestamp: '2026-04-12T08:00:00.000Z', ingestedAt: '2026-04-12T09:00:00.000Z' });
  expect(resolved.value).toBe('2026-04-12T08:00:00.000Z');
});

test('resolveDisplayTimestamp falls back to ingestedAt when source timestamp is null', () => {
  const resolved = resolveDisplayTimestamp({ timestamp: null, ingestedAt: '2026-04-12T09:00:00.000Z' });
  expect(resolved.value).toBe('2026-04-12T09:00:00.000Z');
});

test('filterEmailItems excludes done items unless done filter is active', () => {
  const items = [{ id: 'a', primaryCategory: 'Needs Reply', tags: [], uiState: { done: true, pinned: false, flagged: false } }];
  expect(filterEmailItems(items, { search: '', category: null, state: null, tag: null })).toHaveLength(0);
  expect(filterEmailItems(items, { search: '', category: null, state: 'Done', tag: null })).toHaveLength(1);
});

test('warnIfLargeEmailList warns when item count exceeds 500', () => {
  const warn = jest.fn();
  warnIfLargeEmailList(new Array(501).fill({}), warn);
  expect(warn).toHaveBeenCalled();
});
