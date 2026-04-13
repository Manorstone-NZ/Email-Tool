'use strict';

const fs = require('fs');
const path = require('path');

const CANONICAL_CATEGORIES = ['todo', 'fyi', 'to_follow_up', 'notification', 'marketing'];
const VALID_RULE_TYPES = ['sender_email', 'sender_domain', 'subject_contains', 'subject_exact'];
const VALID_ACTIONS = [...CANONICAL_CATEGORIES, 'skip_automation'];

const DEFAULT_SETTINGS = {
  topicLabelsGloballyEnabled: true,
  categories: Object.fromEntries(
    CANONICAL_CATEGORIES.map(cat => [cat, { enabled: false, topicLabelsEnabled: true }])
  ),
  topicLabels: [],
  customRules: [],
};

const KNOWN_TOP_LEVEL_KEYS = ['topicLabelsGloballyEnabled', 'categories', 'topicLabels', 'customRules'];

function _parseRaw(raw, strict) {
  const result = {};

  for (const key of Object.keys(raw)) {
    if (!KNOWN_TOP_LEVEL_KEYS.includes(key)) {
      if (strict) throw new Error(`[categorization-settings] Unknown top-level key: "${key}"`);
      console.warn(`[categorization-settings] Unknown top-level key ignored: "${key}"`);
    }
  }

  if (!raw.categories || typeof raw.categories !== 'object' || Array.isArray(raw.categories)) {
    throw new Error('[categorization-settings] Missing required key: categories');
  }

  result.topicLabelsGloballyEnabled =
    typeof raw.topicLabelsGloballyEnabled === 'boolean' ? raw.topicLabelsGloballyEnabled : true;

  result.categories = {};
  for (const cat of CANONICAL_CATEGORIES) {
    const src = raw.categories[cat] || {};
    result.categories[cat] = {
      enabled: Boolean(src.enabled),
      targetFolderName: src.targetFolderName || undefined,
      outlookCategoryTag: src.outlookCategoryTag || undefined,
      topicLabelsEnabled: typeof src.topicLabelsEnabled === 'boolean' ? src.topicLabelsEnabled : true,
    };
  }

  const seenRuleIds = new Set();
  result.customRules = [];
  for (const rule of (raw.customRules || [])) {
    if (!rule.id || !rule.type || typeof rule.value !== 'string') {
      console.warn(`[categorization-settings] Custom rule skipped (missing id/type/value):`, rule);
      continue;
    }
    if (rule.value.trim() === '') {
      console.warn(`[categorization-settings] Custom rule skipped (empty value): id=${rule.id}`);
      continue;
    }
    if (!VALID_RULE_TYPES.includes(rule.type)) {
      console.warn(`[categorization-settings] Custom rule skipped (unknown type "${rule.type}"): id=${rule.id}`);
      continue;
    }
    if (!VALID_ACTIONS.includes(rule.action)) {
      console.warn(`[categorization-settings] Custom rule skipped (invalid action "${rule.action}"): id=${rule.id}`);
      continue;
    }
    if (seenRuleIds.has(rule.id)) {
      console.warn(`[categorization-settings] Custom rule skipped (duplicate id "${rule.id}")`);
      continue;
    }
    seenRuleIds.add(rule.id);
    result.customRules.push({
      id: String(rule.id),
      enabled: rule.enabled !== false,
      type: rule.type,
      value: rule.value,
      action: rule.action,
    });
  }

  const seenLabelKeys = new Set();
  result.topicLabels = [];
  for (const label of (raw.topicLabels || [])) {
    if (!label.key || !Array.isArray(label.patterns) || label.patterns.length === 0) {
      console.warn(`[categorization-settings] Topic label skipped (empty key or patterns):`, label);
      continue;
    }
    if (!CANONICAL_CATEGORIES.includes(label.mapsToCategory)) {
      console.warn(`[categorization-settings] Topic label skipped (invalid category "${label.mapsToCategory}"): key=${label.key}`);
      continue;
    }
    if (seenLabelKeys.has(label.key)) {
      console.warn(`[categorization-settings] Topic label skipped (duplicate key "${label.key}")`);
      continue;
    }
    seenLabelKeys.add(label.key);
    result.topicLabels.push({
      id: label.id || `label_${Date.now()}`,
      key: label.key,
      patterns: label.patterns.filter(p => typeof p === 'string' && p.trim() !== ''),
      mapsToCategory: label.mapsToCategory,
      enabled: label.enabled !== false,
    });
  }

  return result;
}

function validateSettings(raw) { return _parseRaw(raw, false); }
function validateSettingsStrict(raw) { return _parseRaw(raw, true); }

let _cache = null;

function loadSettings(filePath) {
  const settingsPath = filePath || path.join(__dirname, '../config/categorisation-settings.json');
  if (!fs.existsSync(settingsPath)) {
    _cache = validateSettings(DEFAULT_SETTINGS);
    return _cache;
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (e) {
    throw new Error(`[categorization-settings] Failed to parse settings file: ${e.message}`);
  }
  _cache = validateSettings(raw);
  return _cache;
}

function getSettings() {
  if (!_cache) loadSettings();
  return _cache;
}

function updateCache(validated) {
  _cache = validated;
}

module.exports = { loadSettings, getSettings, updateCache, validateSettings, validateSettingsStrict, CANONICAL_CATEGORIES };
