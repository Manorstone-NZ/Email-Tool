const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class EmailExtractor {
  constructor() {
    this.MS_PER_72_HOURS = 72 * 60 * 60 * 1000;
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
    // AppleScript to extract structured email data from Outlook
    const script = `
tell application "Microsoft Outlook"
  set emailList to {}
  set msgList to every message of inbox
  repeat with msg in msgList
    set emailData to (sender of msg) & "|||" & (subject of msg) & "|||" & (content of msg) & "|||" & (flag index of msg > 0) & "|||" & (read status of msg)
    set end of emailList to emailData
  end repeat
  return emailList as text
end tell
    `;

    try {
      const { stdout } = await execAsync(`osascript -e '${script}'`);
      const emails = stdout
        .trim()
        .split('\n')
        .filter(line => line.length > 0)
        .map(line => {
          const [sender, subject, body, flagged, read] = line.split('|||');
          return {
            sender: sender.trim(),
            subject: subject.trim(),
            body: body.trim().substring(0, 200), // First 200 chars
            flagged: flagged === 'true',
            read: read === 'true',
            timestamp: new Date().toISOString(), // Outlook AppleScript doesn't expose received date easily
            threadId: `thread_${Math.random().toString(36).substr(2, 9)}`
          };
        });

      return emails;
    } catch (error) {
      console.error('[EmailExtractor] Failed to extract emails:', error.message);
      return [];
    }
  }
}

module.exports = EmailExtractor;
