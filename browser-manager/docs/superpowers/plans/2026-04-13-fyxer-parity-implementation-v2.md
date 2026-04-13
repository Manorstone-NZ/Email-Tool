# Fyxer Email Categorisation Parity — Implementation Plan (rev 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert a deterministic email categoriser between extractor and scorer, drive Outlook folder/tag actions from categorisation decisions, and expose settings + category state in the dashboard.

**Architecture:** Option B — separate `email-categorizer.js` inserted into the existing `extractor → scorer` pipeline. `email-triage.js` is the join point. New `categorization-settings.js` owns all config. `email-scorer.js` rewritten to consume `CategorizationDecision`. `mail-action-service.js` extended with `applyActions`. Dashboard extended with new API and WebSocket events.

**Pipeline (locked):** `extractor → categoriser → scorer → action_service`
- `null` category (when settings absent or categoriser absent): scorer does NOT run; action service does NOT run; TriageItem still emitted.

**Tech Stack:** Node.js, Jest, Express, WebSocket (`ws`), Microsoft Graph API (existing auth via `graph-token-store.js`)

**Spec:** `docs/superpowers/specs/2026-04-13-fyxer-parity-design.md`

---

## File Map

**Create:**
- `src/email-categorizer.js` — synchronous categoriser, injectable settings
- `src/categorization-settings.js` — settings loader/cache for `config/categorisation-settings.json`
- `config/categorisation-settings.json` — default settings file
- `tests/email-categorizer.test.js`
- `tests/email-scorer-categorisation.test.js` — new scorer tests (new signature/shape)
- `tests/categorization-settings.test.js`
- `tests/mail-action-service-categorisation.test.js`
- `tests/categorisation-api.test.js`
- `tests/contracts/categoriser-scorer.test.js`
- `tests/contracts/scorer-action-service.test.js`
- `tests/schemas/shape-validation.test.js`
- `tests/email-triage-pipeline.test.js`
- `tests/ui/categorisation-ui.test.js`

**Modify:**
- `src/email-scorer.js` — add `score(email, decision) -> ScoringResult`; per-category urgency constraints
- `src/mail-action-service.js` — add `applyActions(email, decision, settings)` alongside existing methods
- `src/email-triage.js` — thread categoriser→scorer→actions in correct order; handle null category
- `dashboard.js` — add `GET/PUT /api/settings/categorisation`; emit `settings_updated`; extend `formatTriageItemForApi`
- `public/app.js` — category badge rendering; settings panel
- `manager.js` — wire `categorizationSettings` and `mailActionService` into triage

---

## Task 1: Settings loader

**Files:**
- Create: `src/categorization-settings.js`
- Create: `config/categorisation-settings.json`
- Create: `tests/categorization-settings.test.js`

- [ ] **Step 1.1: Write failing tests for settings load/validation**

```js
// tests/categorization-settings.test.js
let loadSettings, validateSettings, validateSettingsStrict;
beforeEach(() => {
  jest.resetModules();
  ({ loadSettings, validateSettings, validateSettingsStrict } = require('../src/categorization-settings'));
});

describe('validateSettings', () => {
  const validSettings = () => ({
    topicLabelsGloballyEnabled: true,
    categories: {
      todo: { enabled: true, topicLabelsEnabled: true },
      fyi: { enabled: true, topicLabelsEnabled: true },
      to_follow_up: { enabled: true, topicLabelsEnabled: true },
      notification: { enabled: false, topicLabelsEnabled: true },
      marketing: { enabled: false, topicLabelsEnabled: true },
    },
    topicLabels: [],
    customRules: [],
  });

  test('valid settings loads without error', () => {
    expect(() => validateSettings(validSettings())).not.toThrow();
  });

  test('missing required key throws', () => {
    const s = validSettings();
    delete s.categories;
    expect(() => validateSettings(s)).toThrow();
  });

  test('unknown top-level key is ignored with warning (lenient mode)', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const s = { ...validSettings(), unknownKey: 'oops' };
    expect(() => validateSettings(s)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknownKey'));
    warn.mockRestore();
  });

  test('validateSettingsStrict: unknown top-level key throws', () => {
    const s = { ...validSettings(), unknownKey: 'oops' };
    expect(() => validateSettingsStrict(s)).toThrow(/unknownKey/);
  });

  test('invalid category name in customRules is skipped with warning', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const s = validSettings();
    s.customRules = [{ id: 'rule_1', enabled: true, type: 'sender_email', value: 'x@y.com', action: 'badcategory' }];
    const result = validateSettings(s);
    expect(result.customRules).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test('custom rule with empty value is skipped with warning', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const s = validSettings();
    s.customRules = [{ id: 'rule_1', enabled: true, type: 'sender_email', value: '  ', action: 'todo' }];
    const result = validateSettings(s);
    expect(result.customRules).toHaveLength(0);
    warn.mockRestore();
  });

  test('duplicate custom rule ID: second entry skipped with warning', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const s = validSettings();
    s.customRules = [
      { id: 'rule_1', enabled: true, type: 'sender_email', value: 'a@b.com', action: 'todo' },
      { id: 'rule_1', enabled: true, type: 'sender_email', value: 'c@d.com', action: 'fyi' },
    ];
    const result = validateSettings(s);
    expect(result.customRules).toHaveLength(1);
    expect(result.customRules[0].value).toBe('a@b.com');
    warn.mockRestore();
  });

  test('topic label with empty patterns skipped with warning', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const s = validSettings();
    s.topicLabels = [{ id: 'l1', key: 'billing', patterns: [], mapsToCategory: 'notification', enabled: true }];
    const result = validateSettings(s);
    expect(result.topicLabels).toHaveLength(0);
    warn.mockRestore();
  });

  test('duplicate topic label key: second skipped with warning', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const s = validSettings();
    s.topicLabels = [
      { id: 'l1', key: 'billing', patterns: ['invoice'], mapsToCategory: 'notification', enabled: true },
      { id: 'l2', key: 'billing', patterns: ['payment'], mapsToCategory: 'marketing', enabled: true },
    ];
    const result = validateSettings(s);
    expect(result.topicLabels).toHaveLength(1);
    warn.mockRestore();
  });

  test('topicLabelsGloballyEnabled absent defaults to true', () => {
    const s = validSettings();
    delete s.topicLabelsGloballyEnabled;
    const result = validateSettings(s);
    expect(result.topicLabelsGloballyEnabled).toBe(true);
  });
});
```

- [ ] **Step 1.2: Run tests to verify they fail**

```bash
cd /Users/damian/browser-manager && npm test -- tests/categorization-settings.test.js --runInBand
```
Expected: FAIL — module not found

- [ ] **Step 1.3: Implement `src/categorization-settings.js`**

```js
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
```

- [ ] **Step 1.4: Run tests to verify they pass**

```bash
cd /Users/damian/browser-manager && npm test -- tests/categorization-settings.test.js --runInBand
```
Expected: all PASS

- [ ] **Step 1.5: Create default settings file**

Create `config/categorisation-settings.json`:
```json
{
  "topicLabelsGloballyEnabled": true,
  "categories": {
    "todo": { "enabled": false, "topicLabelsEnabled": true },
    "fyi": { "enabled": false, "topicLabelsEnabled": true },
    "to_follow_up": { "enabled": false, "topicLabelsEnabled": true },
    "notification": { "enabled": false, "topicLabelsEnabled": true },
    "marketing": { "enabled": false, "topicLabelsEnabled": true }
  },
  "topicLabels": [],
  "customRules": []
}
```

- [ ] **Step 1.6: Commit**

```bash
cd /Users/damian/browser-manager && git add src/categorization-settings.js config/categorisation-settings.json tests/categorization-settings.test.js && git commit -m "feat: add categorization-settings loader with validation"
```

---

## Task 2: Email categoriser

**Files:**
- Create: `src/email-categorizer.js`
- Create: `tests/email-categorizer.test.js`

- [ ] **Step 2.1: Write failing tests**

