# Portal Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the dashboard into a route-based portal with Gmail-style Email, filter-first Logs, and a dedicated Settings view without breaking existing triage/events APIs.

**Architecture:** Keep the backend contract stable and concentrate the redesign in the static frontend. Introduce a small pure helper layer for route normalization, email view-model mapping, category/state/tag derivation, log filtering, and persisted UI state. Build the shell first, then the helper layer and tests, then the Email view, pause for a readability checkpoint, and only then add filters, Logs, and Settings migration.

**Tech Stack:** Node.js, Express static frontend, vanilla JavaScript, Jest, browser localStorage

---

## File Map

### Existing files to modify
- `public/index.html` — replace single dashboard layout with route-based shell and dedicated view containers
- `public/app.js` — convert into route-aware controller and orchestrator for Email, Logs, and Settings views
- `public/style.css` — replace current single-panel dashboard styles with portal layout, Gmail-like card system, and Logs table styling
- `dashboard.js` — only if needed for Settings/triage response compatibility; avoid backend changes unless a thin compatibility addition is required

### New files to create
- `public/portal-constants.js` — shared constants like `RECOMMENDED_ACTIONS`, route names, filter labels
- `public/portal-state.js` — localStorage persistence helpers for pinned/done state, pure route helpers, state serialization
- `public/email-helpers.js` — pure helpers for email mapping, category derivation, tag derivation, action normalization, time display selection, filter composition
- `public/log-helpers.js` — pure helpers for log filtering, time-window filtering, paused/live semantics, table summary shaping
- `tests/email-helpers.test.js` — unit tests for email mapping and filter logic
- `tests/log-helpers.test.js` — unit tests for log filter logic and live semantics helpers
- `tests/portal-state.test.js` — unit tests for route normalization and persisted local state helpers

### Existing files to reference
- `tests/email-scorer.test.js` — example Jest style already used in repo
- `tests/email-triage.test.js` — example object-shape assertions for triage output
- `public/index.html` — current DOM anchor points to replace cleanly
- `public/app.js` — current websocket/event/triage/settings flow to preserve while restructuring
- `public/style.css` — current button/status classes that may be reused or replaced

### Module loading decision
- The browser has no bundler, so helper files under `public/` must work in two environments:
  - Browser: loaded by plain `<script>` tags before `app.js` and attached to `window.PortalHelpers` / `window.PortalConstants`
  - Jest: exported through `module.exports`
- Use a lightweight dual-export pattern in each helper file:

```js
const api = { normalizeRoute };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}

if (typeof window !== 'undefined') {
  window.PortalState = api;
}
```

---

### Task 1: Build the Route Shell Skeleton

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/style.css`
- Test: manual browser validation at `http://localhost:4100/#email`

- [ ] **Step 1: Replace the single-page content structure with a shell layout**

Add top navigation and three route containers in `public/index.html`:

```html
<nav class="portal-nav">
  <button data-route="email" class="portal-nav-link is-active">Email</button>
  <button data-route="logs" class="portal-nav-link">Logs</button>
  <button data-route="settings" class="portal-nav-link">Settings</button>
</nav>

<main class="portal-main">
  <section id="view-email" data-view="email"></section>
  <section id="view-logs" data-view="logs" hidden></section>
  <section id="view-settings" data-view="settings" hidden></section>
</main>
```

- [ ] **Step 2: Add minimal route controller in `public/app.js`**

Implement tiny helpers inline first if needed, then move later:

```js
function normalizeRoute(hash) {
  const route = String(hash || '').replace(/^#/, '');
  return ['email', 'logs', 'settings'].includes(route) ? route : 'email';
}

function applyRoute(route) {
  document.querySelectorAll('[data-view]').forEach((node) => {
    node.hidden = node.dataset.view !== route;
  });
}
```

- [ ] **Step 3: Add shell-only styles in `public/style.css`**

Create base portal layout styles only: nav, main layout, hidden views, and neutral page sections. Do not style detailed cards or logs table yet.

- [ ] **Step 4: Start the app and validate shell routing manually**

