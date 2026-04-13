const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = path.join(__dirname, '..', 'config', 'settings.json');
const VIP_CONFIG_PATH = path.join(__dirname, '..', 'config', 'vip-senders.json');

const DEFAULTS = {
  emailProvider: 'auto',
  graphClientId: '',
  graphTenantId: 'organizations',
  archiveFolderId: '',
  lookbackDays: 3,
  minScore: 20,
  vipSenders: ['ceo@', 'board@', 'vp@', 'director@'],
  aiProviderPrimary: 'claude-opus',
  aiProviderFallback: 'gemma-lmstudio',
  anthropicApiKey: '',
  openaiApiKey: '',
  aiClaudeModel: 'claude-3-opus-20240229',
  aiOpenAiModel: 'gpt-4.1',
  aiGemmaModel: 'gemma-4',
  aiDraftEnabled: true,
  draftEligiblePriorities: ['respond-now', 'respond-today'],
  sendRequiresApproval: true,
  maxDraftLength: 4000,
  graphSendEnabled: true,
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

  next.sendRequiresApproval = true;

  if (next.maxDraftLength !== undefined) {
    next.maxDraftLength = Math.max(200, Math.min(12000, Number(next.maxDraftLength) || 4000));
  }

  if (next.draftEligiblePriorities !== undefined) {
    next.draftEligiblePriorities = Array.isArray(next.draftEligiblePriorities)
      ? Array.from(new Set(next.draftEligiblePriorities.map((x) => String(x).trim()).filter(Boolean)))
      : DEFAULTS.draftEligiblePriorities;
  }

  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = { loadSettings, saveSettings, SETTINGS_PATH };