```js
// tests/email-categorizer.test.js
const { categorize } = require('../src/email-categorizer');

const CANONICAL = ['todo', 'fyi', 'to_follow_up', 'notification', 'marketing'];

const baseEmail = () => Object.freeze({
  messageId: 'msg1',
  threadId: 'thread1',
  sender: 'alice@example.com',
  senderDomain: 'example.com',
  recipients: ['me@company.com'],
  subject: 'Hello world',
  preview: 'Just checking in',
  receivedAt: '2026-04-13T10:00:00Z',
  hasUserReplyInThread: false,
  outlookCategories: [],
  isRead: false,
});

const baseSettings = () => Object.freeze({
  topicLabelsGloballyEnabled: true,
  categories: Object.fromEntries(
    CANONICAL.map(cat => [cat, { enabled: true, topicLabelsEnabled: true }])
  ),
  topicLabels: [],
  customRules: [],
});

describe('categorize — shape invariants', () => {
  test('returns valid CategorizationDecision for any email', () => {
    const result = categorize(baseEmail(), baseSettings());
    expect(CANONICAL).toContain(result.category);
    expect(typeof result.skipAutomation).toBe('boolean');
    expect(['custom_rule','reply_transition','topic_label','heuristic']).toContain(result.source);
    expect(typeof result.confidence).toBe('number');
    expect(isFinite(result.confidence)).toBe(true);
    expect(Array.isArray(result.reasons)).toBe(true);
  });

  test('category is never null', () => {
    const result = categorize(baseEmail(), baseSettings());
    expect(result.category).not.toBeNull();
  });
});

describe('categorize — custom rules', () => {
  test('first matching rule wins', () => {
    const settings = {
      ...baseSettings(),
      customRules: [
        { id: 'r1', enabled: true, type: 'sender_email', value: 'alice@example.com', action: 'marketing' },
        { id: 'r2', enabled: true, type: 'sender_email', value: 'alice@example.com', action: 'todo' },
      ],
    };
    const result = categorize(baseEmail(), settings);
    expect(result.category).toBe('marketing');
    expect(result.matchedRuleId).toBe('r1');
  });

  test('disabled rule is skipped', () => {
    const settings = {
      ...baseSettings(),
      customRules: [
        { id: 'r1', enabled: false, type: 'sender_email', value: 'alice@example.com', action: 'marketing' },
        { id: 'r2', enabled: true, type: 'sender_domain', value: 'example.com', action: 'notification' },
      ],
    };
    const result = categorize(baseEmail(), settings);
    expect(result.category).toBe('notification');
    expect(result.matchedRuleId).toBe('r2');
  });

  test('sender_domain matches case-insensitively against senderDomain', () => {
    const settings = {
      ...baseSettings(),
      customRules: [
        { id: 'r1', enabled: true, type: 'sender_domain', value: 'EXAMPLE.COM', action: 'fyi' },
      ],
    };
    const result = categorize(baseEmail(), settings);
    expect(result.category).toBe('fyi');
  });

  test('subject_contains normalises whitespace', () => {
    const email = Object.freeze({ ...baseEmail(), subject: '  Hello   World  ' });
    const settings = {
      ...baseSettings(),
      customRules: [
        { id: 'r1', enabled: true, type: 'subject_contains', value: 'hello world', action: 'todo' },
      ],
    };
    const result = categorize(email, settings);
    expect(result.category).toBe('todo');
  });

  test('custom_rule source has confidence 1.0', () => {
    const settings = {
      ...baseSettings(),
      customRules: [
        { id: 'r1', enabled: true, type: 'sender_email', value: 'alice@example.com', action: 'todo' },
      ],
    };
    const result = categorize(baseEmail(), settings);
    expect(result.source).toBe('custom_rule');
    expect(result.confidence).toBe(1.0);
  });

  test('skip_automation rule: skipAutomation true, category from natural sources', () => {
    const settings = {
      ...baseSettings(),
      customRules: [
        { id: 'r1', enabled: true, type: 'sender_email', value: 'alice@example.com', action: 'skip_automation' },
      ],
    };
    const result = categorize(baseEmail(), settings);
    expect(result.skipAutomation).toBe(true);
    expect(result.source).not.toBe('custom_rule');
    expect(CANONICAL).toContain(result.category);
  });

  test('skip_automation: matchedRuleId set', () => {
    const settings = {
      ...baseSettings(),
      customRules: [
        { id: 'r1', enabled: true, type: 'sender_email', value: 'alice@example.com', action: 'skip_automation' },
      ],
    };
    const result = categorize(baseEmail(), settings);
    expect(result.matchedRuleId).toBe('r1');
  });
});

describe('categorize — reply transition', () => {
  // Use a subject that deterministically triggers 'todo' via action keyword
  const todoSubject = 'Can you please approve this request?';

  test('fires when hasUserReplyInThread true and heuristic base is todo', () => {
    const email = Object.freeze({ ...baseEmail(), hasUserReplyInThread: true, subject: todoSubject });
    const result = categorize(email, baseSettings());
    expect(result.category).toBe('to_follow_up');
    expect(result.source).toBe('reply_transition');
  });

  test('does not fire when hasUserReplyInThread false', () => {
    const email = Object.freeze({ ...baseEmail(), hasUserReplyInThread: false, subject: todoSubject });
    const result = categorize(email, baseSettings());
    expect(result.source).not.toBe('reply_transition');
  });

  test('reply_transition confidence is in [0, 0.95]', () => {
    const email = Object.freeze({ ...baseEmail(), hasUserReplyInThread: true, subject: todoSubject });
    const result = categorize(email, baseSettings());
    if (result.source === 'reply_transition') {
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(0.95);
    }
  });
});

describe('categorize — topic labels', () => {
  test('topicLabelsGloballyEnabled false: no label applied', () => {
    const settings = {
      ...baseSettings(),
      topicLabelsGloballyEnabled: false,
      topicLabels: [
        { id: 'l1', key: 'billing', patterns: ['hello'], mapsToCategory: 'notification', enabled: true },
      ],
    };
    const result = categorize(baseEmail(), settings);
    expect(result.source).not.toBe('topic_label');
  });

  test('per-category topicLabelsEnabled false: label ignored, scan continues to next matching label', () => {
    const settings = {
      ...baseSettings(),
      categories: {
        ...baseSettings().categories,
        notification: { enabled: true, topicLabelsEnabled: false },
      },
      topicLabels: [
        { id: 'l1', key: 'notif', patterns: ['hello'], mapsToCategory: 'notification', enabled: true },
        { id: 'l2', key: 'mkt', patterns: ['world'], mapsToCategory: 'marketing', enabled: true },
      ],
    };
    const result = categorize(baseEmail(), settings);
    // 'hello' matches l1 but notification has topicLabelsEnabled:false; 'world' matches l2
    expect(result.category).toBe('marketing');
    expect(result.source).toBe('topic_label');
  });

  test('first matching enabled label wins', () => {
    const settings = {
      ...baseSettings(),
      topicLabels: [
        { id: 'l1', key: 'first', patterns: ['hello'], mapsToCategory: 'fyi', enabled: true },
        { id: 'l2', key: 'second', patterns: ['hello'], mapsToCategory: 'marketing', enabled: true },
      ],
    };
    const result = categorize(baseEmail(), settings);
    expect(result.category).toBe('fyi');
    expect(result.matchedTopicLabel).toBe('first');
  });

  test('topic_label confidence in [0, 0.9]', () => {
    const settings = {
      ...baseSettings(),
      topicLabels: [
        { id: 'l1', key: 'hello', patterns: ['hello'], mapsToCategory: 'fyi', enabled: true },
      ],
    };
    const result = categorize(baseEmail(), settings);
    if (result.source === 'topic_label') {
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(0.9);
    }
  });
});

describe('categorize — heuristic', () => {
  test('always returns valid category', () => {
    const result = categorize(baseEmail(), baseSettings());
    expect(CANONICAL).toContain(result.category);
  });

  test('heuristic confidence is finite and in [0, 0.8]', () => {
    const result = categorize(baseEmail(), baseSettings());
    if (result.source === 'heuristic') {
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(0.8);
      expect(isFinite(result.confidence)).toBe(true);
    }
  });
});

describe('categorize — malformed input guard', () => {
  test('missing senderDomain: falls to heuristic, no crash', () => {
    const email = Object.freeze({ ...baseEmail(), senderDomain: undefined });
    expect(() => categorize(email, baseSettings())).not.toThrow();
    const result = categorize(email, baseSettings());
    expect(CANONICAL).toContain(result.category);
  });

  test('missing subject: no crash', () => {
    const email = Object.freeze({ ...baseEmail(), subject: undefined });
    expect(() => categorize(email, baseSettings())).not.toThrow();
  });
});

describe('categorize — mutation safety', () => {
  test('frozen email input does not throw', () => {
    const email = Object.freeze(baseEmail());
    expect(() => categorize(email, baseSettings())).not.toThrow();
  });
});

describe('categorize — error recovery', () => {
  test('internal error during rule scan falls back to heuristic and logs error', () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    // Rule with a getter that throws simulates an internal error
    const buggyRule = { enabled: true };
    Object.defineProperty(buggyRule, 'type', { get() { throw new Error('boom'); } });
    const settings = { ...baseSettings(), customRules: [buggyRule] };
    let result;
    expect(() => { result = categorize(baseEmail(), settings); }).not.toThrow();
    expect(CANONICAL).toContain(result.category);
    expect(result.source).toBe('heuristic');
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('categorize — determinism', () => {
  test('same input returns identical output 10 times', () => {
    const email = Object.freeze(baseEmail());
    const settings = Object.freeze(baseSettings());
    const first = JSON.stringify(categorize(email, settings));
    for (let i = 0; i < 9; i++) {
      expect(JSON.stringify(categorize(email, settings))).toBe(first);
    }
  });
});
```

- [ ] **Step 2.2: Run tests to verify they fail**

```bash
cd /Users/damian/browser-manager && npm test -- tests/email-categorizer.test.js --runInBand
```
Expected: FAIL — module not found

- [ ] **Step 2.3: Implement `src/email-categorizer.js`**

