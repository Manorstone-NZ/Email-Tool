const GraphTokenStore = require('./graph-token-store');
const { ensureSendable } = require('./approval-service');

class SendService {
  constructor(options = {}) {
    this.tokenStore = options.tokenStore || new GraphTokenStore();
    this.baseUrl = options.baseUrl || process.env.GRAPH_BASE_URL || 'https://graph.microsoft.com/v1.0';
    this.user = options.user || process.env.GRAPH_USER || 'me';
    this.eventLogger = options.eventLogger || null;
  }

  async sendApprovedDraft(draft, email) {
    ensureSendable(draft);

    const recipient = String(email?.sender || '').trim();
    if (!recipient) {
      throw new Error('Recipient is required for send');
    }

    const token = this.tokenStore.getAccessToken();
    if (!token) {
      throw new Error('Graph access token missing');
    }

    const userPath = this.user === 'me' ? '/me' : `/users/${encodeURIComponent(this.user)}`;
    const url = `${this.baseUrl}${userPath}/sendMail`;

    const payload = {
      message: {
        subject: draft.subject,
        body: {
          contentType: 'Text',
          content: draft.body,
        },
        toRecipients: [{
          emailAddress: {
            address: recipient,
          },
        }],
      },
      saveToSentItems: true,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      if (response.status === 403 && /ErrorAccessDenied|Access is denied/i.test(text)) {
        throw new Error(
          `Graph sendMail failed (403): Access denied. Re-run npm run graph-auth with Mail.Send scope and re-consent for this app. Raw response: ${text.slice(0, 300)}`
        );
      }
      throw new Error(`Graph sendMail failed (${response.status}): ${text.slice(0, 300)}`);
    }

    if (this.eventLogger) {
      this.eventLogger.logAutomationEvent('email-draft-send-success', {
        emailId: draft.emailId,
        recipient,
        statusCode: response.status,
      });
    }

    return {
      success: true,
      statusCode: response.status,
      recipient,
    };
  }
}

module.exports = SendService;