Run: `cd /Users/damian/browser-manager && npm start`

Expected:
- Initial load with no hash lands on `#email`
- App loads at `#email`
- `#logs` and `#settings` switch without full reload
- Unknown hash falls back to `#email`
- Browser back/forward updates visible view correctly

- [ ] **Step 5: Commit shell scaffold**

```bash
git add public/index.html public/app.js public/style.css
git commit -m "feat: add route-based portal shell"
```

### Task 2: Add Pure Portal Helper Layer and Tests

**Files:**
- Create: `public/portal-constants.js`
- Create: `public/portal-state.js`
- Create: `public/email-helpers.js`
- Create: `public/log-helpers.js`
- Create: `tests/portal-state.test.js`
- Create: `tests/email-helpers.test.js`
- Create: `tests/log-helpers.test.js`

- [ ] **Step 1: Write failing tests for route normalization and local state helpers**

`tests/portal-state.test.js`

```js
const { normalizeRoute, mergeEmailUiState } = require('../public/portal-state');

test('normalizeRoute falls back to email', () => {
  expect(normalizeRoute('#unknown')).toBe('email');
});

test('mergeEmailUiState overlays pinned and done by id', () => {
  const items = [{ id: 'a', flagged: true }, { id: 'b' }];
  const persisted = { a: { pinned: true, done: false, updatedAt: '2026-04-12T00:00:00.000Z' } };
  expect(mergeEmailUiState(items, persisted)[0].uiState.pinned).toBe(true);
  expect(mergeEmailUiState(items, persisted)[0].uiState.flagged).toBe(true);
  expect(mergeEmailUiState(items, persisted)[1].uiState.done).toBe(false);
  expect(mergeEmailUiState(items, persisted)[1].uiState.flagged).toBe(false);
});

test('mergeEmailUiState never writes flagged state from persisted storage', () => {
  const items = [{ id: 'a', flagged: false }];
  const persisted = { a: { pinned: false, done: false, flagged: true, updatedAt: '2026-04-12T00:00:00.000Z' } };
  expect(mergeEmailUiState(items, persisted)[0].uiState.flagged).toBe(false);
});
```

- [ ] **Step 2: Write failing tests for email mapping and filtering helpers**

`tests/email-helpers.test.js`

```js
const {
  mapEmailItem,
  deriveRecommendedAction,
  derivePrimaryCategory,
  deriveEmailTags,
  deriveScoreMeta,
  filterEmailItems,
  resolveDisplayTimestamp,
  warnIfLargeEmailList,
  countEmailBuckets,
} = require('../public/email-helpers');

test('deriveRecommendedAction falls back to Review', () => {
  expect(deriveRecommendedAction({ action: 'Weird Value' })).toBe('Review');
});

test('deriveScoreMeta returns secondary confidence display from numeric score', () => {
  expect(deriveScoreMeta({ score: 41 })).toEqual({ score: 41, confidenceText: '41%' });
});

test('mapEmailItem uses stable id fallback from sender and subject', () => {
  const mapped = mapEmailItem({ sender: 'a@b.com', subject: 'Hello', body: 'x', score: 41, reason: 'Unread' }, '2026-04-12T09:00:00.000Z');
  expect(mapped.id).toBeDefined();
  expect(mapped.ingestedAt).toBe('2026-04-12T09:00:00.000Z');
});

test('mapEmailItem generates the same fallback id for the same sender and subject', () => {
  const first = mapEmailItem({ sender: 'a@b.com', subject: 'Hello', body: 'x', score: 41, reason: 'Unread' }, '2026-04-12T09:00:00.000Z');
  const second = mapEmailItem({ sender: 'a@b.com', subject: 'Hello', body: 'changed', score: 41, reason: 'Unread' }, '2026-04-12T09:30:00.000Z');
  expect(first.id).toBe(second.id);
});

test('resolveDisplayTimestamp prefers source timestamp over ingestedAt', () => {
  const resolved = resolveDisplayTimestamp({ timestamp: '2026-04-12T08:00:00.000Z', ingestedAt: '2026-04-12T09:00:00.000Z' });
  expect(resolved.value).toBe('2026-04-12T08:00:00.000Z');
});

test('resolveDisplayTimestamp falls back to ingestedAt when source timestamp is null', () => {
  const resolved = resolveDisplayTimestamp({ timestamp: null, ingestedAt: '2026-04-12T09:00:00.000Z' });
  expect(resolved.value).toBe('2026-04-12T09:00:00.000Z');
});

test('filterEmailItems excludes done items unless done filter is active', () => {
  const items = [{ id: 'a', primaryCategory: 'Needs Reply', tags: [], uiState: { done: true, pinned: false, flagged: false } }];
  expect(filterEmailItems(items, { search: '', category: null, state: null, tag: null })).toHaveLength(0);
  expect(filterEmailItems(items, { search: '', category: null, state: 'Done', tag: null })).toHaveLength(1);
});

test('warnIfLargeEmailList warns when item count exceeds 500', () => {
  const warn = jest.fn();
  warnIfLargeEmailList(new Array(501).fill({}), warn);
  expect(warn).toHaveBeenCalled();
});
```

