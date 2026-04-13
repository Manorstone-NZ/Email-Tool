# Fyxer Email Categorisation Parity — Design Spec

> **For agentic workers:** This spec defines a new email categorisation pipeline for the browser-manager app. It introduces three new modules (`email-categorizer.js`, `categorization-settings.js`, `mail-action-service.js`) and updates the existing scorer and dashboard. Provider scope: Outlook/Microsoft Graph only. No Gmail support in this implementation.

---

## Goal

Recreate Fyxer-parity email categorisation in the browser-manager app. Insert a categoriser layer between the extractor and scorer. Drive Outlook mail actions (folder move, colour tag) from categorisation decisions. Expose settings and category state in the dashboard UI.

## Architecture

Pipeline order (locked):

```
extractor → categoriser → scorer → action_service
```

**Option B** architecture: categoriser is a separate module inserted between extractor and scorer. The existing scorer is updated to consume `CategorizationDecision` rather than raw email fields.

## Provider Scope

Outlook/Microsoft Graph only. All Graph operations use existing `Mail.ReadWrite` scope. No Gmail support.

---

## Locked Contracts

These must not be changed during implementation without updating this spec.

### `CanonicalCategory`
```js
type CanonicalCategory = 'todo' | 'fyi' | 'to_follow_up' | 'notification' | 'marketing';
```

### `CategorizationDecision`
```js
type CategorizationDecision = {
  category: CanonicalCategory;
  skipAutomation: boolean;
  source: 'custom_rule' | 'reply_transition' | 'topic_label' | 'heuristic';
  confidence: number;         // finite, 0–1 inclusive; see bounds by source below
  matchedRuleId?: string;     // present when source === 'custom_rule'
  matchedTopicLabel?: string; // present when source === 'topic_label'
  reasons: string[];
};
```

Confidence bounds by source (binding):

| Source | Confidence bound |
|---|---|
| `heuristic` | 0–0.8 inclusive |
| `topic_label` | 0–0.9 inclusive |
| `reply_transition` | 0–0.95 inclusive |
| `custom_rule` | exactly 1.0 |

### `ScoringResult`
```js
type ScoringResult = {
  urgency: 'low' | 'medium' | 'high';
  score: number;              // 0–100
  recommendedAction: 'Review Later' | 'Review / Respond' | 'Approve / Decide' | 'Review';
  reasons: string[];
};
```

### `ActionResult`
```js
type ActionResult = {
  category: CanonicalCategory;
  skipped: boolean;
  skipReason?: 'skip_automation' | 'category_disabled' | 'no_actions_configured';
  actionsAttempted: Array<'move' | 'tag'>;
  actionsApplied: Array<'move' | 'tag'>;
  actionsSkipped: Array<{
    action: 'move' | 'tag';
    reason: string;
  }>;
  errors: Array<{
    action: 'move' | 'tag';
    code?: string | number;
    message: string;
    retryAttempted: boolean;
  }>;
};
```

### `TriageItem` (WebSocket + API shape)
```js
type TriageItem = {
  id: string;
  emailId: string;
  messageId: string;
  threadId: string;
  sender: string;
  subject: string;
  preview?: string;
  receivedAt?: string;
  category: CanonicalCategory | null;
  categorySource: 'custom_rule' | 'reply_transition' | 'topic_label' | 'heuristic' | null;
  confidence: number | null;
  skipAutomation: boolean;
  urgency: 'low' | 'medium' | 'high' | null;
};
```

`category`, `categorySource`, `confidence`, and `urgency` are `null` when categorisation has not yet run. All fields are always present — never omitted.

### `TopicLabel`
```js
type TopicLabel = {
  id: string;
  key: string;
  patterns: string[];         // matched as case-insensitive substrings
  mapsToCategory: CanonicalCategory;
  enabled: boolean;
};
```

---

## Section 1 — Architecture & Data Flow

### Extractor output shape (input to categoriser)

```js
{
  messageId: string,
  threadId: string,
  sender: string,           // full email address
  senderDomain: string,     // pre-parsed by extractor — categoriser must not re-parse
  recipients: string[],
  subject: string,
  preview: string,
  receivedAt: string,       // ISO 8601
  hasUserReplyInThread: boolean,
  outlookCategories: string[],
  isRead: boolean
}
```

