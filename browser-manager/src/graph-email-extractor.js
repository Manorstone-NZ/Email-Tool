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

  normalizeMessage(message) {
    const sender = message?.from?.emailAddress?.address || '';
    const subject = message?.subject || '';
    const searchQuery = encodeURIComponent([sender, subject].filter(Boolean).join(' '));
    return {
      sender,
      subject,
      body: (message?.bodyPreview || '').slice(0, 200),
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
      '&$select=id,subject,bodyPreview,from,isRead,receivedDateTime,conversationId,flag,webLink';

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
}

module.exports = GraphEmailExtractor;
