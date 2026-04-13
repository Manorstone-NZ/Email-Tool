const { spawnSync } = require('child_process');

class EmailExtractor {
  constructor() {
    this.providerName = 'chrome';
    this.MS_PER_72_HOURS = 72 * 60 * 60 * 1000;
  }

  buildSearchUrl(email) {
    const sender = String(email?.sender || '').trim();
    const subject = String(email?.subject || '').trim();
    const query = [sender, subject].filter(Boolean).join(' ').trim();
    return `https://outlook.office.com/mail/search?q=${encodeURIComponent(query)}`;
  }

  isWithin72Hours(timestamp) {
    const emailTime = new Date(timestamp).getTime();
    const now = new Date().getTime();
    return (now - emailTime) <= this.MS_PER_72_HOURS;
  }

  parseEmailFromDOM(rawEmail) {
    // Parse format: KEY: VALUE pairs
    const lines = rawEmail.trim().split('\n');
    const parsed = {};

    lines.forEach(line => {
      const [key, ...valueParts] = line.split(':');
      const trimmedKey = key.trim();
      const value = valueParts.join(':').trim();
      
      if (trimmedKey === 'FROM') parsed.sender = value;
      else if (trimmedKey === 'SUBJECT') parsed.subject = value;
      else if (trimmedKey === 'BODY') parsed.body = value;
      else if (trimmedKey === 'FLAGGED') parsed.flagged = value === 'true';
      else if (trimmedKey === 'READ') parsed.read = value === 'true';
      else if (trimmedKey === 'TIMESTAMP') parsed.timestamp = value;
      else if (trimmedKey === 'THREAD_ID') parsed.threadId = value;
    });

    return parsed;
  }

  async getInboxEmails() {
    if (process.env.NODE_ENV === 'test') {
      return [];
    }

    // Scrape Outlook Web from the active Chrome tab.
    const script = `
tell application "Google Chrome"
  if (count of windows) = 0 then
    return "[]"
  end if
  set activeTab to active tab of front window
  set currentUrl to URL of activeTab
  if currentUrl does not contain "outlook" then
    return "[]"
  end if
  set js to "(() => { const rows = Array.from(document.querySelectorAll('[role=\\\"option\\\"]')).slice(0, 50); const payload = rows.map((row) => ({ aria: String(row.getAttribute('aria-label') || ''), text: String(row.innerText || '') })); return JSON.stringify(payload); })();"
  set jsonResult to execute activeTab javascript js
  return jsonResult
end tell
    `;

    try {
      const result = spawnSync('osascript', ['-'], {
        input: script,
        encoding: 'utf8'
      });

      if (result.status !== 0) {
        throw new Error(result.stderr || `osascript exited with status ${result.status}`);
      }

      const raw = (result.stdout || '').trim();
      if (!raw.startsWith('[')) {
        return [];
      }

      const parsed = JSON.parse(raw || '[]');
      const rows = Array.isArray(parsed) ? parsed : [];

      const clean = (line) => String(line || '').trim().replace(/\s+/g, ' ');
      const keep = (line) => {
        const t = clean(line);
        if (!t) return false;
        const isCounter = t.startsWith('(') && t.endsWith(')');
        return /[A-Za-z0-9]/.test(t) && !isCounter;
      };

      const emails = rows
        .map((row, idx) => {
          const aria = String(row.aria || '').toLowerCase();
          const lines = String(row.text || '')
            .split('\n')
            .map(clean)
            .filter(keep);

          if (lines.length < 2) {
            return null;
          }

          return {
            sender: lines[0],
            senderEmail: lines[0].toLowerCase(),
            senderDomain: lines[0].includes('@') ? lines[0].split('@')[1].toLowerCase() : '',
            subject: lines[1],
            body: lines.slice(2).join(' ').slice(0, 200),
            flagged: aria.includes('flagged'),
            read: !aria.includes('unread'),
            timestamp: new Date().toISOString(),
            threadId: `thread_${idx}_${Date.now()}`,
            openUrl: this.buildSearchUrl({ sender: lines[0], subject: lines[1] })
          };
        })
        .filter(Boolean);

      return emails;
    } catch (error) {
      console.error('[EmailExtractor] Failed to extract emails:', error.message);
      return [];
    }
  }

  async getEmails() {
    return this.getInboxEmails();
  }
}

module.exports = EmailExtractor;
