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
  getCategoryColor,
  getPrioritizedReaderMetadata,
  avatarColor,
  scoreToHeatColor,
  groupByPriorityTier,
} = require('../public/email-helpers');

const { AVATAR_PALETTE } = require('../public/portal-constants');

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

test('mapEmailItem preserves an existing message id instead of replacing it with threadId', () => {
  const mapped = mapEmailItem({
    id: 'msg-123',
    messageId: 'msg-123',
    threadId: 'conv-456',
    sender: 'a@b.com',
    subject: 'Hello',
    body: 'x',
    score: 41,
    reason: 'Unread',
  }, '2026-04-12T09:00:00.000Z');

  expect(mapped.id).toBe('msg-123');
});

test('mapEmailItem trusts valid AI primaryCategory and marks categorySource as ai', () => {
  const mapped = mapEmailItem({
    sender: 'a@b.com',
    subject: 'Hello',
    body: 'x',
    score: 41,
    reason: 'Unread',
    primaryCategory: 'Waiting on Others',
  }, '2026-04-12T09:00:00.000Z');

  expect(mapped.primaryCategory).toBe('Waiting on Others');
  expect(mapped.categorySource).toBe('ai');
});

test('mapEmailItem falls back to heuristic category and marks categorySource as heuristic', () => {
  const mapped = mapEmailItem({
    sender: 'a@b.com',
    subject: 'Hello',
    body: 'x',
    score: 41,
    action: 'Review / Respond',
    reason: 'Direct ask for action',
    primaryCategory: null,
  }, '2026-04-12T09:00:00.000Z');

  expect(mapped.primaryCategory).toBe('Needs Reply');
  expect(mapped.categorySource).toBe('heuristic');
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

test('filterEmailItems shows flagged items even when a category filter is active', () => {
  const items = [
    { id: 'a', primaryCategory: 'FYI', tags: [], uiState: { done: false, pinned: false, flagged: true } },
    { id: 'b', primaryCategory: 'Waiting on Others', tags: [], uiState: { done: false, pinned: false, flagged: false } },
  ];

  const filtered = filterEmailItems(items, {
    search: '',
    category: 'Waiting on Others',
    state: 'Flagged',
    tag: null,
  });

  expect(filtered).toHaveLength(1);
  expect(filtered[0].id).toBe('a');
});

test('warnIfLargeEmailList warns when item count exceeds 500', () => {
  const warn = jest.fn();
  warnIfLargeEmailList(new Array(501).fill({}), warn);
  expect(warn).toHaveBeenCalled();
});

test('countEmailBuckets computes counts after search scope', () => {
  const items = [
    { sender: 'Vendor', subject: 'Quote', preview: 'Approval needed', primaryCategory: 'Needs Reply', tags: ['Vendor', 'Approval'], uiState: { flagged: false, pinned: false, done: false } },
  ];
  const counts = countEmailBuckets(items, { search: 'quote' });
  expect(counts.categories['Needs Reply']).toBe(1);
});

test('uses design-system category colors, not backend tag values', () => {
  expect(getCategoryColor('Needs Reply')).toMatchObject({ fg: '#9b3c3c', accent: '#c0564a' });
  expect(getCategoryColor('Waiting on Others')).toMatchObject({ fg: '#8b6a2f', accent: '#b8860b' });
  expect(getCategoryColor('FYI')).toMatchObject({ fg: '#4a6380', accent: '#4a6380' });
});

test('truncates lower-priority metadata before category and recommended action', () => {
  const metadata = getPrioritizedReaderMetadata({
    primaryCategory: 'Needs Reply',
    recommendedAction: 'Review / Respond',
    urgency: 'High',
    categorySource: 'heuristic',
    scoreMeta: { confidenceText: '92%' },
  }, { maxEntries: 2 });

  expect(metadata.map((entry) => entry.key)).toEqual(['category', 'recommendedAction']);
});

describe('avatarColor', () => {
  it('returns a palette entry for a name', () => {
    const result = avatarColor('Sarah Chen');
    expect(result).toHaveProperty('bg');
    expect(result).toHaveProperty('fg');
  });
  it('returns consistent color for same name', () => {
    expect(avatarColor('Sarah Chen')).toEqual(avatarColor('Sarah Chen'));
  });
  it('handles empty string', () => {
    const result = avatarColor('');
    expect(AVATAR_PALETTE).toContainEqual(result);
  });
});

describe('scoreToHeatColor', () => {
  it('returns hot color for score >= 80', () => {
    expect(scoreToHeatColor(85)).toBe('#c0564a');
  });
  it('returns warm color for score 60-79', () => {
    expect(scoreToHeatColor(65)).toBe('#d4a030');
  });
  it('returns cool color for low scores', () => {
    expect(scoreToHeatColor(25)).toBe('#e0dbd4');
  });
});

describe('groupByPriorityTier', () => {
  it('groups items into tiers', () => {
    const items = [
      { urgency: 'high', score: 85 },
      { urgency: 'medium', score: 55 },
      { urgency: 'low', score: 30 },
    ];
    const groups = groupByPriorityTier(items);
    expect(groups[0].key).toBe('act-now');
    expect(groups[0].items).toHaveLength(1);
    expect(groups[1].key).toBe('review');
    expect(groups[2].key).toBe('low');
  });
  it('omits empty tiers', () => {
    const items = [{ urgency: 'low', score: 30 }];
    const groups = groupByPriorityTier(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('low');
  });
});