```js
'use strict';

const CANONICAL_CATEGORIES = ['todo', 'fyi', 'to_follow_up', 'notification', 'marketing'];

function normalise(str) {
  return (str || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function matchesRule(email, rule) {
  try {
    switch (rule.type) {
      case 'sender_email':
        return (email.sender || '').toLowerCase() === rule.value.toLowerCase();
      case 'sender_domain':
        return (email.senderDomain || '').toLowerCase() === rule.value.toLowerCase();
      case 'subject_contains':
        return normalise(email.subject).includes(normalise(rule.value));
      case 'subject_exact':
        return normalise(email.subject) === normalise(rule.value);
      default:
        return false;
    }
  } catch (_) {
    return false;
  }
}

function heuristic(email) {
  const subject = normalise(email.subject || '');
  const preview = normalise(email.preview || '');
  const combined = subject + ' ' + preview;

  if (/\b(can you|could you|please review|approval|approve|decision|need your|action required)\b/.test(combined)) {
    return { category: 'todo', confidence: 0.7, reasons: ['action keyword detected'] };
  }
  if (/\b(unsubscribe|newsletter|promotion|offer|deal|discount)\b/.test(combined)) {
    return { category: 'marketing', confidence: 0.65, reasons: ['marketing keyword detected'] };
  }
  if (/\b(alert|notification|automated|noreply|no-reply|digest)\b/.test(combined)) {
    return { category: 'notification', confidence: 0.6, reasons: ['notification keyword detected'] };
  }
  if (/\b(fyi|for your information|heads up|update)\b/.test(combined)) {
    return { category: 'fyi', confidence: 0.55, reasons: ['fyi keyword detected'] };
  }
  return { category: 'todo', confidence: 0.3, reasons: ['default heuristic'] };
}

function topicLabelOrHeuristic(email, settings) {
  if (settings.topicLabelsGloballyEnabled !== false) {
    const combined = normalise([email.sender, email.subject, email.preview].join(' '));
    for (const label of (settings.topicLabels || [])) {
      if (!label.enabled) continue;
      const catSettings = settings.categories[label.mapsToCategory];
      if (catSettings && catSettings.topicLabelsEnabled === false) continue;
      const match = label.patterns.some(p => combined.includes(normalise(p)));
      if (match) {
        return {
          category: label.mapsToCategory,
          skipAutomation: false,
          source: 'topic_label',
          confidence: 0.75,
          matchedTopicLabel: label.key,
          reasons: [`topic label matched: ${label.key}`],
        };
      }
    }
  }
  const h = heuristic(email);
  return {
    category: h.category,
    skipAutomation: false,
    source: 'heuristic',
    confidence: h.confidence,
    reasons: h.reasons,
  };
}

function categorizeWithoutCustomRules(email, settings) {
  const baseResult = topicLabelOrHeuristic(email, settings);
  if (email.hasUserReplyInThread === true && baseResult.category === 'todo') {
    return {
      category: 'to_follow_up',
      skipAutomation: false,
      source: 'reply_transition',
      confidence: 0.85,
      reasons: ['user has replied in thread; base category was todo'],
    };
  }
  return { ...baseResult, skipAutomation: false };
}

function categorize(email, settings) {
  try {
    for (const rule of (settings.customRules || [])) {
      if (!rule.enabled) continue;
      if (!matchesRule(email, rule)) continue;
      if (rule.action === 'skip_automation') {
        const natural = categorizeWithoutCustomRules(email, settings);
        return { ...natural, skipAutomation: true, matchedRuleId: rule.id };
      }
      return {
        category: rule.action,
        skipAutomation: false,
        source: 'custom_rule',
        confidence: 1.0,
        matchedRuleId: rule.id,
        reasons: [`matched rule: ${rule.id} (${rule.type})`],
      };
    }
    return categorizeWithoutCustomRules(email, settings);
  } catch (err) {
    console.error('[email-categorizer] Internal error, falling back to heuristic:', err);
    const h = heuristic(email);
    return {
      category: h.category,
      skipAutomation: false,
      source: 'heuristic',
      confidence: h.confidence,
      reasons: [...h.reasons, 'error fallback'],
    };
  }
}

module.exports = { categorize };
```

- [ ] **Step 2.4: Run tests to verify they pass**

```bash
cd /Users/damian/browser-manager && npm test -- tests/email-categorizer.test.js --runInBand
```
Expected: all PASS

- [ ] **Step 2.5: Commit**

```bash
cd /Users/damian/browser-manager && git add src/email-categorizer.js tests/email-categorizer.test.js && git commit -m "feat: add email-categorizer with rule/transition/topic/heuristic pipeline"
```

---

## Task 3: Rewrite email-scorer to consume CategorizationDecision

The scorer signature changes from `score(email) -> old_shape` to `score(email, decision) -> ScoringResult`. The existing internal helpers remain; the method accepts the optional `decision` parameter and uses it to constrain urgency and recommended action by category.

**`ScoringResult` shape (locked):**
```js
{
  urgency: 'low' | 'medium' | 'high',
  score: number,                 // 0–100
  recommendedAction: 'Review Later' | 'Review / Respond' | 'Approve / Decide' | 'Review',
  reasons: string[],
}
```

**Per-category urgency constraints (locked):**
- `todo` → `'high'` or `'medium'`; never `'low'`
- `to_follow_up` → `'medium'`; never `'high'` or `'low'`
- `fyi` → `'low'`; never `'high'` or `'medium'`
- `notification` → `'low'`
- `marketing` → `'low'`
- `null` category (no decision) → unconstrained

**Files:**
- Modify: `src/email-scorer.js`
- Create: `tests/email-scorer-categorisation.test.js`

- [ ] **Step 3.1: Write failing tests for the new ScoringResult interface**

```js
// tests/email-scorer-categorisation.test.js
const EmailScorer = require('../src/email-scorer');

const scorer = new EmailScorer();

const VALID_URGENCIES = ['low', 'medium', 'high'];
const VALID_ACTIONS = ['Review Later', 'Review / Respond', 'Approve / Decide', 'Review'];

const baseEmail = () => Object.freeze({
  messageId: 'msg1', threadId: 't1', sender: 'a@b.com',
  subject: 'Test', preview: 'Hello world', body: 'Body text',
  receivedAt: '2026-04-13T10:00:00Z', isRead: false,
});

const baseDecision = (cat) => Object.freeze({
  category: cat, skipAutomation: false, source: 'heuristic', confidence: 0.5, reasons: [],
});

describe('ScoringResult shape', () => {
  test('score(email, decision) returns correct shape', () => {
    const result = scorer.score(baseEmail(), baseDecision('todo'));
    expect(VALID_URGENCIES).toContain(result.urgency);
    expect(typeof result.score).toBe('number');
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(VALID_ACTIONS).toContain(result.recommendedAction);
    expect(Array.isArray(result.reasons)).toBe(true);
  });

  test('score(email) without decision still returns ScoringResult shape', () => {
    const result = scorer.score(baseEmail());
    expect(VALID_URGENCIES).toContain(result.urgency);
    expect(VALID_ACTIONS).toContain(result.recommendedAction);
    expect(typeof result.score).toBe('number');
  });
});

describe('urgency constraints by category', () => {
  test('todo: urgency is never low', () => {
    const result = scorer.score(baseEmail(), baseDecision('todo'));
    expect(result.urgency).not.toBe('low');
  });

  test('todo: urgency is high or medium', () => {
    const result = scorer.score(baseEmail(), baseDecision('todo'));
    expect(['high', 'medium']).toContain(result.urgency);
  });

  test('to_follow_up: urgency is always medium', () => {
    const result = scorer.score(baseEmail(), baseDecision('to_follow_up'));
    expect(result.urgency).toBe('medium');
  });

  test('fyi: urgency is always low', () => {
    const result = scorer.score(baseEmail(), baseDecision('fyi'));
    expect(result.urgency).toBe('low');
  });

  test('notification: urgency is always low', () => {
    const result = scorer.score(baseEmail(), baseDecision('notification'));
    expect(result.urgency).toBe('low');
  });

  test('marketing: urgency is always low', () => {
    const result = scorer.score(baseEmail(), baseDecision('marketing'));
    expect(result.urgency).toBe('low');
  });
});

describe('immutability', () => {
  test('frozen decision is not mutated', () => {
    const decision = Object.freeze(baseDecision('todo'));
    expect(() => scorer.score(baseEmail(), decision)).not.toThrow();
    expect(decision.category).toBe('todo');
  });
});

describe('determinism', () => {
  test('same input same output 5 times', () => {
    const email = Object.freeze(baseEmail());
    const decision = Object.freeze(baseDecision('fyi'));
    const first = JSON.stringify(scorer.score(email, decision));
    for (let i = 0; i < 4; i++) {
      expect(JSON.stringify(scorer.score(email, decision))).toBe(first);
    }
  });
});
```

- [ ] **Step 3.2: Run tests to verify they fail**

```bash
cd /Users/damian/browser-manager && npm test -- tests/email-scorer-categorisation.test.js --runInBand
```
Expected: FAIL — `urgency` and `recommendedAction` absent; wrong shape

- [ ] **Step 3.3: Update `src/email-scorer.js` to produce `ScoringResult`**

In the `score(email, decision)` method:

1. Add `decision` as optional second parameter.
2. Compute a base urgency (currently the scorer probably has a `confidence` or signal-based system — adapt it to produce `'low' | 'medium' | 'high'`).
3. Apply per-category urgency override via the locked constraints table.
4. Map the existing action string to the new `recommendedAction` values (`'Review Later' | 'Review / Respond' | 'Approve / Decide' | 'Review'`).
5. Return `{ urgency, score, recommendedAction, reasons }`. Remove the old fields (`action`, `confidence`, `email` reference, `signals`) from the public return shape.