### Pipeline responsibilities

| Module | Responsibility | May call Graph? |
|---|---|---|
| `graph-email-extractor.js` | Normalise Graph messages; set `hasUserReplyInThread`; parse `senderDomain` | Yes (read only) |
| `email-categorizer.js` | Assign category and skip flag | No |
| `email-scorer.js` | Compute urgency and score | No |
| `mail-action-service.js` | Apply folder move and colour tag | Yes (write) |

`hasUserReplyInThread` is computed by the extractor at fetch time. The categoriser must never make Graph calls to determine this.

### `null` category pipeline behaviour (locked)

- `TriageItem` emitted with `category: null` before categorisation completes
- When `category === null`: scorer does not run; action service does not run
- `TriageItem` is still emitted — the pipeline does not crash
- Subsequent update after categorisation populates `category`, then scorer and action service run normally

---

## Section 2 — Settings Data Model

### Module: `categorization-settings.js`

Declarative config only. No logic. Exports a validated settings object loaded from `config/categorisation-settings.json`.

**Validation at load time:**
- Unknown top-level keys: ignored, warning logged (manual edits tolerated at file load)
- Invalid category names: `resolveToCanonicalCategory` rejects; rule/entry skipped with warning; valid entries still load
- Invalid custom rule (empty value, unknown type, duplicate ID): skipped with warning
- Invalid topic label (empty patterns, duplicate key): skipped with warning
- Missing required keys: throws at load time

**API PUT validation is stricter:** unknown keys at API → `400` (rejected, not ignored).

### Settings shape

```js
{
  topicLabelsGloballyEnabled: boolean,   // default: true

  categories: {
    [category: CanonicalCategory]: {
      enabled: boolean,
      targetFolderName?: string,         // display name — resolved to folder ID via cache
      outlookCategoryTag?: string,       // Outlook category tag string
      topicLabelsEnabled: boolean,
    }
  },

  topicLabels: TopicLabel[],             // ordered list; evaluation order = array order

  customRules: Array<{
    id: string,                          // format: rule_<unix_timestamp_ms>; must be unique
    enabled: boolean,
    type: 'sender_email' | 'sender_domain' | 'subject_contains' | 'subject_exact',
    value: string,
    action: CanonicalCategory | 'skip_automation',
  }>
}
```

`resolveToCanonicalCategory` is called at settings load time only, for input validation. It is never called during categorisation.

---

## Section 3 — Categoriser and Scorer Contracts

### `email-categorizer.js` public interface

```js
function categorize(email, settings) -> CategorizationDecision
```

- Fully synchronous. No external calls. No module-level state. Settings injected.
- Must never throw. If an internal error occurs, falls back to `categorizeWithoutCustomRules()` with `source: 'heuristic'`, returns valid decision, logs error.
- **Determinism:** same `email` + `settings` always returns the same `CategorizationDecision`. No time-dependent or random behaviour.

### Internal execution flow

1. **Custom rules** — array order, first match wins
2. **Reply transition** — fires only when *base category* (steps 3–4) would be `todo`
3. **Topic-label detection** — first matching enabled label
4. **Default heuristic** — always produces a result

### Step 1 — Custom rules

When a custom rule produces `skip_automation`:
- Call `categorizeWithoutCustomRules()` (private — executes steps 2–4 only) to get the natural category
- Return that natural `CategorizationDecision` with `skipAutomation: true`
- `matchedRuleId` set to the matching rule's ID
- `source` reflects the natural source (e.g. `'heuristic'`), not `'custom_rule'`

`categorizeWithoutCustomRules` must never apply `skipAutomation` logic. It is a pure execution of steps 2–4.

### Step 2 — Reply transition

**Base category:** the category that would be produced by steps 3–4, excluding custom rules.

Fires when:
- `email.hasUserReplyInThread === true`
- base category is `todo`

When it fires: category → `to_follow_up`, `source: 'reply_transition'`.

**Explicit constraint:** reply transition does not override topic-label detection unless that topic-label category is `todo`. If topic-label assigns `notification`, `fyi`, or any other non-`todo` category, reply transition does not fire.

