const { parseStructuredJson } = require('./ai-json');

class OpenAiProvider {
  constructor(options = {}) {
    this.name = 'openai-gpt54';
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY || '';
    this.baseUrl = options.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    this.model = options.model || process.env.OPENAI_MODEL || 'gpt-5.4';
    this.timeoutMs = Number(options.timeoutMs || process.env.OPENAI_TIMEOUT_MS || 20000);
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  async completeJson(systemPrompt, userPrompt) {
    if (!this.isConfigured()) {
      throw new Error('OpenAI provider not configured (missing OPENAI_API_KEY)');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
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
        throw new Error(`OpenAI HTTP ${response.status}: ${text.slice(0, 300)}`);
      }

      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content || '';
      return parseStructuredJson(text);
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = OpenAiProvider;