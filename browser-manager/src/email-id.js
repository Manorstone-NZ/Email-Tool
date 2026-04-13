const crypto = require('crypto');

function buildEmailId(email) {
  const safe = email && typeof email === 'object' ? email : {};
  if (safe.messageId) {
    return String(safe.messageId);
  }
  if (safe.threadId) {
    return String(safe.threadId);
  }
  if (safe.openUrl) {
    return String(safe.openUrl);
  }

  const sender = String(safe.sender || '').toLowerCase();
  const subject = String(safe.subject || '').toLowerCase();
  const digest = crypto.createHash('sha1').update(`${sender}|${subject}`).digest('hex').slice(0, 12);
  return `email-${digest}`;
}

module.exports = {
  buildEmailId,
};
