(() => {
function toPositiveInt(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return fallback;
  }
  return Math.floor(num);
}

function calculateEditorRows(text, options = {}) {
  const minRows = toPositiveInt(options.minRows, 10);
  const maxRows = toPositiveInt(options.maxRows, 24);
  const paddingRows = toPositiveInt(options.paddingRows, 2);

  const content = String(text || '');
  const lineCount = content ? content.split(/\r\n|\r|\n/).length : 1;
  const requested = lineCount + paddingRows;

  return Math.min(maxRows, Math.max(minRows, requested));
}

const api = {
  calculateEditorRows,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}

if (typeof window !== 'undefined') {
  window.DraftEditorHelpers = api;
}
})();
