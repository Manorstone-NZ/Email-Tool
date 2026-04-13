const fs = require('fs');
const path = require('path');

describe('Email workspace contract', () => {
  test('index declares filter rail, inbox list, and reader pane regions', () => {
    const indexPath = path.join(__dirname, '../../public/index.html');
    const html = fs.readFileSync(indexPath, 'utf8');

    expect(html).toContain('class="email-filter-rail"');
    expect(html).toContain('data-region="filter-rail"');
    expect(html).toContain('class="email-inbox-list"');
    expect(html).toContain('data-region="inbox-list"');
    expect(html).toContain('class="email-reader-pane"');
    expect(html).toContain('data-region="reader-pane"');
  });

  test('selects first visible email when there is no current selection', () => {
    const { resolveSelectedEmailId } = require('../../public/app.js');
    const selected = resolveSelectedEmailId(null, [{ id: 'email-1' }, { id: 'email-2' }]);
    expect(selected).toBe('email-1');
  });

  test('reselects first visible email when current selection is no longer visible', () => {
    const { resolveSelectedEmailId } = require('../../public/app.js');
    const selected = resolveSelectedEmailId('email-3', [{ id: 'email-1' }, { id: 'email-2' }]);
    expect(selected).toBe('email-1');
  });

  test('clears selection when visible list is empty', () => {
    const { resolveSelectedEmailId } = require('../../public/app.js');
    const selected = resolveSelectedEmailId('email-1', []);
    expect(selected).toBe(null);
  });

  test('applies search before category/state filters on same dataset', () => {
    const { applyEmailFilters } = require('../../public/app.js');
    const items = [
      {
        id: '1',
        subject: 'Invoice requires review',
        primaryCategory: 'Needs Reply',
        stateLabel: 'Pinned',
      },
      {
        id: '2',
        subject: 'Team offsite',
        primaryCategory: 'Needs Reply',
        stateLabel: 'Pinned',
      },
      {
        id: '3',
        subject: 'Invoice paid confirmation',
        primaryCategory: 'FYI',
        stateLabel: 'Pinned',
      },
    ];

    const result = applyEmailFilters(items, {
      search: 'invoice',
      category: 'Needs Reply',
      state: 'Pinned',
      tag: null,
    });

    expect(result.map((item) => item.id)).toEqual(['1']);
    expect(result.every((item) => item.subject.toLowerCase().includes('invoice'))).toBe(true);
  });

  test('renders distinct fetch-error state from no-results state', () => {
    const { resolveEmptyStateMessage } = require('../../public/app.js');

    const errorText = resolveEmptyStateMessage({
      triageError: 'Unable to load messages',
      filters: { search: 'invoice', category: null, state: null, tag: null },
    });
    const noResultsText = resolveEmptyStateMessage({
      triageError: null,
      filters: { search: 'invoice', category: null, state: null, tag: null },
    });

    expect(errorText).toContain('Unable to load messages');
    expect(errorText).not.toContain('No messages match current filters');
    expect(noResultsText).toBe('No messages match current filters');
  });

  test('reader metadata strip is wrap-based and constrained to two lines on desktop', () => {
    const { createReaderMetadataStrip } = require('../../public/app.js');
    const strip = createReaderMetadataStrip({
      primaryCategory: 'Needs Reply',
      recommendedAction: 'Review / Respond',
      urgency: 'High',
      categorySource: 'heuristic',
      scoreMeta: { confidenceText: '92%' },
    });

    expect(strip.classList.contains('reader-meta-strip')).toBe(true);
    expect(strip.dataset.maxLines).toBe('2');
    expect(strip.querySelectorAll('.meta-priority-high').length).toBeGreaterThan(0);
  });

  test('reader metadata keeps category and recommended action visible before lower-priority keys', () => {
    const { getVisibleMetadataKeys } = require('../../public/app.js');
    const keys = getVisibleMetadataKeys({
      primaryCategory: 'Needs Reply',
      recommendedAction: 'Review / Respond',
      urgency: 'High',
      categorySource: 'heuristic',
      scoreMeta: { confidenceText: '92%' },
    }, { maxEntries: 2 });

    expect(keys).toContain('category');
    expect(keys).toContain('recommendedAction');
    expect(keys).not.toContain('urgency');
  });
});