The mapping from old action to new `recommendedAction`:
- `'delete'` / `'archive'` / `'folder'` → `'Review Later'`
- `'reply'` / `'respond'` → `'Review / Respond'`
- `'approve'` / `'decide'` → `'Approve / Decide'`
- default / `'review'` → `'Review'`

Urgency-from-score heuristic (before category override):
- score >= 70 → `'high'`
- score >= 40 → `'medium'`
- else → `'low'`

Category override (applied after base urgency):
```js
if (decision) {
  switch (decision.category) {
    case 'todo':
      if (urgency === 'low') urgency = 'medium';
      break;
    case 'to_follow_up':
      urgency = 'medium';
      break;
    case 'fyi':
    case 'notification':
    case 'marketing':
      urgency = 'low';
      break;
  }
}
```

- [ ] **Step 3.4: Run tests to verify they pass**

```bash
cd /Users/damian/browser-manager && npm test -- tests/email-scorer-categorisation.test.js --runInBand
```
Expected: all PASS

- [ ] **Step 3.5: Run existing scorer tests and update broken assertions**

```bash
cd /Users/damian/browser-manager && npm test -- tests/email-scorer.test.js --runInBand
```

The existing `email-scorer.test.js` tests the OLD return shape `{ email, score, action, reason, signals }`. After the rewrite the public shape is `{ urgency, score, recommendedAction, reasons }`.

**Assertions that WILL break and must be updated:**
- Any `expect(result.action).toBe(...)` → change to `expect(result.recommendedAction).toBe(...)`
- Any `expect(result.reason).toBe(...)` or `toContain(...)` → change to use `result.reasons` (array)
- Any `expect(result.email).toBe(...)` or `result.email.messageId` → remove (email ref no longer in result)
- Any `expect(result.signals).toBeDefined()` or `result.signals.primary` → remove (internal; not in public shape)

After updating, re-run to verify all pass:
```bash
cd /Users/damian/browser-manager && npm test -- tests/email-scorer.test.js --runInBand
```
Expected: all PASS with updated assertions

- [ ] **Step 3.6: Commit**

```bash
cd /Users/damian/browser-manager && git add src/email-scorer.js tests/email-scorer-categorisation.test.js && git commit -m "feat: update email-scorer to consume CategorizationDecision and emit ScoringResult"
```

---

## Task 4: Add `applyActions` to mail-action-service

The existing `deleteEmail` and `archiveEmail` methods are preserved untouched. Add `applyActions(email, decision, settings)` and a private `_graphPatch` helper.

**Files:**
- Modify: `src/mail-action-service.js`
- Create: `tests/mail-action-service-categorisation.test.js`

- [ ] **Step 4.1: Write failing tests for `applyActions`**

```js
// tests/mail-action-service-categorisation.test.js
const MailActionService = require('../src/mail-action-service');

function makeService(fetchResponses = []) {
  let callIndex = 0;
  const mockFetch = jest.fn(async () => {
    const resp = fetchResponses[callIndex++] || { ok: true, status: 200, json: async () => ({}) };
    return resp;
  });
  const tokenStore = { getAccessToken: () => 'test-token' };
  const folderCache = new Map([['Done', 'folder-done-id'], ['Archive', 'folder-archive-id']]);
  return new MailActionService({ tokenStore, folderCache, _fetch: mockFetch });
}

const baseEmail = () => ({
  messageId: 'msg-abc',
  currentFolderId: 'inbox-id',
  outlookCategories: [],
});

const baseDecision = (overrides = {}) => ({
  category: 'todo',
  skipAutomation: false,
  source: 'heuristic',
  confidence: 0.5,
  reasons: [],
  ...overrides,
});

const baseSettings = (catOverride = {}) => ({
  categories: {
    todo: { enabled: true, targetFolderName: 'Done', outlookCategoryTag: 'Priority', topicLabelsEnabled: true, ...catOverride },
    fyi: { enabled: false, topicLabelsEnabled: true },
    to_follow_up: { enabled: false, topicLabelsEnabled: true },
    notification: { enabled: false, topicLabelsEnabled: true },
    marketing: { enabled: false, topicLabelsEnabled: true },
  },
});

describe('applyActions — guards', () => {
  test('skipAutomation true: zero Graph calls, skipReason skip_automation', async () => {
    const svc = makeService();
    const result = await svc.applyActions(baseEmail(), baseDecision({ skipAutomation: true }), baseSettings());
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('skip_automation');
    expect(result.actionsAttempted).toEqual([]);
    expect(svc._fetch).not.toHaveBeenCalled();
  });

  test('category disabled: zero Graph calls, skipReason category_disabled', async () => {
    const svc = makeService();
    const result = await svc.applyActions(baseEmail(), baseDecision(), baseSettings({ enabled: false }));
    expect(result.skipReason).toBe('category_disabled');
    expect(svc._fetch).not.toHaveBeenCalled();
  });

  test('skipAutomation + category_disabled: skipAutomation takes precedence', async () => {
    const svc = makeService();
    const result = await svc.applyActions(baseEmail(), baseDecision({ skipAutomation: true }), baseSettings({ enabled: false }));
    expect(result.skipReason).toBe('skip_automation');
  });

  test('no targetFolderName or tag: skipReason no_actions_configured', async () => {
    const svc = makeService();
    const result = await svc.applyActions(baseEmail(), baseDecision(), baseSettings({ targetFolderName: undefined, outlookCategoryTag: undefined }));
    expect(result.skipReason).toBe('no_actions_configured');
    expect(svc._fetch).not.toHaveBeenCalled();
  });
});

describe('applyActions — idempotency', () => {
  test('already in target folder: move skipped', async () => {
    const svc = makeService([{ ok: true, status: 200, json: async () => ({}) }]);
    const email = { ...baseEmail(), currentFolderId: 'folder-done-id' };
    const result = await svc.applyActions(email, baseDecision(), baseSettings());
    expect(result.actionsSkipped.some(s => s.action === 'move')).toBe(true);
  });

  test('tag already present (same case): tag skipped', async () => {
    const svc = makeService([{ ok: true, status: 200, json: async () => ({}) }]);
    const email = { ...baseEmail(), outlookCategories: ['Priority'] };
    const result = await svc.applyActions(email, baseDecision(), baseSettings());
    expect(result.actionsSkipped.some(s => s.action === 'tag')).toBe(true);
  });

  test('tag already present (different case): tag skipped', async () => {
    const svc = makeService([{ ok: true, status: 200, json: async () => ({}) }]);
    const email = { ...baseEmail(), outlookCategories: ['priority'] };
    const result = await svc.applyActions(email, baseDecision(), baseSettings());
    expect(result.actionsSkipped.some(s => s.action === 'tag')).toBe(true);
  });
});

describe('applyActions — colour tag merge', () => {
  test('appends new tag to existing categories without duplicates', async () => {
    const svc = makeService([
      { ok: true, status: 200, json: async () => ({}) }, // move
      { ok: true, status: 200, json: async () => ({}) }, // tag
    ]);
    const email = { ...baseEmail(), outlookCategories: ['Inbox'] };
    await svc.applyActions(email, baseDecision(), baseSettings());
    const tagCall = svc._fetch.mock.calls.find(([, opts]) => {
      try { return JSON.parse(opts.body).categories; } catch (_) { return false; }
    });
    if (tagCall) {
      const body = JSON.parse(tagCall[1].body);
      expect(body.categories).toContain('Inbox');
      expect(body.categories).toContain('Priority');
    }
  });
});

describe('applyActions — error handling', () => {
  test('applyActions never throws', async () => {
    const svc = makeService([{ ok: false, status: 500, text: async () => 'err', json: async () => ({}) }]);
    await expect(svc.applyActions(baseEmail(), baseDecision(), baseSettings())).resolves.toBeDefined();
  });

  test('Graph 401: no retry, retryAttempted false', async () => {
    const svc = makeService([
      { ok: false, status: 401, text: async () => 'Unauthorized', json: async () => ({}) },
      { ok: true, status: 200, json: async () => ({}) },
    ]);
    const result = await svc.applyActions(baseEmail(), baseDecision(), baseSettings());
    const err = result.errors.find(e => e.action === 'move');
    expect(err).toBeDefined();
    expect(err.retryAttempted).toBe(false);
  });
});

describe('applyActions — ActionResult shape', () => {
  test('result has all required fields', async () => {
    const svc = makeService([
      { ok: true, status: 200, json: async () => ({}) },
      { ok: true, status: 200, json: async () => ({}) },
    ]);
    const result = await svc.applyActions(baseEmail(), baseDecision(), baseSettings());
    expect(typeof result.category).toBe('string');
    expect(typeof result.skipped).toBe('boolean');
    expect(Array.isArray(result.actionsAttempted)).toBe(true);
    expect(Array.isArray(result.actionsApplied)).toBe(true);
    expect(Array.isArray(result.actionsSkipped)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
  });
});

describe('existing methods not broken', () => {
  test('applyActions does not affect deleteEmail/archiveEmail existence', () => {
    const svc = makeService();
    expect(typeof svc.deleteEmail).toBe('function');
    expect(typeof svc.archiveEmail).toBe('function');
  });
});
```

- [ ] **Step 4.2: Run tests to verify they fail**

```bash
cd /Users/damian/browser-manager && npm test -- tests/mail-action-service-categorisation.test.js --runInBand
```
Expected: FAIL — `applyActions` not defined

