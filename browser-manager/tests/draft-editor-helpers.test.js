const { calculateEditorRows } = require('../public/draft-editor-helpers');

test('calculateEditorRows uses minimum rows for short drafts', () => {
  expect(calculateEditorRows('Hi Joel,')).toBe(10);
});

test('calculateEditorRows scales with multiline content and padding', () => {
  const body = ['Line 1', 'Line 2', 'Line 3', 'Line 4', 'Line 5'].join('\n');
  expect(calculateEditorRows(body, { minRows: 4, paddingRows: 2, maxRows: 24 })).toBe(7);
});

test('calculateEditorRows clamps to max rows for very long drafts', () => {
  const longBody = new Array(100).fill('x').join('\n');
  expect(calculateEditorRows(longBody)).toBe(24);
});
