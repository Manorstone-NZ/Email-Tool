const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = path.join(__dirname, '..', 'config', 'settings.json');
const VIP_CONFIG_PATH = path.join(__dirname, '..', 'config', 'vip-senders.json');

const DEFAULTS = {
  emailProvider: 'auto',
  graphClientId: '',
  graphTenantId: 'organizations',
  lookbackDays: 3,
  minScore: 20,
  vipSenders: ['ceo@', 'board@', 'vp@', 'director@']
};

function loadSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(updates) {
  const current = loadSettings();
  const next = { ...current, ...updates };

  if (next.minScore !== undefined) {
    next.minScore = Math.max(0, Math.min(100, Number(next.minScore) || 0));
  }

  if (next.lookbackDays !== undefined) {
    next.lookbackDays = Math.max(1, Math.min(60, Number(next.lookbackDays) || 3));
  }

  if (Array.isArray(next.vipSenders)) {
    next.vipSenders = Array.from(
      new Set(next.vipSenders.map((s) => String(s).trim().toLowerCase()).filter(Boolean))
    );
    // Keep vip-senders.json in sync
    fs.writeFileSync(VIP_CONFIG_PATH, JSON.stringify({ vipSenders: next.vipSenders }, null, 2), 'utf8');
  }

  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = { loadSettings, saveSettings, SETTINGS_PATH };
