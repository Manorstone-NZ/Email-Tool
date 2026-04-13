const fs = require('fs');
const path = require('path');

class GraphTokenStore {
  constructor(options = {}) {
    this.filePath = options.filePath || path.join(__dirname, '..', 'config', 'graph-token.json');
  }

  ensureDir() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  loadToken() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  }

  saveToken(tokenPayload) {
    const now = Date.now();
    const expiresInMs = Number(tokenPayload.expires_in || 0) * 1000;
    const persisted = {
      ...tokenPayload,
      saved_at: now,
      expires_at: now + expiresInMs
    };

    this.ensureDir();
    fs.writeFileSync(this.filePath, JSON.stringify(persisted, null, 2));
    return persisted;
  }

  getAccessToken() {
    const token = this.loadToken();
    if (!token || !token.access_token || !token.expires_at) {
      return '';
    }

    const safetyWindowMs = 60 * 1000;
    if (Date.now() >= token.expires_at - safetyWindowMs) {
      return '';
    }

    return token.access_token;
  }
}

module.exports = GraphTokenStore;