- [ ] **Step 4.3: Add `applyActions` and `_graphPatch` to `src/mail-action-service.js`**

Add these two methods to the class. Also update the constructor to accept `folderCache` and `_fetch`:

```js
// In constructor, add:
this.folderCache = options.folderCache || null;
this._fetch = options._fetch || fetch; // Node >= 18; or require('node-fetch') if needed

async applyActions(email, decision, settings) {
  const result = {
    category: decision.category,
    skipped: false,
    actionsAttempted: [],
    actionsApplied: [],
    actionsSkipped: [],
    errors: [],
  };

  if (decision.skipAutomation === true) {
    return { ...result, skipped: true, skipReason: 'skip_automation' };
  }

  const catSettings = settings.categories && settings.categories[decision.category];
  if (!catSettings || catSettings.enabled !== true) {
    return { ...result, skipped: true, skipReason: 'category_disabled' };
  }

  const hasMoveConfig = Boolean(catSettings.targetFolderName);
  const hasTagConfig = Boolean(catSettings.outlookCategoryTag);
  if (!hasMoveConfig && !hasTagConfig) {
    return { ...result, skipped: true, skipReason: 'no_actions_configured' };
  }

  const token = this.tokenStore.getAccessToken();
  let activeMessageId = email.messageId;

  if (hasMoveConfig) {
    result.actionsAttempted.push('move');
    const cache = this.folderCache;
    if (!cache) {
      result.actionsSkipped.push({ action: 'move', reason: 'folder cache unavailable' });
    } else {
      const resolvedId = cache.get(catSettings.targetFolderName);
      if (!resolvedId) {
        result.actionsSkipped.push({ action: 'move', reason: `folder "${catSettings.targetFolderName}" not found in cache` });
      } else if (email.currentFolderId === resolvedId) {
        result.actionsSkipped.push({ action: 'move', reason: 'already in target folder' });
      } else {
        const moveResult = await this._graphPatch(token, activeMessageId, { parentFolderId: resolvedId });
        if (moveResult.ok) {
          result.actionsApplied.push('move');
          if (moveResult.newMessageId) activeMessageId = moveResult.newMessageId;
        } else {
          result.errors.push({ action: 'move', code: moveResult.status, message: moveResult.message, retryAttempted: moveResult.retryAttempted });
        }
      }
    }
  }

  if (hasTagConfig) {
    result.actionsAttempted.push('tag');
    const currentCats = (email.outlookCategories || []);
    const tagLower = catSettings.outlookCategoryTag.toLowerCase();
    const alreadyPresent = currentCats.some(c => c.toLowerCase() === tagLower);
    if (alreadyPresent) {
      result.actionsSkipped.push({ action: 'tag', reason: 'tag already applied' });
    } else {
      const merged = [];
      const seen = new Set();
      for (const c of [...currentCats, catSettings.outlookCategoryTag]) {
        if (!seen.has(c.toLowerCase())) {
          seen.add(c.toLowerCase());
          merged.push(c);
        }
      }
      const tagResult = await this._graphPatch(token, activeMessageId, { categories: merged });
      if (tagResult.ok) {
        result.actionsApplied.push('tag');
      } else {
        result.errors.push({ action: 'tag', code: tagResult.status, message: tagResult.message, retryAttempted: tagResult.retryAttempted });
      }
    }
  }

  return result;
}

async _graphPatch(token, messageId, body, retryAttempted = false) {
  const userPath = (this.user && this.user !== 'me') ? `/users/${encodeURIComponent(this.user)}` : '/me';
  const url = `${this.baseUrl}${userPath}/messages/${encodeURIComponent(messageId)}`;
  let response;
  try {
    response = await this._fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, status: 0, message: err.message, retryAttempted };
  }

  if (response.ok) {
    let newMessageId;
    try { const json = await response.json(); newMessageId = json && json.id; } catch (_) {}
    return { ok: true, newMessageId };
  }

  const status = response.status;
  const text = await response.text().catch(() => '');

  if (status === 401 || status === 403) {
    return { ok: false, status, message: text.slice(0, 200), retryAttempted: false };
  }

  if ((status === 429 || status === 503) && !retryAttempted) {
    let delay = 1000;
    const retryAfter = response.headers && response.headers.get && response.headers.get('Retry-After');
    if (retryAfter) delay = parseInt(retryAfter, 10) * 1000 || delay;
    await new Promise(r => setTimeout(r, delay));
    return this._graphPatch(token, messageId, body, true);
  }

  return { ok: false, status, message: text.slice(0, 200), retryAttempted };
}
```

- [ ] **Step 4.4: Run new action service tests**

```bash
cd /Users/damian/browser-manager && npm test -- tests/mail-action-service-categorisation.test.js --runInBand
```
Expected: all PASS

- [ ] **Step 4.5: Run existing action service tests for regression**

```bash
cd /Users/damian/browser-manager && npm test -- tests/mail-action-service.test.js --runInBand 2>/dev/null || echo "no existing test file"
```
If the file exists, all tests must pass.

- [ ] **Step 4.6: Commit**

```bash
cd /Users/damian/browser-manager && git add src/mail-action-service.js tests/mail-action-service-categorisation.test.js && git commit -m "feat: add applyActions to mail-action-service"
```

---

## Task 5: Schema and contract tests

**Files:**
- Create: `tests/schemas/shape-validation.test.js`
- Create: `tests/contracts/categoriser-scorer.test.js`
- Create: `tests/contracts/scorer-action-service.test.js`

- [ ] **Step 5.1: Write schema shape tests**

```js
// tests/schemas/shape-validation.test.js
const { categorize } = require('../../src/email-categorizer');
const EmailScorer = require('../../src/email-scorer');

const CANONICAL = ['todo', 'fyi', 'to_follow_up', 'notification', 'marketing'];
const VALID_URGENCIES = ['low', 'medium', 'high'];
const VALID_ACTIONS = ['Review Later', 'Review / Respond', 'Approve / Decide', 'Review'];

const email = Object.freeze({
  messageId: 'msg1', threadId: 't1', sender: 'a@b.com', senderDomain: 'b.com',
  recipients: [], subject: 'Test', preview: 'Test', body: 'Body',
  receivedAt: '2026-01-01T00:00:00Z',
  hasUserReplyInThread: false, outlookCategories: [], isRead: false,
});
const settings = Object.freeze({
  topicLabelsGloballyEnabled: true,
  categories: Object.fromEntries(CANONICAL.map(c => [c, { enabled: true, topicLabelsEnabled: true }])),
  topicLabels: [], customRules: [],
});

const scorer = new EmailScorer();

describe('CategorizationDecision shape', () => {
  let decision;
  beforeAll(() => { decision = categorize(email, settings); });

  test('category is CanonicalCategory', () => expect(CANONICAL).toContain(decision.category));
  test('skipAutomation is boolean', () => expect(typeof decision.skipAutomation).toBe('boolean'));
  test('source is valid', () => expect(['custom_rule','reply_transition','topic_label','heuristic']).toContain(decision.source));
  test('confidence is finite number', () => {
    expect(typeof decision.confidence).toBe('number');
    expect(isFinite(decision.confidence)).toBe(true);
  });
  test('reasons is array', () => expect(Array.isArray(decision.reasons)).toBe(true));
  test('matchedRuleId absent when source is not custom_rule', () => {
    if (decision.source !== 'custom_rule') expect(decision.matchedRuleId).toBeUndefined();
  });
  test('matchedTopicLabel absent when source is not topic_label', () => {
    if (decision.source !== 'topic_label') expect(decision.matchedTopicLabel).toBeUndefined();
  });
});

describe('ScoringResult shape', () => {
  let decision, result;
  beforeAll(() => {
    decision = categorize(email, settings);
    result = scorer.score(email, decision);
  });

  test('urgency is valid', () => expect(VALID_URGENCIES).toContain(result.urgency));
  test('score is number in [0,100]', () => {
    expect(typeof result.score).toBe('number');
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
  test('recommendedAction is valid', () => expect(VALID_ACTIONS).toContain(result.recommendedAction));
  test('reasons is array', () => expect(Array.isArray(result.reasons)).toBe(true));
});
```

- [ ] **Step 5.2: Run schema tests and confirm they pass**

```bash
cd /Users/damian/browser-manager && npm test -- tests/schemas/shape-validation.test.js --runInBand
```
Expected: all PASS (both modules fully implemented)

- [ ] **Step 5.3: Write contract tests**

```js
// tests/contracts/categoriser-scorer.test.js
const { categorize } = require('../../src/email-categorizer');
const EmailScorer = require('../../src/email-scorer');

const CANONICAL = ['todo', 'fyi', 'to_follow_up', 'notification', 'marketing'];
const scorer = new EmailScorer();

const email = Object.freeze({
  messageId: 'msg1', threadId: 't1', sender: 'a@b.com', senderDomain: 'b.com',
  recipients: [], subject: 'Test', preview: 'Test', body: 'Hello',
  receivedAt: '2026-01-01T00:00:00Z',
  hasUserReplyInThread: false, outlookCategories: [], isRead: false,
});
const settings = Object.freeze({
  topicLabelsGloballyEnabled: true,
  categories: Object.fromEntries(CANONICAL.map(c => [c, { enabled: true, topicLabelsEnabled: true }])),
  topicLabels: [], customRules: [],
});

test('categoriser output is valid scorer input: ScoringResult returned', () => {
  const decision = categorize(email, settings);
  const result = scorer.score(email, decision);
  expect(result).toHaveProperty('urgency');
  expect(result).toHaveProperty('score');
  expect(result).toHaveProperty('recommendedAction');
  expect(result).toHaveProperty('reasons');
});

test('decision object not mutated by scorer', () => {
  const decision = Object.freeze(categorize(email, settings));
  scorer.score(email, decision);
  expect(decision.category).toBeDefined();
  expect(decision.confidence).toBeDefined();
});
```