- [ ] **Step 3: Write failing tests for log helper functions**

`tests/log-helpers.test.js`

```js
const { filterLogs, shouldAppendLiveEvent } = require('../public/log-helpers');

test('shouldAppendLiveEvent returns false when live mode is disabled', () => {
  expect(shouldAppendLiveEvent(false)).toBe(false);
});

test('filterLogs filters by type and search', () => {
  const logs = [{ type: 'automation', action: 'triage', details: { subject: 'hello' }, timestamp: '2026-04-12T10:00:00.000Z' }];
  expect(filterLogs(logs, { search: 'hello', type: 'automation', window: '24h' })).toHaveLength(1);
  expect(filterLogs(logs, { search: 'missing', type: 'automation', window: '24h' })).toHaveLength(0);
});
```

- [ ] **Step 4: Run tests to verify they fail for missing modules/functions**

Run: `cd /Users/damian/browser-manager && npm test -- tests/portal-state.test.js tests/email-helpers.test.js tests/log-helpers.test.js --runInBand`

Expected: FAIL with missing modules or undefined exports

- [ ] **Step 5: Implement minimal pure helper modules**

Add CommonJS exports in the new `public/*.js` files. Keep them framework-free and pure.

Required exports:
- `public/portal-constants.js`: `ROUTES`, `RECOMMENDED_ACTIONS`, `EMAIL_STATE_STORAGE_KEY`
- `public/portal-state.js`: `normalizeRoute`, `readEmailUiState`, `writeEmailUiState`, `mergeEmailUiState`
- `public/email-helpers.js`: `deriveRecommendedAction`, `deriveEmailTags`, `derivePrimaryCategory`, `deriveScoreMeta`, `deriveUiState`, `resolveDisplayTimestamp`, `mapEmailItem`, `filterEmailItems`, `countEmailBuckets`, `warnIfLargeEmailList`
- `public/log-helpers.js`: `filterLogs`, `matchesLogWindow`, `shouldAppendLiveEvent`

- [ ] **Step 6: Run helper tests to verify they pass**

Run: `cd /Users/damian/browser-manager && npm test -- tests/portal-state.test.js tests/email-helpers.test.js tests/log-helpers.test.js --runInBand`

Expected: PASS

- [ ] **Step 7: Commit helper layer**

```bash
git add public/portal-constants.js public/portal-state.js public/email-helpers.js public/log-helpers.js tests/portal-state.test.js tests/email-helpers.test.js tests/log-helpers.test.js
git commit -m "feat: add portal helper layer"
```

