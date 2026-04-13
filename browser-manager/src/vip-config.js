const fs = require('fs');
const path = require('path');

const DEFAULT_VIPS = ['ceo@', 'board@', 'vp@', 'director@'];

function normalize(values) {
  return Array.from(new Set(values
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean)));
}

function fromConfigFile(configPath) {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (Array.isArray(parsed.vipSenders)) {
      return parsed.vipSenders;
    }
  } catch (error) {
    // Ignore parse/read issues and fall back to defaults.
  }
  return [];
}

function fromEnv(env = process.env) {
  const raw = env.VIP_SENDERS || '';
  if (!raw) {
    return [];
  }
  return raw.split(',').map((value) => value.trim());
}

function loadVipSenders(env = process.env) {
  const configPath = path.join(__dirname, '..', 'config', 'vip-senders.json');
  const combined = [
    ...DEFAULT_VIPS,
    ...fromConfigFile(configPath),
    ...fromEnv(env)
  ];

  return normalize(combined);
}

module.exports = {
  loadVipSenders,
  DEFAULT_VIPS
};
