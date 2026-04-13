const GraphTokenStore = require('./graph-token-store');

class GraphEmailExtractor {
  constructor(options = {}) {
    this.providerName = 'graph';
    this.accessToken = options.accessToken || process.env.GRAPH_ACCESS_TOKEN || '';
    this.tokenStore = options.tokenStore || new GraphTokenStore();
    this.baseUrl = options.baseUrl || process.env.GRAPH_BASE_URL || 'https://graph.microsoft.com/v1.0';
    this.user = options.user || process.env.GRAPH_USER || 'me';
    this.maxItems = Number(options.maxItems || process.env.GRAPH_MAX_ITEMS || 50);
    const lookbackRaw = options.lookbackDays || process.env.GRAPH_LOOKBACK_DAYS || 3;
    const parsedLookback = Number(lookbackRaw);
    this.lookbackDays = Number.isFinite(parsedLookback)
      ? Math.max(1, Math.min(60, parsedLookback))
      : 3;
  }

  getAccessToken() {
    if (this.accessToken) {
      return this.accessToken;
    }
    return this.tokenStore.getAccessToken();
  }

  decodeHtmlEntities(text) {
    const source = String(text || '');
    const named = {
      nbsp: ' ',
      amp: '&',
      lt: '<',
      gt: '>',
      quot: '"',
      apos: "'",
    };

    return source.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_, token) => {
      if (!token) return _;
      const lower = token.toLowerCase();

      if (lower[0] === '#') {
        const isHex = lower[1] === 'x';
        const numeric = isHex ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
        return Number.isFinite(numeric) ? String.fromCharCode(numeric) : _;
      }

      return Object.prototype.hasOwnProperty.call(named, lower) ? named[lower] : _;
    });
  }

  htmlToReadableText(html) {
    let text = String(html || '');

    text = text
      .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, ' ');

    text = this.decodeHtmlEntities(text)
      .replace(/\r/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([.,!?;:])/g, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return text;
  }

  extractBodyText(message) {
    const fullBody = String(message?.body?.content || '').trim();
    if (!fullBody) {
      return String(message?.bodyPreview || '').trim();
    }

    const contentType = String(message?.body?.contentType || '').toLowerCase();
    if (contentType === 'html') {
      return this.htmlToReadableText(fullBody);
    }

    return fullBody;
  }

  normalizeMessage(message) {
    const sender = message?.from?.emailAddress?.address || '';
    const subject = message?.subject || '';
    const searchQuery = encodeURIComponent([sender, subject].filter(Boolean).join(' '));
    const senderDomain = sender.includes('@') ? sender.split('@')[1].toLowerCase() : '';

    const body = this.extractBodyText(message);
    const preview = String(message?.bodyPreview || body).slice(0, 200);

    return {
      messageId: message?.id || '',
      sender,
      senderEmail: sender.toLowerCase(),
      senderDomain,
      subject,
      body,
      preview,
      flagged: (message?.flag?.flagStatus || '').toLowerCase() === 'flagged',
      read: Boolean(message?.isRead),
      timestamp: message?.receivedDateTime || new Date().toISOString(),
      threadId: message?.conversationId || message?.id || `thread_${Date.now()}`,
      openUrl: message?.webLink || `https://outlook.office.com/mail/search?q=${searchQuery}`
    };
  }

  isWithinLookbackDays(timestamp, nowMs = Date.now()) {
    const ts = new Date(timestamp).getTime();
    const windowMs = this.lookbackDays * 24 * 60 * 60 * 1000;
    return Number.isFinite(ts) && nowMs - ts <= windowMs;
  }

  async getInboxEmails() {
    const accessToken = this.getAccessToken();

    if (!accessToken) {
      return [];
    }

    const userPath = this.user === 'me'
      ? '/me'
      : `/users/${encodeURIComponent(this.user)}`;

    const url = `${this.baseUrl}${userPath}/mailFolders/inbox/messages` +
      `?$top=${this.maxItems}` +
      '&$select=id,subject,bodyPreview,body,from,isRead,receivedDateTime,conversationId,flag,webLink';

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Graph API request failed with status ${response.status}`);
      }

      const payload = await response.json();
      const messages = Array.isArray(payload?.value) ? payload.value : [];
      const normalized = messages.map((message) => this.normalizeMessage(message));

      return normalized.filter((email) => this.isWithinLookbackDays(email.timestamp) || email.flagged);
    } catch (error) {
      console.error('[GraphEmailExtractor] Failed to fetch inbox messages:', error.message);
      return [];
    }
  }

  async getEmails() {
    return this.getInboxEmails();
  }
}

module.exports = GraphEmailExtractor;