### Task 3: Build Basic Email View and Stop for UI Checkpoint

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/style.css`
- Reuse: `public/email-helpers.js`
- Test: manual browser checkpoint

- [ ] **Step 1: Render static Email view scaffolding in the email route container**

Add sections:
- left rail with Categories / State / Tags headings
- email toolbar with search slot and refresh button
- email list container for cards
- email empty state container

- [ ] **Step 2: Wire triage fetch into Email view model mapping**

In `public/app.js`, fetch `/api/emails/triage`, map with `mapEmailItem`, and render basic cards:

```js
const items = (data.items || []).map((item) => mapEmailItem(item, new Date().toISOString()));
```

- [ ] **Step 3: Render collapsed Gmail-style cards only**

Each card should show:
- sender/avatar
- bold subject
- recommended action adjacent to subject
- one-line preview
- at most 2 visible pills plus `+N` overflow indicator if more exist
- timestamp
- quick actions row

Do not build filters yet.

- [ ] **Step 4: Add expanded card content, timestamp tooltip, and action-button event isolation**

Implement card-body click expansion and ensure expanded content includes:
- longer preview/body excerpt
- classification reason
- matched rules/signals
- raw metadata block collapsed by default
- timestamp element with ISO tooltip using resolved display timestamp source

Ensure `Open`, `Pin`, `Done` use `event.stopPropagation()`.

- [ ] **Step 5: Add local pin/done persistence wiring**

Use `readEmailUiState` / `writeEmailUiState` from `public/portal-state.js`. Enforce spec rule that done items disappear unless Done filter is active.

- [ ] **Step 6: Start app and perform manual UI checkpoint**

Run: `cd /Users/damian/browser-manager && npm start`

**STOP. Ask these three questions before proceeding:**

1. **Can I scan this in under 3 seconds?**
   — Subject, action, and sender must be visible at a glance without reading carefully.

2. **Do I know what I need to act on immediately?**
   — The highest-priority items should stand out without any filtering applied.

3. **Does "Done" feel like clearing work, not hiding it?**
   — Marking done should feel satisfying and final, not like sweeping something under a rug.

**If yes to all three → continue to Task 4.**
**If no to any → fix card density, hierarchy, or Done interaction now, not later.**

Additional structural checks:
- subject is dominant and easy to scan
- recommended action is visually close to subject
- cards do not feel crowded
- expand/collapse feels clean
- Open/Pin/Done do not accidentally expand cards
- empty state copy is distinguishable from loading/error states

- [ ] **Step 7: Commit Email basic view after checkpoint approval**

```bash
git add public/index.html public/app.js public/style.css
git commit -m "feat: add basic email portal view"
```

### Task 4: Add Email Filters, Counts, and Refined Empty States

**Files:**
- Modify: `public/app.js`
- Modify: `public/style.css`
- Reuse: `public/email-helpers.js`
- Test: `tests/email-helpers.test.js`

- [ ] **Step 1: Add failing tests for bucket counts and filtered empty-state behavior**

Append to `tests/email-helpers.test.js`:

```js
test('countEmailBuckets computes counts after search scope', () => {
  const items = [
    { sender: 'Vendor', subject: 'Quote', preview: 'Approval needed', primaryCategory: 'Needs Reply', tags: ['Vendor', 'Approval'], uiState: { flagged: false, pinned: false, done: false } },
  ];
  const counts = countEmailBuckets(items, { search: 'quote' });
  expect(counts.categories['Needs Reply']).toBe(1);
});
```

- [ ] **Step 2: Run the focused helper test and verify failure**

Run: `cd /Users/damian/browser-manager && npm test -- tests/email-helpers.test.js --runInBand`

Expected: FAIL for missing count behavior

- [ ] **Step 3: Implement filter state UI in Email view**

Add:
- search input
- category list click handlers
- state list click handlers
- tag chip click handlers
- counts hint: `Counts reflect current search`
- clear-filters action in filtered empty state

- [ ] **Step 4: Update helper logic and rerun tests**

Run: `cd /Users/damian/browser-manager && npm test -- tests/email-helpers.test.js --runInBand`

Expected: PASS

- [ ] **Step 5: Manually verify queue-like behavior of done items**

Run in browser and confirm:
- done item disappears from default list
- done item appears under Done filter
- no-match empty state differs from no-data empty state
- loading state and API-error state are visually distinct from empty states

- [ ] **Step 6: Commit email filter behavior**

```bash
git add public/app.js public/style.css tests/email-helpers.test.js public/email-helpers.js
git commit -m "feat: add email filters and counts"
```

### Task 5: Build the Logs View

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/style.css`
- Reuse: `public/log-helpers.js`
- Test: `tests/log-helpers.test.js`