```js
// tests/contracts/scorer-action-service.test.js
const MailActionService = require('../../src/mail-action-service');

const CANONICAL = ['todo', 'fyi', 'to_follow_up', 'notification', 'marketing'];

const decision = Object.freeze({
  category: 'todo', skipAutomation: true,
  source: 'heuristic', confidence: 0.5, reasons: [],
});
const email = Object.freeze({ messageId: 'msg1', currentFolderId: 'inbox', outlookCategories: [] });
const settings = {
  categories: Object.fromEntries(CANONICAL.map(c => [c, { enabled: true, topicLabelsEnabled: true }])),
};
const tokenStore = { getAccessToken: () => 'tok' };

test('decision is valid action-service input: applyActions resolves', async () => {
  const svc = new MailActionService({ tokenStore });
  const result = await svc.applyActions(email, decision, settings);
  expect(result).toBeDefined();
  expect(result.skipped).toBe(true); // skipAutomation guard fires
});

test('frozen decision not mutated by applyActions', async () => {
  const svc = new MailActionService({ tokenStore });
  await svc.applyActions(email, decision, settings);
  expect(decision.category).toBe('todo');
  expect(decision.skipAutomation).toBe(true);
});
```

- [ ] **Step 5.4: Run contract tests**

```bash
cd /Users/damian/browser-manager && npm test -- tests/contracts/ --runInBand
```
Expected: all PASS

- [ ] **Step 5.5: Commit**

```bash
cd /Users/damian/browser-manager && git add tests/schemas/ tests/contracts/ && git commit -m "test: add schema and contract tests"
```

---

## Task 6: Wire categoriser into email-triage pipeline

**Pipeline order (mandatory):** `extractor → categorise → score → applyActions`

**Null category rule:** When `categorizationSettings` is absent (not injected), category is `null`. When category is `null`, scorer does NOT run. Action service does NOT run. TriageItem still emitted with `category: null`.

**Files:**
- Modify: `src/email-triage.js`
- Modify: `manager.js`
- Create: `tests/email-triage-pipeline.test.js`

- [ ] **Step 6.1: Write failing pipeline tests**

```js
// tests/email-triage-pipeline.test.js
const EmailTriage = require('../src/email-triage');

const makeExtractor = (emails) => ({ getInboxEmails: async () => emails });

const baseEmail = () => ({
  messageId: 'msg1', threadId: 't1', sender: 'a@b.com', senderDomain: 'b.com',
  recipients: [], subject: 'Hello', preview: 'World',
  receivedAt: '2026-01-01T00:00:00Z',
  hasUserReplyInThread: false, outlookCategories: [], isRead: false,
  currentFolderId: 'inbox-id',
});

const baseSettings = {
  topicLabelsGloballyEnabled: true,
  categories: {
    todo: { enabled: true, topicLabelsEnabled: true },
    fyi: { enabled: true, topicLabelsEnabled: true },
    to_follow_up: { enabled: true, topicLabelsEnabled: true },
    notification: { enabled: true, topicLabelsEnabled: true },
    marketing: { enabled: true, topicLabelsEnabled: true },
  },
  topicLabels: [], customRules: [],
};

let scorerCallCount = 0;
const makeScorer = () => ({
  score: (email, decision) => {
    scorerCallCount++;
    return { urgency: 'medium', score: 50, recommendedAction: 'Review', reasons: ['test'] };
  }
});

beforeEach(() => { scorerCallCount = 0; });

test('triage run with settings produces items with category field', async () => {
  const triage = new EmailTriage(makeExtractor([baseEmail()]), makeScorer(), {
    categorizationSettings: baseSettings,
  });
  const items = await triage.run();
  expect(items.length).toBeGreaterThan(0);
  expect(items[0].category).toBeDefined();
  expect(items[0].category).not.toBeNull();
});

test('scorer receives decision as second argument (order check)', async () => {
  let capturedDecision;
  const capturingScorer = {
    score: (email, decision) => {
      capturedDecision = decision;
      return { urgency: 'medium', score: 50, recommendedAction: 'Review', reasons: [] };
    }
  };
  const triage = new EmailTriage(makeExtractor([baseEmail()]), capturingScorer, {
    categorizationSettings: baseSettings,
  });
  await triage.run();
  expect(capturedDecision).toBeDefined();
  expect(capturedDecision.category).toBeDefined();
});

test('null category when settings not provided: scorer does not run', async () => {
  const triage = new EmailTriage(makeExtractor([baseEmail()]), makeScorer());
  await triage.run();
  expect(scorerCallCount).toBe(0);
});

test('null category item is still emitted', async () => {
  const triage = new EmailTriage(makeExtractor([baseEmail()]), makeScorer());
  const items = await triage.run();
  expect(items.length).toBeGreaterThan(0);
  expect(items[0].category).toBeNull();
});

test('no crash with empty inbox', async () => {
  const triage = new EmailTriage(makeExtractor([]), makeScorer(), { categorizationSettings: baseSettings });
  const items = await triage.run();
  expect(Array.isArray(items)).toBe(true);
  expect(items).toHaveLength(0);
});
```

- [ ] **Step 6.2: Run tests to verify they fail**

```bash
cd /Users/damian/browser-manager && npm test -- tests/email-triage-pipeline.test.js --runInBand
```
Expected: FAIL — `category` absent; scorer not gated; decision not passed

- [ ] **Step 6.3: Update `src/email-triage.js` for correct pipeline order**

At the top of `email-triage.js`, add:
```js
const { categorize } = require('./email-categorizer');
```

Update `EmailTriage` constructor to accept new options:
```js
constructor(extractor, scorer, options = {}) {
  super();
  this.extractor = extractor;
  this.scorer = scorer;
  this.lastTriageResult = [];
  this.minScore = Number(options.minScore || process.env.TRIAGE_MIN_SCORE || 20);
  this.maxItems = Number(options.maxItems || process.env.TRIAGE_MAX_ITEMS || 20);
  this.priorityService = options.priorityService || null;
  this.categorizationSettings = options.categorizationSettings || null;
  this.mailActionService = options.mailActionService || null;
  this.lastRunMeta = {
    totalExtracted: 0, actionableCount: 0,
    minScore: this.minScore, maxItems: this.maxItems,
  };
}

// New method for live settings update (used by dashboard PUT endpoint):
setCategorizationSettings(settings) {
  this.categorizationSettings = settings;
}
```

Replace the entire try-block body inside `run()` with the complete corrected pipeline:

```js
// Extract emails
const emails = await this.extractor.getInboxEmails();
console.log(`[EmailTriage] Extracted ${emails.length} emails`);

// Categorise → Score → Actions (locked pipeline order)
const allItems = [];
for (const email of emails) {

  // Stage 1: Categorise (skipped when settings not injected → null decision)
  let decision = null;
  if (this.categorizationSettings) {
    try {
      decision = categorize(email, this.categorizationSettings);
    } catch (err) {
      console.error('[EmailTriage] Categorisation error:', err);
    }
  }

  // Stage 2: Score — only when category is non-null
  let scoringResult = null;
  if (decision !== null) {
    try {
      scoringResult = this.scorer.score(email, decision);
    } catch (err) {
      console.error('[EmailTriage] Scoring error:', err);
    }
  }

  // Stage 3: Apply actions — only when category is non-null and action service is wired
  let actionResult = null;
  if (decision !== null && this.mailActionService && this.categorizationSettings) {
    try {
      actionResult = await this.mailActionService.applyActions(
        email, decision, this.categorizationSettings
      );
    } catch (err) {
      console.error('[EmailTriage] Action service error:', err);
    }
  }

  allItems.push({
    email,
    category: decision ? decision.category : null,
    categorySource: decision ? decision.source : null,
    categorizationConfidence: decision ? decision.confidence : null,
    skipAutomation: decision ? Boolean(decision.skipAutomation) : false,
    urgency: scoringResult ? scoringResult.urgency : null,
    score: scoringResult ? scoringResult.score : null,
    recommendedAction: scoringResult ? scoringResult.recommendedAction : null,
    reasons: scoringResult ? scoringResult.reasons : [],
    // Legacy aliases for backward-compat (priorityService, event logger)
    action: scoringResult ? scoringResult.recommendedAction : null,
    reason: scoringResult ? scoringResult.reasons.join(' • ') : null,
    actionResult,
  });
}

// Filter — null-score (null-category) items pass through unconditionally
const actionable = allItems.filter(
  item => item.score === null || item.score >= this.minScore
);

// Sort: scored items by descending score; null-score items sort last
actionable.sort((a, b) => {
  if (a.score === null && b.score === null) return 0;
  if (a.score === null) return 1;
  if (b.score === null) return -1;
  return b.score - a.score;
});

const topItems = actionable.slice(0, this.maxItems);

// AI priority classification (unchanged)
if (this.priorityService && typeof this.priorityService.prioritize === 'function') {
  for (const item of topItems) {
    const aiDecision = await this.priorityService.prioritize(item.email, {
      score: item.score,
      action: item.action,
      reason: item.reason,
    });
    if (aiDecision && aiDecision.available) {
      item.aiPriority = aiDecision.priority;
      item.primaryCategory = aiDecision.category;
      item.aiReason = aiDecision.reason;
      item.aiDraftTone = aiDecision.draftTone;
      item.aiConfidence = aiDecision.confidence;
      item.aiProviderUsed = aiDecision.providerUsed;
      item.responseRecommended = Boolean(aiDecision.responseRecommended);
    } else {
      item.aiPriority = null;
      item.primaryCategory = null;
      item.aiReason = 'AI unavailable';
      item.aiDraftTone = null;
      item.aiConfidence = null;
      item.aiProviderUsed = null;
      item.responseRecommended = false;
    }
  }
}

this.lastTriageResult = topItems;
this.lastRunMeta = {
  totalExtracted: emails.length,
  actionableCount: actionable.length,
  minScore: this.minScore,
  maxItems: this.maxItems,
};
this.emit('triage-complete', {
  timestamp: new Date().toISOString(),
  totalExtracted: emails.length,
  actionableCount: actionable.length,
  minScore: this.minScore,
  topItems,
});
console.log(`[EmailTriage] Scored: ${actionable.length} actionable items, top ${topItems.length} returned`);
return topItems;
```

