function extractJsonCandidate(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';

  if (raw.startsWith('{') && raw.endsWith('}')) {
    return raw;
  }

  const match = raw.match(/\{[\s\S]*\}/);
  return match ? match[0] : '';
}

function parseStructuredJson(text) {
  const candidate = extractJsonCandidate(text);
  if (!candidate) {
    throw new Error('No JSON object found in model output');
  }

  try {
    const parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Parsed JSON is not an object');
    }
    return parsed;
  } catch (err) {
    throw new Error(`Invalid JSON output: ${err.message}`);
  }
}

module.exports = {
  parseStructuredJson,
};
