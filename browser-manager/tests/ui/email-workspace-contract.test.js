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
});