- [ ] **Step 6.4: Run pipeline tests**

```bash
cd /Users/damian/browser-manager && npm test -- tests/email-triage-pipeline.test.js --runInBand
```
Expected: all PASS

- [ ] **Step 6.5: Update `manager.js` to inject settings, action service, and build folder cache**

In `manager.js`, make the following changes:

**1. Add require at the top:**
```js
const { loadSettings: loadCategorizationSettings } = require('./src/categorization-settings');
```

**2. In the `BrowserManager` constructor, after `this.emailScorer = new EmailScorer(...)` (line ~97), add:**
```js
this.categorizationSettings = loadCategorizationSettings();
```

**3. Update `MailActionService` construction (line ~106) to include an initial `folderCache` (empty Map; populated at startup):**
```js
this.mailActionService = new MailActionService({
  eventLogger: this.eventLogger,
  user: this.runtimeEnv.GRAPH_USER,
  baseUrl: this.runtimeEnv.GRAPH_BASE_URL,
  folderCache: new Map(), // populated after startup via initFolderCache()
});
```

**4. Update `EmailTriage` construction to pass `categorizationSettings` and `mailActionService`:**
```js
this.emailTriage = new EmailTriage(this.emailExtractor, this.emailScorer, {
  minScore: this.settings.minScore,
  priorityService: this.priorityService,
  categorizationSettings: this.categorizationSettings,
  mailActionService: this.mailActionService,
});
```

**5. Add `initFolderCache()` method on `BrowserManager` and call it on startup:**

```js
async initFolderCache() {
  try {
    const token = this.mailActionService.tokenStore.getAccessToken();
    const userPath = (this.runtimeEnv.GRAPH_USER && this.runtimeEnv.GRAPH_USER !== 'me')
      ? `/users/${encodeURIComponent(this.runtimeEnv.GRAPH_USER)}`
      : '/me';
    const url = `${this.runtimeEnv.GRAPH_BASE_URL}${userPath}/mailFolders?$top=50`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!res.ok) {
      console.warn(`[BrowserManager] initFolderCache: Graph returned ${res.status}`);
      return;
    }
    const json = await res.json();
    const cache = this.mailActionService.folderCache;
    cache.clear();
    for (const folder of (json.value || [])) {
      if (folder.displayName && folder.id) cache.set(folder.displayName, folder.id);
    }
    console.log(`[BrowserManager] Folder cache populated: ${cache.size} folders`);
  } catch (err) {
    console.error('[BrowserManager] initFolderCache error:', err.message);
  }
}
```

Call it from wherever `start()` is invoked (after the Graph token is available):
```js
// In start() or wherever the app initialises Graph connectivity:
await this.initFolderCache();
```

**6. Wire live-settings propagation via `setCategorizationSettings`:**

In `dashboard.js`, after `updateCache(validated)`, also call:
```js
// manager.emailTriage.setCategorizationSettings(validated) — manager must be accessible
if (req.app && req.app.locals && req.app.locals.manager) {
  req.app.locals.manager.emailTriage.setCategorizationSettings(validated);
  req.app.locals.manager.categorizationSettings = validated;
}
```

Or, if `manager.js` already has a reference to `dashboardServer`, add a dedicated method on `BrowserManager`:
```js
updateCategorizationSettings(validated) {
  this.categorizationSettings = validated;
  this.emailTriage.setCategorizationSettings(validated);
}
```
And call it from the PUT route instead of calling `updateCache` directly in that scope.

- [ ] **Step 6.6: Run full test suite**

```bash
cd /Users/damian/browser-manager && npm test -- --runInBand 2>&1 | tail -30
```
Expected: all existing tests plus new tests PASS, no failures

- [ ] **Step 6.7: Commit**

```bash
cd /Users/damian/browser-manager && git add src/email-triage.js manager.js tests/email-triage-pipeline.test.js && git commit -m "feat: wire categoriser into triage pipeline (correct order, null-category guard)"
```

---

## Task 7: Dashboard API — settings endpoints and TriageItem extension

**Files:**
- Modify: `dashboard.js`
- Create: `tests/categorisation-api.test.js`

**TriageItem field names (locked):**
- `category` (not `primaryCategory`)
- `categorySource` (source string or null)
- `confidence` (decimal or null — overrides/extends the existing scorer confidence field)
- `skipAutomation` (boolean)
- `urgency` (string or null)

- [ ] **Step 7.1: Write failing tests**

```js
// tests/categorisation-api.test.js
const { validateSettings, validateSettingsStrict } = require('../src/categorization-settings');

describe('PUT validation (unit-level)', () => {
  test('valid body passes', () => {
    const valid = {
      topicLabelsGloballyEnabled: true,
      categories: {
        todo: { enabled: true, topicLabelsEnabled: true },
        fyi: { enabled: false, topicLabelsEnabled: true },
        to_follow_up: { enabled: false, topicLabelsEnabled: true },
        notification: { enabled: false, topicLabelsEnabled: true },
        marketing: { enabled: false, topicLabelsEnabled: true },
      },
      topicLabels: [], customRules: [],
    };
    expect(() => validateSettings(valid)).not.toThrow();
  });

  test('unknown key in strict mode throws (PUT → 400)', () => {
    const invalid = {
      topicLabelsGloballyEnabled: true,
      categories: {
        todo: { enabled: true, topicLabelsEnabled: true },
        fyi: { enabled: false, topicLabelsEnabled: true },
        to_follow_up: { enabled: false, topicLabelsEnabled: true },
        notification: { enabled: false, topicLabelsEnabled: true },
        marketing: { enabled: false, topicLabelsEnabled: true },
      },
      topicLabels: [], customRules: [],
      unknownField: 'bad',
    };
    expect(() => validateSettingsStrict(invalid)).toThrow(/unknownField/);
  });

  test('missing categories key throws', () => {
    expect(() => validateSettings({ topicLabelsGloballyEnabled: true })).toThrow();
  });
});

describe('formatTriageItemForApi extensions', () => {
  // formatTriageItemForApi must be exported from dashboard.js (module.exports.formatTriageItemForApi = ...)
  let fmt;
  beforeAll(() => {
    try { fmt = require('../dashboard').formatTriageItemForApi; } catch (_) {}
  });

  test('formatTriageItemForApi is exported', () => {
    expect(typeof fmt).toBe('function');
  });

  test('includes category field', () => {
    if (!fmt) return;
    const item = {
      email: { messageId: 'msg1', sender: 'a@b.com', subject: 'Test', threadId: 't1' },
      score: 50, recommendedAction: 'Review', reasons: ['test'],
      category: 'todo', categorySource: 'heuristic',
      categorizationConfidence: 0.5, skipAutomation: false, urgency: 'medium',
    };
    const result = fmt(item);
    expect(result.category).toBe('todo');
    expect(result.categorySource).toBe('heuristic');
    expect(result.skipAutomation).toBe(false);
    expect(result.urgency).toBe('medium');
    expect(result.categorizationConfidence).toBe(0.5);
    // Existing confidence field (score %) must not be overwritten
    expect(result.confidence).toBe('50%');
  });

  test('null category renders as null', () => {
    if (!fmt) return;
    const item = {
      email: { messageId: 'msg1', sender: 'a@b.com', subject: 'Test', threadId: 't1' },
      score: null, recommendedAction: null, reasons: [],
      category: null, categorySource: null,
      categorizationConfidence: null, skipAutomation: false, urgency: null,
    };
    const result = fmt(item);
    expect(result.category).toBeNull();
    expect(result.urgency).toBeNull();
  });
});
```

- [ ] **Step 7.2: Run tests to verify the `formatTriageItemForApi` tests fail**

```bash
cd /Users/damian/browser-manager && npm test -- tests/categorisation-api.test.js --runInBand
```
Expected: FAIL on `category` / `urgency` fields