### Step 3 — Topic-label detection

Input normalisation (same as rule matching):
```
trim().replace(/\s+/g, ' ').toLowerCase()
```
Applied to the combined `sender + subject + preview` string before matching.

**Enable flag precedence:**
1. `settings.topicLabelsGloballyEnabled === false` → skip entirely, proceed to step 4
2. Label matches but `settings[mappedCategory].topicLabelsEnabled === false` → ignore this label, continue scanning
3. First label passing both checks wins

### Step 4 — Default heuristic

- Always returns a valid `CanonicalCategory`; never `null`
- `confidence` must be a finite number in [0, 0.8]; never `NaN`, `Infinity`, or `undefined`
- Tie-break: `todo > to_follow_up > fyi > notification > marketing`
- `source: 'heuristic'`

### `matchesRule` normalisation

| Field | Normalisation |
|---|---|
| `sender_email` | case-insensitive |
| `sender_domain` | case-insensitive; matched against pre-parsed `email.senderDomain` |
| `subject_exact` | `trim().replace(/\s+/g, ' ').toLowerCase()` |
| `subject_contains` | same |

Domain matching uses `email.senderDomain` directly. Never raw substring of sender address.

### `email-scorer.js` public interface

```js
function score(email, decision) -> ScoringResult
```

- No external calls. No async. No settings access.
- Must not reassign `decision.category`.
- Must not determine folder or colour tag.
- Must not trigger mail actions.
- Does not run when `decision === null` (i.e. `category === null`).
- **Determinism:** same `email` + `decision` always returns the same `ScoringResult`. Time-derived values use only timestamps from `email` — never `Date.now()`.

### Urgency constraints by category

| Category | Urgency constraint |
|---|---|
| `marketing` | must be `low` unless explicit override signal |
| `notification` | `low` or `medium` only; never `high` from default signals |
| `to_follow_up` | derived from elapsed time since last outbound in thread; not from original content urgency |
| `todo` | full range allowed |
| `fyi` | `low` or `medium`; `high` only with explicit signal |

---

## Section 4 — Action Service Contract

### Module: `mail-action-service.js`

The only module that makes outbound Graph API calls to modify mailbox state.

### Terminology

| Term | Meaning |
|---|---|
| `targetFolderName` | Display name of destination folder, from settings config |
| `resolvedTargetFolderId` | Graph folder ID resolved from `targetFolderName` via folder cache |
| Outlook category tag | The configured string tag applied to the message's `categories` array |
| `outlookCategories` | The current `categories` array on the email object |

### Minimum required fields on email input

```js
{
  messageId: string;
  currentFolderId: string;
  outlookCategories: string[];
}
```

The service must not access body content.

### Public interface

```js
async function applyActions(email, decision, settings) -> ActionResult
```

- Never throws. Callers always receive a structured `ActionResult`.

### Guard 1: `skipAutomation`

First check, before any evaluation:
```
if (decision.skipAutomation === true)
  → return immediately with skipReason: 'skip_automation', zero Graph calls
```

### Guard 2: category enabled

```
if (settings.categories[decision.category].enabled !== true)
  → return immediately with skipReason: 'category_disabled', zero Graph calls
```

If category is disabled, neither folder move nor tag evaluation occurs.

### Guard 3: no actions configured

```
if (!targetFolderName && !outlookCategoryTag)
  → return immediately with skipReason: 'no_actions_configured', zero Graph calls
```

### Guard precedence

`skipAutomation` takes precedence over `category_disabled` when both are true. `skipReason: 'skip_automation'` is returned.

### Action execution order

1. **Folder move** — if `targetFolderName` is set
2. **Outlook category tag** — if `outlookCategoryTag` is set

Each action is independent. Failure on (1) does not skip (2).

**Message ID continuity:** if the Graph move returns an updated message identifier, the tag operation must target the returned identifier, not the original `email.messageId`.

### Idempotency

Checks performed against current email state plus any updated identifiers returned by earlier actions in the same call.

- **Folder move:** `email.currentFolderId === resolvedTargetFolderId` → skip, add to `actionsSkipped`
- **Tag:** `email.outlookCategories` contains `outlookCategoryTag` (case-insensitive) → skip