- [ ] **Step 1: Add failing tests for paused live semantics and time-window filtering**

Append to `tests/log-helpers.test.js`:

```js
test('filterLogs respects time window', () => {
  const now = new Date('2026-04-12T10:00:00.000Z');
  const logs = [{ type: 'automation', action: 'triage', details: {}, timestamp: '2026-04-12T09:50:00.000Z' }];
  expect(filterLogs(logs, { search: '', type: 'all', window: '15m' }, now)).toHaveLength(1);
});
```

- [ ] **Step 2: Run focused log helper tests and verify failure**

Run: `cd /Users/damian/browser-manager && npm test -- tests/log-helpers.test.js --runInBand`

Expected: FAIL for missing time-window logic

- [ ] **Step 3: Build Logs filter bar and table view**

Render:
- search box
- type select
- time select
- clear filters button
- live toggle
- paused/live refresh indicator
- result count
- expandable rows

- [ ] **Step 4: Wire websocket handling through paused/live semantics**

When live is off, drop incoming websocket events instead of appending or buffering them.
When live turns back on, show refresh indicator, reload `/api/events`, then resume append behavior.

- [ ] **Step 5: Rerun log helper tests and manually verify Logs UI**

Run: `cd /Users/damian/browser-manager && npm test -- tests/log-helpers.test.js --runInBand`

Expected: PASS

Manual check:
- empty states are clear
- row click expands details
- live paused indicator is visible when off
- live-on refresh is visible briefly
- loading state and fetch-error state are visually distinct from empty states

- [ ] **Step 6: Commit Logs view**

```bash
git add public/index.html public/app.js public/style.css public/log-helpers.js tests/log-helpers.test.js
git commit -m "feat: add logs portal view"
```

### Task 6: Move Settings into Dedicated View and Final Regression Pass

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/style.css`
- Reuse: existing settings API endpoints in `dashboard.js`

- [ ] **Step 1: Move existing settings form markup into the Settings route container**

Keep same fields and save behavior; remove sidebar-only presentation.

- [ ] **Step 2: Preserve current settings load/save flow in the new route**

Keep using:
- `GET /api/settings`
- `POST /api/settings`

- [ ] **Step 3: Run focused regression checks for helper tests and existing email triage tests**

Run: `cd /Users/damian/browser-manager && npm test -- tests/portal-state.test.js tests/email-helpers.test.js tests/log-helpers.test.js tests/email-scorer.test.js tests/email-triage.test.js tests/email-extractor.test.js --runInBand`

Expected: PASS

- [ ] **Step 4: Run live app verification in Graph mode**

Run:
```bash
cd /Users/damian/browser-manager
pkill -f 'node manager.js' 2>/dev/null || true
EMAIL_PROVIDER=graph npm start
```

Then verify manually:
- `#email` loads and triage data renders
- `#logs` loads and filters work
- `#settings` saves without breaking
- unknown route falls back to `#email`
- websocket-driven log updates append when live mode is on
- websocket-driven log updates do not append when live mode is off

- [ ] **Step 5: Commit final portal integration**

```bash
git add public/index.html public/app.js public/style.css
git commit -m "feat: complete portal redesign"
```

### Task 7: Final Documentation Touch-Up

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README usage section for portal routes**

Document:
- `#email`
- `#logs`
- `#settings`
- Graph mode startup reminder

- [ ] **Step 2: Verify README edit is accurate against running app**

Run: `cd /Users/damian/browser-manager && grep -n "#email\|#logs\|#settings" README.md`

Expected: route references present

- [ ] **Step 3: Commit docs update**

```bash
git add README.md
git commit -m "docs: update portal route usage"
```