- [ ] **Step 7.3: Extend `formatTriageItemForApi` in `dashboard.js`**

First, export the function so it is testable. Change the declaration from:
```js
function formatTriageItemForApi(item) {
```
to plain function (export it at the bottom alongside other exports, or via module.exports if the file uses CommonJS).

Add `module.exports.formatTriageItemForApi = formatTriageItemForApi;` at the module's export statement, or if the file has no explicit exports, add it after the class declaration.

In `formatTriageItemForApi`, add these fields to the returned object (keep ALL existing fields including the unchanged `confidence: \`${item && item.score}%\``):
```js
category: item && item.category !== undefined ? item.category : null,
categorySource: item && item.categorySource || null,
// 'categorizationConfidence' — decimal [0,1]; distinct from 'confidence' which is the score %
categorizationConfidence: item && item.categorizationConfidence !== undefined
  ? item.categorizationConfidence : null,
skipAutomation: Boolean(item && item.skipAutomation),
urgency: item && item.urgency || null,
recommendedAction: item && item.recommendedAction || null,
```

Do NOT overwrite the existing `confidence` field — it remains as the score percentage string.

- [ ] **Step 7.4: Add `GET/PUT /api/settings/categorisation` endpoints**

Near the top of `dashboard.js`, add:
```js
const { loadSettings: loadCatSettings, validateSettingsStrict, updateCache } = require('./src/categorization-settings');
const catSettingsPath = path.join(__dirname, 'config/categorisation-settings.json');
```

Add routes (after existing settings routes):
```js
app.get('/api/settings/categorisation', (req, res) => {
  try {
    const settings = loadCatSettings(catSettingsPath);
    res.json(settings);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.put('/api/settings/categorisation', express.json(), (req, res) => {
  try {
    const validated = validateSettingsStrict(req.body);
    fs.writeFileSync(catSettingsPath, JSON.stringify(validated, null, 2), 'utf8');
    updateCache(validated);
    broadcast({ type: 'settings_updated', scope: 'categorisation', settings: validated });
    res.json(validated);
  } catch (err) {
    res.status(400).send(err.message);
  }
});
```

- [ ] **Step 7.5: Run API tests**

```bash
cd /Users/damian/browser-manager && npm test -- tests/categorisation-api.test.js --runInBand
```
Expected: all PASS

- [ ] **Step 7.6: Commit**

```bash
cd /Users/damian/browser-manager && git add dashboard.js tests/categorisation-api.test.js && git commit -m "feat: add categorisation settings API and extend TriageItem shape"
```

---

## Task 8: Frontend — category badge

**Files:**
- Modify: `public/app.js`

- [ ] **Step 8.1: Add `renderCategoryBadge` helper**

```js
const CATEGORY_LABELS = {
  todo: 'Todo',
  fyi: 'FYI',
  to_follow_up: 'Follow Up',
  notification: 'Notification',
  marketing: 'Marketing',
};

function renderCategoryBadge(category, skipAutomation) {
  const label = category ? (CATEGORY_LABELS[category] || category) : '—';
  const cls = category ? `category-badge category-${category}` : 'category-badge category-null';
  const badge = `<span class="${cls}">${label}</span>`;
  const indicator = skipAutomation
    ? ` <span class="skip-automation-indicator" title="Automation disabled by rule">⊘</span>`
    : '';
  return badge + indicator;
}
```

- [ ] **Step 8.2: Insert badge into row rendering**

Find the loop that builds email row HTML. Add `renderCategoryBadge(item.category, item.skipAutomation)` after sender, before subject column.

- [ ] **Step 8.3: Add CSS for badge colours**

In the style block, add:
```css
.category-badge { padding: 2px 8px; border-radius: 3px; font-size: 0.8em; font-weight: 500; min-width: 80px; display: inline-block; text-align: center; }
.category-todo { background: #dbeafe; color: #1e40af; }
.category-fyi { background: #dcfce7; color: #166534; }
.category-to_follow_up { background: #fef9c3; color: #854d0e; }
.category-notification { background: #f3f4f6; color: #374151; }
.category-marketing { background: #fce7f3; color: #9d174d; }
.category-null { background: #f3f4f6; color: #9ca3af; }
.skip-automation-indicator { font-size: 0.75em; color: #6b7280; margin-left: 4px; }
```

- [ ] **Step 8.4: Handle `settings_updated` WebSocket event**

First, define the panel update function (can be a stub that calls `renderCategorisationPanel` — the full implementation is in Task 9):
```js
function updateCategorisationSettingsPanel(settings) {
  // Re-render the panel with the new (server-confirmed) settings
  // Called both on initial load and when a settings_updated WS event arrives
  renderCategorisationPanel(settings);
}
```

In the WebSocket `message` handler, add a `settings_updated` case:
```js
case 'settings_updated':
  if (msg.scope === 'categorisation') {
    updateCategorisationSettingsPanel(msg.settings);
  }
  break;
```

- [ ] **Step 8.5: Create placeholder UI test file**

```js
// tests/ui/categorisation-ui.test.js
// UI rendering is tested manually. This file reserves the path for future jsdom tests.
describe('category badge', () => {
  test('placeholder: UI tests to be added', () => {
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 8.6: Manually verify in browser**

```bash
cd /Users/damian/browser-manager && npm start 2>&1 | head -10
```
Open http://localhost:4100. Verify:
- Each triage row shows a coloured category badge
- `skipAutomation` items show ⊘ indicator
- `null` category renders `—` in muted colour

- [ ] **Step 8.7: Commit**

```bash
cd /Users/damian/browser-manager && git add public/app.js tests/ui/categorisation-ui.test.js && git commit -m "feat: add category badge rendering and UI test placeholder"
```

---

## Task 9: Frontend — categorisation settings panel

**Files:**
- Modify: `public/app.js`

- [ ] **Step 9.1: Add settings panel skeleton**

Add a "Categorisation" section in the settings view containing:
- Global topic labels toggle (`topicLabelsGloballyEnabled`)
- Five per-category cards (in canonical order: todo, fyi, to_follow_up, notification, marketing)
  - Enable toggle, target folder name input, Outlook category tag input, per-category topic labels toggle
  - When `enabled === false`: show note "Actions will not run for this category"
  - When both folder and tag empty (but enabled): show note "No actions configured — categorisation will still apply"
- Topic labels list (add/remove, per-label: key, patterns, mapsToCategory, enabled toggle)
- Custom rules list (add/remove, per-rule: type, value, action, enabled toggle)

- [ ] **Step 9.2: Wire GET on panel open**

```js
async function loadCategorisationSettings() {
  const panel = document.getElementById('categorisation-settings');
  if (panel) panel.classList.add('loading');
  try {
    const res = await fetch('/api/settings/categorisation');
    const settings = await res.json();
    renderCategorisationPanel(settings);
  } catch (err) {
    showSettingsLoadError(err.message);
  } finally {
    if (panel) panel.classList.remove('loading');
  }
}
```

- [ ] **Step 9.3: Wire PUT on save**

```js
async function saveCategorisationSettings(settings) {
  const btn = document.getElementById('save-categorisation-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const res = await fetch('/api/settings/categorisation', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (!res.ok) {
      const err = await res.text();
      showSettingsPanelError(err); // inline error, preserve user input
      return;
    }
    showSaveSuccess('#categorisation-settings'); // brief 2s indicator
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
  }
}
```

- [ ] **Step 9.4: Inline validation for rules and labels**

Before adding a custom rule: validate non-empty value and non-duplicate ID (show inline error, block add).
Before adding a topic label: validate at least one non-empty pattern and non-duplicate key.

- [ ] **Step 9.5: Disable topic label inputs when global toggle is off**

When `topicLabelsGloballyEnabled` toggle is turned off, grey out and disable all per-category `topicLabelsEnabled` toggles and all topic label pattern inputs.

- [ ] **Step 9.6: Manually verify settings panel**

Open settings. Verify:
- Loading spinner briefly visible
- Category cards render with all fields
- Enable toggles work; inert note shown when disabled
- No-actions note shown when folder and tag both empty (but enabled)
- Save succeeds and shows confirmation
- PUT with unknown field (add via devtools): 400 error shown inline, input preserved
- `settings_updated` WS event updates panel in real-time

- [ ] **Step 9.7: Commit**

```bash
cd /Users/damian/browser-manager && git add public/app.js && git commit -m "feat: add categorisation settings panel UI"
```

---

## Task 10: Full test suite verification

- [ ] **Step 10.1: Run all tests**

```bash
cd /Users/damian/browser-manager && npm test -- --runInBand 2>&1 | tail -40
```
Expected: all tests PASS, no failures, no regressions

- [ ] **Step 10.2: Smoke test of running app**

```bash
cd /Users/damian/browser-manager && npm start
```
Verify:
- App starts without error
- Triage loads and shows coloured category badges
- Settings tab shows Categorisation panel with all five category cards
- GET /api/settings/categorisation returns 200 with valid JSON
- PUT /api/settings/categorisation with valid body returns 200
- PUT with `{ "unknownField": true }` (plus required keys) returns 400

- [ ] **Step 10.3: Final commit**

```bash
cd /Users/damian/browser-manager && git add -A && git commit -m "feat: fyxer email categorisation parity — complete"
```