"Already in correct state" is not an error.

### Graph operations

**Folder move:**
```
PATCH /me/messages/{messageId}
Body: { "parentFolderId": "<resolvedTargetFolderId>" }
```

**Outlook category tag — merge semantics:**
1. Take current `outlookCategories`
2. Append `outlookCategoryTag` if not already present (case-insensitive match)
3. De-duplicate resulting array case-insensitively (preserve first occurrence)
4. PATCH with the de-duplicated result

Existing Outlook category tags are preserved.

### Folder cache

```js
folderCache: Map<displayName, folderId>
```

- Populated once at startup via `GET /me/mailFolders`
- Never refreshed mid-run
- Does not create missing folders — missing `targetFolderName` is a configuration error; move is skipped
- If cache is unavailable: move actions skipped with logged error; tag actions may still proceed
- If cache contains duplicate folder names: first match wins; second entry ignored; warning logged

### Retry rules

Each action gets at most two total attempts (one initial + one retry):

| Error | Behaviour |
|---|---|
| 429 | Wait `Retry-After` header duration, retry once. Still 429 → `errors`, `retryAttempted: true` |
| 503 | Use `Retry-After` if present, else wait 1 second, retry once. Still 503 → `errors`, `retryAttempted: true` |
| 401 / 403 | Log auth error, no retry, `retryAttempted: false` |
| 400 / 404 | Log error, no retry, `retryAttempted: false` |
| Network timeout | Log error, no retry, `retryAttempted: false` |

### Logging

Each attempted action must log: message identifier, category, action type, outcome (`applied` / `skipped` / `failed`), reason or error code.

### Non-goals

- Does not create missing folders
- Does not re-categorise or modify `decision`
- Does not call categoriser or scorer
- Does not read email body content

---

## Section 5 — Dashboard & UI Contract

### Scope

Additive changes only. Existing triage layout, tab structure, and WebSocket event names are unchanged.

### Triage view — category badge

Position: alongside sender/subject. Fixed-width container — no layout shift on WebSocket updates.

| Category | Badge label |
|---|---|
| `todo` | Todo |
| `fyi` | FYI |
| `to_follow_up` | Follow Up |
| `notification` | Notification |
| `marketing` | Marketing |
| `null` | — (em dash, grey) |

- UI category colours are defined in the frontend — not derived from Outlook category tag names or Outlook colour values
- `null` renders neutral grey; no suppression indicator unless `skipAutomation === true`
- `null` must not be persisted in UI state — it is transient
- `skipAutomation: true` renders a secondary-weight indicator with tooltip: `"Automation disabled by rule"`
- Category badge does not affect sort order in v1

### Settings tab — Categorisation panel

Appended below existing settings. Structure:

```
Categorisation
├── [Global toggle] Topic label detection: ON/OFF
├── Per-category cards (fixed order: todo → fyi → to_follow_up → notification → marketing)
├── Topic labels
└── Custom rules
```

Fixed canonical order is used in category cards, all dropdowns, and all ordered lists everywhere.

### Per-category card fields

| Field | Control | Setting key |
|---|---|---|
| Enable automation | Toggle | `categories[cat].enabled` |
| Target folder | Text input | `categories[cat].targetFolderName` |
| Outlook category tag | Text input | `categories[cat].outlookCategoryTag` |
| Enable topic labels | Toggle | `categories[cat].topicLabelsEnabled` |

- When `enabled === false`: inputs remain editable; helper note shown: `"Changes will not apply until this category is enabled."`
- `topicLabelsEnabled` toggle is greyed and non-interactive when global toggle is off; tooltip: `"Topic label detection is disabled globally"`
- When both `targetFolderName` and `outlookCategoryTag` are empty: note shown: `"No actions configured for this category"`

### Topic labels

Ordered list. Evaluation order = list order. New labels appended to end.

Each entry: key, patterns (comma-separated), mapped category badge, enabled toggle, × delete.

Validation: duplicate key → rejected; empty patterns → rejected; invalid category → not possible via dropdown.

Patterns matched as case-insensitive substrings.

### Custom rules

Ordered list. List order = evaluation order.

