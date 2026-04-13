const { parseStructuredJson } = require('./ai-json');

class LmStudioProvider {
  constructor(options = {}) {
    this.name = 'gemma-lmstudio';
    this.baseUrl = options.baseUrl || process.env.LMSTUDIO_BASE_URL || 'http://127.0.0.1:1234/v1';
    this.model = options.model || process.env.LMSTUDIO_MODEL || 'gemma-4';
    this.timeoutMs = Number(options.timeoutMs || process.env.LMSTUDIO_TIMEOUT_MS || 25000);
  }

  isConfigured() {
    return Boolean(this.baseUrl);
  }

  async completeJson(systemPrompt, userPrompt) {
    if (!this.isConfigured()) {
      throw new Error('LM Studio provider not configured');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`LM Studio HTTP ${response.status}: ${text.slice(0, 300)}`);
      }

      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content || '';
      return parseStructuredJson(text);
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = LmStudioProvider;
