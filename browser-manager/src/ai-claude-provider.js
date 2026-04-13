const { parseStructuredJson } = require('./ai-json');

class ClaudeProvider {
  constructor(options = {}) {
    this.name = 'claude-opus';
    this.apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY || '';
    this.baseUrl = options.baseUrl || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1';
    this.model = options.model || process.env.CLAUDE_MODEL || 'claude-3-opus-20240229';
    this.timeoutMs = Number(options.timeoutMs || process.env.CLAUDE_TIMEOUT_MS || 20000);
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  async completeJson(systemPrompt, userPrompt) {
    if (!this.isConfigured()) {
      throw new Error('Claude provider not configured (missing ANTHROPIC_API_KEY)');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 700,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Claude HTTP ${response.status}: ${text.slice(0, 300)}`);
      }

      const data = await response.json();
      const text = Array.isArray(data.content)
        ? data.content.map((item) => item && item.text ? item.text : '').join('\n')
        : '';

      return parseStructuredJson(text);
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = ClaudeProvider;