Each entry: enabled toggle, rule type, value, action, ↑ ↓ reorder, × delete.

Rule ID: auto-generated as `rule_<unix_timestamp_ms>`; must be unique; collision rejected.

Enable toggle per rule: disabled rules preserved in config, skipped by categoriser.

↑ on first item and ↓ on last item are no-ops (buttons rendered, greyed).

### Settings persistence API

```
GET  /api/settings/categorisation     → current settings object
PUT  /api/settings/categorisation     → replace full settings object (last write wins)
```

**PUT validation — strict:**
- Unknown top-level keys → 400
- Missing required keys → 400
- Invalid enum values → 400
- Invalid nested structures → 400

Written to `config/categorisation-settings.json`. In-memory cache updated immediately.

On failure: 400 with plain-text error. UI preserves unsaved user input.

### WebSocket event

After successful PUT:
```js
{
  type: 'settings_updated',
  scope: 'categorisation',
  settings: { /* full settings object — not a diff */ }
}
```

On receipt: settings panel re-renders. Triage list not re-rendered. No reclassification of displayed items.

### Loading and save states

- Loading state on GET during mount
- PUT button disabled during save
- Brief success indicator after save (~2 seconds)
- Inline error at top of panel on failure; user input preserved

### What does NOT change

- Existing triage actions (delete, archive)
- Existing settings panel fields
- Overall page layout
- Existing WebSocket event names
- Clicking a category badge does nothing in v1

---

## Section 6 — Testing Strategy

### Guiding principles

1. Pure functions first — categoriser and scorer have zero infrastructure dependency.
2. Graph is always mocked — no test makes a real Graph call.
3. Settings injected everywhere — no test mutates a settings file on disk.
4. Inputs are frozen — `Object.freeze()` applied to all inputs in unit and contract tests.
5. Determinism is verified structurally — deep equality, 10-run loop.
6. Contracts between modules are tested explicitly as their own suite.
7. `null` category is a defined state — pipeline behaves predictably at each stage.

### 6.1 Categoriser unit tests

`tests/email-categorizer.test.js`

**Custom rules:** first match wins; disabled rule skipped; sender/domain/subject normalisation verified per type; `skip_automation` rule returns natural category with `skipAutomation: true`; `source` is natural source not `'custom_rule'`; `matchedRuleId` present for rule matches; `source === 'custom_rule'` → `confidence === 1.0`.

**Source field:** one test per source value asserting exact `source` field.

**Confidence bounds:** `custom_rule` → 1.0; `topic_label` → [0, 0.9]; `reply_transition` → [0, 0.95]; `heuristic` → [0, 0.8].

**Reply transition:** fires when `hasUserReplyInThread: true` and base is `todo`; does not fire when base is `notification` or `fyi`; does not fire when `hasUserReplyInThread: false`; `categorizeWithoutCustomRules` never returns `skipAutomation: true`.

**Topic labels:** global disabled → no label; per-category disabled → label skipped, scan continues; first matching enabled label wins; case-insensitive substring match; `matchedTopicLabel` set.

**Heuristic:** always returns valid `CanonicalCategory`; confidence finite and in [0, 0.8]; tie-break order enforced.

**Malformed input guard:** missing `senderDomain` or `subject` → falls to heuristic, returns valid decision, no crash.

**Error recovery:** internal error during rule scan → fallback to heuristic, logs error.

**Mutation safety:** `email` and `settings` deep-equal before and after call; `Object.freeze()` applied; any mutation throws.

**Determinism (10-run loop):** same frozen input × 10 → all results deep-equal.

### 6.2 Scorer unit tests

`tests/email-scorer.test.js`

**Urgency by category:** `marketing` → never `high` from defaults; `notification` → never `high`; `to_follow_up` → elapsed time drives urgency, `Date.now()` not called; `todo` → all values reachable; `fyi` → `high` only with explicit signal.

**Immutability:** `decision.category` unchanged; `decision` not mutated (`Object.freeze()`); `email` not mutated.

**`skipAutomation: true`:** full valid `ScoringResult` returned.

**Shape invariants:** `urgency` ∈ `{'low','medium','high'}`; `score` ∈ [0,100]; `recommendedAction` valid; `reasons` is Array.

**Determinism (10-run loop):** same frozen inputs × 10 → all results deep-equal.

### 6.3 Action service unit tests

`tests/mail-action-service.test.js`

**Guards:** `skipAutomation: true` → zero Graph calls, `skipReason: 'skip_automation'`; category disabled → zero Graph calls; no config → zero Graph calls; `skipAutomation + category_disabled` simultaneously → `skipReason: 'skip_automation'` takes precedence.

**Idempotency:** folder already correct → move skipped; tag already present (exact) → skipped; tag already present (different case) → skipped; both conditions → `actionsAttempted: ['move','tag']`, `actionsApplied: []`.

**Message ID continuity:** move returns new ID → tag uses returned ID.

**Folder cache:** name not in cache → move skipped, tag attempted; cache unavailable → move skipped, tag attempted; duplicate names → first match wins; warning logged.

**Colour tag merge:** existing `['Inbox']` + new `'Priority'` → PATCH `['Inbox','Priority']`; existing `['priority']` + new `'Priority'` → no PATCH; existing `['priority','Priority']` → de-duplicated.

**Error handling:** 429 retry × 2 → `retryAttempted: true`; 503 retry with timer mock; 401/403 → no retry, `retryAttempted: false`; partial failure captured in `ActionResult`; `applyActions` never throws.

**Retry timing (mock timer):** 503 retry does not occur before ~1000ms; 429 retry does not occur before `Retry-After` header duration.

**Logging:** `skipAutomation` → one log entry; missing folder → structured error log; Graph 401 → auth error log, no retry log.

### 6.4 Contract tests between modules

`tests/contracts/categoriser-scorer.test.js`
`tests/contracts/scorer-action-service.test.js`

- Categoriser output passed directly to scorer → no crash, valid `ScoringResult`, no fields dropped
- `decision` deep-equals original after scorer runs (scorer did not mutate it)
- Decision + scoring result passed to action service → no crash, valid `ActionResult`
- `decision` deep-equals original after action service runs
- Full chain: email object, settings object, and decision object all deep-equal pre-call state after all three modules run

### 6.5 Schema validation tests

`tests/schemas/shape-validation.test.js`

**`CategorizationDecision`:** all required fields present; no unexpected extra fields; types correct; `matchedRuleId` absent when `source !== 'custom_rule'`; `matchedTopicLabel` absent when `source !== 'topic_label'`.

**`ScoringResult`:** all required fields; types and value ranges correct.

**`ActionResult`:** all required fields; `skipReason` present only when `skipped === true`; array field types correct.

### 6.6 Settings validation tests

`tests/categorization-settings.test.js`

Valid settings → loads; unknown top-level key at file load → ignored, warning logged; missing required key → throws; invalid category name → entry skipped with warning; empty rule value → skipped with warning; unknown rule type → skipped; topic label empty patterns → skipped; duplicate topic label key → second skipped; duplicate rule ID → second skipped; `topicLabelsGloballyEnabled` absent → defaults to `true`; all categories disabled → loads successfully.

### 6.7 API endpoint tests

`tests/categorisation-api.test.js`

**GET:** 200 with current settings; shape matches locked type.

**PUT:** valid → 200, cache updated; unknown top-level key → 400, file unchanged; missing required key → 400; invalid enum → 400; invalid nested structure → 400; successful PUT → `settings_updated` WS event emitted with full settings.

**Concurrency:** two rapid sequential PUTs → second overwrites first; cache reflects second payload; WS event reflects final state only; no partial merge.

### 6.8 Pipeline integration tests

`tests/email-triage-pipeline.test.js`

**Happy path:** full chain runs; `TriageItem` emitted with all fields populated.

**`skipAutomation` propagation:** `skip_automation` rule fires → scorer runs, produces valid `ScoringResult` → action service returns `skipReason: 'skip_automation'`; `TriageItem` has `skipAutomation: true`, category set, urgency set.

**`null` category (locked behaviour):** `TriageItem` emitted with `category: null`; scorer does not run; action service does not run; no crash. Subsequent update after categorisation → full pipeline runs normally.

**Category disabled:** categoriser runs, scorer runs, action service returns `skipReason: 'category_disabled'`; `TriageItem` has category and urgency set.

**No actions configured:** categoriser runs, scorer runs, action service returns `skipReason: 'no_actions_configured'`; `TriageItem` rendered with category badge.

**Settings live update:** PUT mid-run → subsequent emails use new settings; previously-emitted items unaffected.

### 6.9 Frontend/UI tests

`tests/ui/categorisation-ui.test.js`

**Badge:** all five categories render correct label; `null` renders `—` with grey; `skipAutomation: true` renders indicator with correct tooltip; badge DOM node reused on WS re-render (no reflow).

**Settings panel:** GET on mount with loading state; renders from fetched data; PUT button disabled during save; success indicator visible after save; PUT failure → inline error, user input preserved; WS `settings_updated` with unsaved edits → user edits not overwritten.

**Category cards:** `enabled === false` → helper note visible, inputs editable; no-actions state → note visible; `topicLabelsEnabled` toggle greyed when global off, tooltip present.

**Custom rules:** enable toggle disables without deleting; ↑ on first / ↓ on last → no-op, greyed; rule ID collision → inline error.

**Topic labels:** duplicate key → inline error; new label appended to end; remove and re-add changes list position.

**Concurrency/state:** `settings_updated` replaces full settings state; triage list does not re-render on `settings_updated`.

### 6.10 Test file map

| File | Covers |
|---|---|
| `tests/email-categorizer.test.js` | Categoriser unit, mutation, determinism, malformed input |
| `tests/email-scorer.test.js` | Scorer unit, immutability, determinism |
| `tests/mail-action-service.test.js` | Action service unit, retry timing, logging |
| `tests/categorization-settings.test.js` | Settings load/validation |
| `tests/categorisation-api.test.js` | REST GET/PUT, WS event, concurrency |
| `tests/contracts/categoriser-scorer.test.js` | Interface contract: categoriser → scorer |
| `tests/contracts/scorer-action-service.test.js` | Interface contract: scorer → action service |
| `tests/schemas/shape-validation.test.js` | Shape tests for all three runtime types |
| `tests/email-triage-pipeline.test.js` | Full pipeline integration |
| `tests/ui/categorisation-ui.test.js` | Frontend rendering, interaction, state |
| `tests/email-id.test.js` | Existing — unchanged |
| `tests/graph-email-extractor.test.js` | Existing — unchanged |
| `tests/email-helpers.test.js` | Existing — unchanged |

### 6.11 What is not tested

- Real Graph API calls — always mocked
- Outlook folder creation — out of scope
- Email body content parsing — extractor's responsibility
- Browser-level E2E (Playwright/Puppeteer) — out of scope for v1

---

## New Files

| File | Purpose |
|---|---|
| `src/email-categorizer.js` | Categoriser (synchronous, injectable settings) |
| `src/categorization-settings.js` | Settings loader and in-memory cache |
| `config/categorisation-settings.json` | Settings config file (created on first run or PUT) |

## Modified Files

| File | Change |
|---|---|
| `src/email-scorer.js` | Consume `CategorizationDecision`; enforce urgency constraints by category |
| `src/mail-action-service.js` | Rewritten to Section 4 contract |
| `dashboard.js` | Add `GET/PUT /api/settings/categorisation`; emit `settings_updated` WS event; extend `formatTriageItemForApi()` |
| `public/app.js` | Category badge rendering; settings panel |

## What Does NOT Change

- Database schema — no changes
- Microsoft Graph auth or scope beyond existing `Mail.ReadWrite`
- Existing triage actions (delete, archive)
- Existing WebSocket event names
- `email-id.js`, `email-helpers.js`, `graph-email-extractor.js` — locked from previous fix

---

## Implementation Order

1. `categorization-settings.js` — no dependencies beyond file I/O
2. `email-categorizer.js` — depends on settings shape
3. `email-scorer.js` — update to consume `CategorizationDecision`
4. `mail-action-service.js` — depends on settings shape and folder cache
5. `dashboard.js` — wire settings API and extend `TriageItem` shape
6. `public/app.js` — badge rendering and settings panel
7. Tests — following the file map in Section 6.10
