# Fyxer / Outlook Shell Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved shell-first redesign so Email, Settings, and Logs behave and look according to the locked spec while preserving existing backend APIs and websocket flows.

**Architecture:** Frontend-first refactor of the current portal into a persistent sidebar shell and route-owned views. Keep current `/api/*` and websocket contracts unchanged, then recompose existing UI logic into spec-driven regions (Email workspace, Settings IA, Logs). Add focused UI tests for route/state behavior and regression safety before and during implementation.

**Tech Stack:** Vanilla JS frontend (`public/*`), Express + websocket backend (unchanged contracts), Jest + jsdom UI tests.

**Spec:** `docs/superpowers/specs/2026-04-13-fyxer-outlook-shell-design.md`

---

## File Map

**Modify:**
- `public/index.html` — replace top nav shell with sidebar shell + route regions + mobile reader scaffolding
- `public/style.css` — implement flat/quiet design system, shell layout, Email 3-region workspace, responsive breakpoints
- `public/app.js` — route controller, sidebar interaction, Email workspace state model, reader behavior, Settings tab/dirty state behavior
- `public/email-helpers.js` — add UI-safe helpers for row metadata priority and badge mapping
- `public/portal-state.js` — add route/session state keys needed by shell + reader + settings dirty state
- `tests/ui/categorisation-ui.test.js` — Email route/filter/selection/reader behavior tests
- `tests/ui/settings-panel.test.js` — Settings + Categorization IA, save model, dirty behavior tests
- `tests/portal-state.test.js` — route/session state persistence tests
- `tests/email-helpers.test.js` — badge mapping and metadata-priority behavior tests

**Create:**
- `tests/ui/shell-layout.test.js` — sidebar routes, responsive state toggles, mobile reader transitions
- `tests/ui/email-workspace-contract.test.js` — workspace selection, empty/error/loading, search/filter precedence

**No backend contract changes expected:**
- `dashboard.js`, `manager.js`, `src/*` remain API-compatible

---

### Task 1: Shell Route Contract Test Baseline

**Files:**
- Create: `tests/ui/shell-layout.test.js`
- Modify: `tests/ui/categorisation-ui.test.js`

- [ ] **Step 1: Write failing tests for shell routes and default fallback**

```js
// tests/ui/shell-layout.test.js
it('defaults unknown hash to email route', async () => {
  window.location.hash = '#unknown';
  await bootstrapApp();
  expect(getActiveRoute()).toBe('email');
});

it('sidebar contains email/settings/logs only', async () => {
  await bootstrapApp();
  const labels = getSidebarRouteLabels();
  expect(labels).toEqual(['Email', 'Settings', 'Logs']);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd /Users/damian/browser-manager && npm test -- tests/ui/shell-layout.test.js --runInBand`
Expected: FAIL (shell elements/helpers not present)

- [ ] **Step 3: Add minimal test harness utilities for route assertions**

```js
function getActiveRoute() {
  return document.querySelector('[data-route].is-active')?.dataset.route;
}
```

- [ ] **Step 4: Re-run test file to confirm deterministic failures only from missing implementation**

Run: `cd /Users/damian/browser-manager && npm test -- tests/ui/shell-layout.test.js --runInBand`
Expected: FAIL on assertions, no harness/runtime errors

- [ ] **Step 5: Commit baseline tests**

```bash
git add tests/ui/shell-layout.test.js tests/ui/categorisation-ui.test.js
git commit -m "test: add shell route contract baseline"
```

---

### Task 2: Implement Sidebar Shell + Top-Level Views

**Files:**
- Modify: `public/index.html`
- Modify: `public/style.css`
- Test: `tests/ui/shell-layout.test.js`

- [ ] **Step 1: Replace top nav markup with persistent sidebar shell markup**

```html
<aside class="app-sidebar" data-region="app-sidebar">
  <button data-route="email" class="shell-nav-link is-active">Email</button>
  <button data-route="settings" class="shell-nav-link">Settings</button>
  <button data-route="logs" class="shell-nav-link">Logs</button>
</aside>
```

- [ ] **Step 2: Add flat-and-quiet shell CSS and breakpoints**

```css
:root {
  --shell-bg: #f4f6f2;
  --canvas-bg: #fbfcfa;
  --line: #dfe5dc;
}
@media (max-width: 1099px) { .app-sidebar { transform: translateX(-100%); } }
```

- [ ] **Step 3: Keep existing view ids wired (`view-email`, `view-settings`, `view-logs`) with route-compatible visibility**

- [ ] **Step 4: Run shell tests and fix minimal layout contract issues**

Run: `cd /Users/damian/browser-manager && npm test -- tests/ui/shell-layout.test.js --runInBand`
Expected: PASS for route list + default route behavior

- [ ] **Step 5: Commit shell structure**

```bash
git add public/index.html public/style.css tests/ui/shell-layout.test.js
git commit -m "feat: add sidebar shell and route view scaffolding"
```

---

### Task 3: Route Controller + Sidebar Interaction

**Files:**
- Modify: `public/app.js`
- Modify: `public/portal-state.js`
- Test: `tests/portal-state.test.js`
- Test: `tests/ui/shell-layout.test.js`

- [ ] **Step 1: Write failing tests for route persistence and hash fallback behavior**

```js
it('restores last settings tab when returning to settings route', () => {
  setSettingsTab('categorization');
  navigateTo('email');
  navigateTo('settings');
  expect(getSettingsTab()).toBe('categorization');
});
```

- [ ] **Step 2: Implement `resolveRoute(hash)` and hashchange wiring in `public/app.js`**

```js
function resolveRoute(hash) {
  const route = String(hash || '').replace(/^#/, '');
  return ['email', 'settings', 'logs'].includes(route) ? route : 'email';
}
```

- [ ] **Step 3: Add route/session state fields in `public/portal-state.js`**

```js
state.routes = { active: 'email', settingsTab: 'general', categorizationTab: 'general' };
```

- [ ] **Step 4: Run targeted tests**

Run: `cd /Users/damian/browser-manager && npm test -- tests/portal-state.test.js tests/ui/shell-layout.test.js --runInBand`
Expected: PASS

- [ ] **Step 5: Commit route controller state changes**

```bash
git add public/app.js public/portal-state.js tests/portal-state.test.js tests/ui/shell-layout.test.js
git commit -m "feat: implement shell route controller and session state"
```

---

### Task 4: Email Three-Region Workspace + Selection Model

**Files:**
- Modify: `public/index.html`
- Modify: `public/style.css`
- Modify: `public/app.js`
- Create: `tests/ui/email-workspace-contract.test.js`
- Modify: `tests/ui/categorisation-ui.test.js`

- [ ] **Step 1: Write failing tests for three regions and selection invariants**

```js
it('renders filter rail, inbox list, and reader pane regions', async () => {
  await loadEmailView();
  expect(region('filter-rail')).toBeTruthy();
  expect(region('inbox-list')).toBeTruthy();
  expect(region('reader-pane')).toBeTruthy();
});

it('auto-selects first visible item when list is non-empty', async () => {
  await seedTriage(3);
  expect(selectedEmailId()).toBe(firstVisibleEmailId());
});
```

- [ ] **Step 2: Update HTML/CSS structure to explicit three-region email workspace**

```css
.email-workspace {
  display: grid;
  grid-template-columns: 260px minmax(360px, 0.9fr) minmax(420px, 1fr);
  gap: 0;
}

.email-filter-rail { width: 260px; }
.email-inbox-list { min-width: 360px; }
.email-reader-pane { min-width: 420px; }
```

- [ ] **Step 3: Implement selection transitions in `public/app.js`**

```js
if (!selectedId && visibleItems.length) selectedId = visibleItems[0].emailId;
if (selectedId && !visibleItems.some(i => i.emailId === selectedId)) selectedId = visibleItems[0]?.emailId || null;
```

- [ ] **Step 4: Run workspace tests**

Run: `cd /Users/damian/browser-manager && npm test -- tests/ui/email-workspace-contract.test.js tests/ui/categorisation-ui.test.js --runInBand`
Expected: PASS

- [ ] **Step 5: Commit workspace layout + selection model**

```bash
git add public/index.html public/style.css public/app.js tests/ui/email-workspace-contract.test.js tests/ui/categorisation-ui.test.js
git commit -m "feat: implement email workspace regions and selection state"
```

---

### Task 5: Email Empty/Loading/Error + Search/Filter Precedence

**Files:**
- Modify: `public/app.js`
- Modify: `tests/ui/email-workspace-contract.test.js`
- Modify: `tests/ui/categorisation-ui.test.js`

- [ ] **Step 1: Write failing tests for distinct no-results vs error state and filter precedence**

```js
it('applies search before category/state filters on same in-memory dataset', () => {
  const result = applyFilters(items, { search: 'invoice', category: 'Needs Reply', state: 'Pinned' });
  expect(result.every(i => matchesSearch(i, 'invoice'))).toBe(true);
});

it('renders distinct fetch-error state from no-results state', async () => {
  mockFetchFailure();
  await refreshTriage();
  expect(screenText()).toContain('Unable to load messages');
  expect(screenText()).not.toContain('No messages match current filters');
});
```

- [ ] **Step 2: Implement explicit empty/error rendering branches**

- [ ] **Step 3: Implement canonical filter pipeline order**

```js
const searched = applySearch(this.triageItems, filters.search);
const categoryFiltered = applyCategoryFilter(searched, filters.category);
const finalItems = applyStateFilter(categoryFiltered, filters.state);
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/damian/browser-manager && npm test -- tests/ui/email-workspace-contract.test.js tests/ui/categorisation-ui.test.js --runInBand`
Expected: PASS

- [ ] **Step 5: Commit state rendering and filter precedence**

```bash
git add public/app.js tests/ui/email-workspace-contract.test.js tests/ui/categorisation-ui.test.js
git commit -m "feat: add email error-state separation and filter precedence"
```

---

### Task 6: Reader Pane Metadata + Badge Mapping Contract

**Files:**
- Modify: `public/email-helpers.js`
- Modify: `public/app.js`
- Modify: `tests/email-helpers.test.js`
- Modify: `tests/ui/email-workspace-contract.test.js`

- [ ] **Step 1: Write failing tests for static badge mapping source and metadata priority truncation**

```js
it('uses design-system category colors, not backend tag values', () => {
  expect(getCategoryColor('Needs Reply')).toBeDefined();
  expect(getCategoryColorFromOutlookTag?.('Blue')).toBeUndefined();
});

it('reader metadata strip is wrap-based and constrained to two lines on desktop', async () => {
  setViewport(1280, 900);
  await renderReaderWithLongMetadata();
  const strip = getReaderMetadataStrip();
  expect(strip.classList.contains('reader-meta-strip')).toBe(true);
  expect(getComputedStyle(strip).display).toBe('flex');
  expect(getComputedStyle(strip).flexWrap).toBe('wrap');
  expect(strip.dataset.maxLines).toBe('2');
});

it('truncates lower-priority metadata before category/recommended action', async () => {
  await renderReaderWithLongMetadata();
  const visibleKeys = getVisibleMetadataKeys();
  expect(visibleKeys).toContain('category');
  expect(visibleKeys).toContain('recommendedAction');
  expect(visibleKeys.indexOf('urgency')).toBeGreaterThanOrEqual(visibleKeys.indexOf('category'));
});
```

- [ ] **Step 2: Define frontend-owned category color map in `public/email-helpers.js`**

```js
const CATEGORY_COLORS = Object.freeze({
  'Needs Reply': '#2f6f4f',
  'Waiting on Others': '#8b6a2f',
  'FYI': '#4d5f7a',
});
```

- [ ] **Step 3: Render metadata strip with priority truncation (`urgency/source/confidence` lower priority)**

```css
.reader-meta-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
}

.meta-priority-high { order: 1; }
.meta-priority-low { order: 2; min-width: 0; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

@media (min-width: 1100px) {
  .reader-meta-strip[data-max-lines="2"] {
    max-height: calc(2 * 1.35em + 6px);
    overflow: hidden;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/damian/browser-manager && npm test -- tests/email-helpers.test.js tests/ui/email-workspace-contract.test.js --runInBand`
Expected: PASS

- [ ] **Step 5: Commit badge + metadata contract implementation**

```bash
git add public/email-helpers.js public/app.js tests/email-helpers.test.js tests/ui/email-workspace-contract.test.js
git commit -m "feat: enforce static badge mapping and reader metadata priority"
```

---

### Task 7: Settings IA + Explicit Save + Dirty State UX

**Files:**
- Modify: `public/index.html`
- Modify: `public/style.css`
- Modify: `public/app.js`
- Modify: `tests/ui/settings-panel.test.js`
- Modify: `tests/portal-state.test.js`

- [ ] **Step 1: Write failing tests for Settings tabs and explicit save model**

```js
it('does not persist setting toggle changes until Update preferences', async () => {
  toggleSetting('todo-enabled', false);
  expect(api.putSettings).not.toHaveBeenCalled();
  clickUpdatePreferences();
  expect(api.putSettings).toHaveBeenCalledTimes(1);
});

it('shows persistent unsaved-changes indicator when dirty', () => {
  changeAnySetting();
  expect(screenText()).toContain('Unsaved changes');
});

it('settings page does not create nested scroll regions', async () => {
  await openSettings();
  const nestedScrollables = getSettingsScrollContainers();
  expect(nestedScrollables).toHaveLength(0);
});

it('navigating away while dirty does not silently discard changes', async () => {
  await openSettings();
  changeAnySetting();
  navigateTo('email');
  expect(wasUnsavedChangesGuardTriggered()).toBe(true);
});

it('ignores websocket settings_updated while settings form is dirty', async () => {
  await openSettings();
  changeAnySetting();
  const before = currentSettingsFormSnapshot();
  emitWebsocketSettingsUpdated({ categories: { todo: { enabled: false } } });
  expect(currentSettingsFormSnapshot()).toEqual(before);
});
```

- [ ] **Step 2: Implement top-level Settings tabs (`General`, `Categorization`) and nested Categorization tabs (`General`, `Advanced`)**

```css
#view-settings {
  overflow-y: auto;
}

.settings-section,
.settings-tab-panel,
.categorization-panel {
  overflow: visible;
}
```

- [ ] **Step 3: Implement dirty-state indicator and save button state (`disabled while saving`)**

```js
function guardUnsavedSettingsNavigation(nextRoute) {
  if (!settingsDirty) return true;
  return showUnsavedChangesPrompt(nextRoute);
}
```

- [ ] **Step 4: Ensure websocket `settings_updated` does not overwrite dirty local edits**

```js
window.addEventListener('beforeunload', (event) => {
  if (!settingsDirty) return;
  event.preventDefault();
  event.returnValue = '';
});

function handleSettingsUpdated(eventPayload) {
  if (settingsDirty) return; // spec: ignore inbound settings while dirty
  applySettingsToForm(eventPayload);
}
```

- [ ] **Step 5: Run tests and commit**

Run: `cd /Users/damian/browser-manager && npm test -- tests/ui/settings-panel.test.js tests/portal-state.test.js --runInBand`
Expected: PASS

```bash
git add public/index.html public/style.css public/app.js tests/ui/settings-panel.test.js tests/portal-state.test.js
git commit -m "feat: implement settings IA, explicit save, and dirty-state handling"
```

---

### Task 8: Categorization General/Advanced Semantics

**Files:**
- Modify: `public/app.js`
- Modify: `tests/ui/settings-panel.test.js`

- [ ] **Step 1: Write failing tests for 7.5 section semantics and secondary control visibility**

```js
it('shows secondary category controls only when category enabled', async () => {
  setCategoryEnabled('todo', false);
  expect(secondaryControls('todo').every(el => el.hidden)).toBe(true);
});

it('keeps Existing categories separate from Move/Keep behavior semantics', async () => {
  expect(section('existing-categories')).toBeTruthy();
  expect(section('move-out')).toBeTruthy();
  expect(section('keep-in')).toBeTruthy();
});

it('renders fixed section order for categorization general tab', async () => {
  await openCategorizationGeneral();
  expect(getSectionOrder()).toEqual(['move-out', 'keep-in', 'existing-categories', 'topic-labels']);
});
```

- [ ] **Step 2: Implement fixed section order and semantics labels in `public/app.js` rendering logic**

- [ ] **Step 3: Implement control visibility rule (`enabled` gate with optional preview override)**

- [ ] **Step 4: Run tests**

Run: `cd /Users/damian/browser-manager && npm test -- tests/ui/settings-panel.test.js --runInBand`
Expected: PASS

- [ ] **Step 5: Commit categorization semantics**

```bash
git add public/app.js tests/ui/settings-panel.test.js
git commit -m "feat: align categorization tabs with spec semantics"
```

---

### Task 8b: Advanced Custom Rules + Topic Label Ordering

**Files:**
- Modify: `public/app.js`
- Modify: `public/style.css`
- Modify: `tests/ui/settings-panel.test.js`

- [ ] **Step 1: Write failing tests for custom rules rows and stable column alignment**

```js
it('renders custom rule row with enable/input/category/action columns', async () => {
  await openCategorizationAdvanced();
  const columns = getCustomRuleColumnKeys();
  expect(columns).toEqual(['enabled', 'input', 'category', 'action']);
});

it('adding/removing rule rows does not shift unrelated row columns', async () => {
  await openCategorizationAdvanced();
  const before = captureCustomRuleColumnPositions();
  clickAddCustomRule();
  clickRemoveCustomRule(0);
  expect(captureCustomRuleColumnPositions()).toEqual(before);
});

it('topic labels render in saved order and append-only behavior', async () => {
  await openCategorizationGeneral();
  expect(getTopicLabelOrder()).toEqual(['billing', 'important']);
  addTopicLabel('vip');
  expect(getTopicLabelOrder().at(-1)).toBe('vip');
});

it('renders marketing classification strategy controls in Advanced tab', async () => {
  await openCategorizationAdvanced();
  expect(screenText()).toContain('Marketing classification strategy');
  expect(getMarketingStrategyControl()).toBeTruthy();
});

it('renders alternative email identities collection in Advanced tab', async () => {
  await openCategorizationAdvanced();
  expect(screenText()).toContain('Alternative email identities');
  expect(getAlternativeIdentityRows()).toBeTruthy();
});
```

- [ ] **Step 2: Implement Advanced tab custom-rules row renderer and add/remove controls**

```css
.custom-rule-row {
  display: grid;
  grid-template-columns: 80px minmax(220px, 1fr) 180px 80px;
  align-items: center;
  gap: 8px;
}
```

- [ ] **Step 3: Implement marketing classification strategy control block and local-state save wiring in Advanced tab**

```js
renderMarketingStrategySection({
  strategy: settings.marketingStrategy || 'default',
  onChange: markSettingsDirty,
});
```

- [ ] **Step 4: Implement alternative email identities list (add/remove + inline validation + stable row layout)**

```js
renderAlternativeIdentitiesSection({
  identities: settings.alternativeEmails || [],
  onAdd: appendIdentityRow,
  onRemove: removeIdentityRow,
  onChange: markSettingsDirty,
});
```

- [ ] **Step 5: Implement explicit up/down reorder controls for custom rules and topic labels (no drag-and-drop)**

- [ ] **Step 6: Run tests**

Run: `cd /Users/damian/browser-manager && npm test -- tests/ui/settings-panel.test.js --runInBand`
Expected: PASS

- [ ] **Step 7: Commit Advanced tab behavior**

```bash
git add public/app.js public/style.css tests/ui/settings-panel.test.js
git commit -m "feat: implement advanced custom rules and topic label ordering controls"
```

---

### Task 9: Mobile Reader State + Responsive Behavior

**Files:**
- Modify: `public/style.css`
- Modify: `public/app.js`
- Modify: `tests/ui/shell-layout.test.js`
- Modify: `tests/ui/email-workspace-contract.test.js`

- [ ] **Step 1: Write failing tests for mobile list state vs reader state transitions**

```js
it('mobile row tap opens full-screen reader and hides list/rail', async () => {
  setViewport(390, 844);
  tapInboxRow(0);
  expect(isReaderFullscreen()).toBe(true);
  expect(isInboxVisible()).toBe(false);
});

it('tablet/mobile sidebar is controlled by explicit menu toggle', async () => {
  setViewport(768, 900);
  expect(getSidebarMenuToggle()).toBeTruthy();
  clickSidebarMenuToggle();
  expect(isSidebarOpen()).toBe(true);
});
```

- [ ] **Step 2: Implement responsive visibility classes, sidebar menu toggle markup/handler, and explicit reader back behavior**

```html
<button type="button" id="shellMenuToggle" class="shell-menu-toggle" aria-expanded="false">Menu</button>
```

```js
document.getElementById('shellMenuToggle')?.addEventListener('click', () => {
  dashboard.sidebarOpen = !dashboard.sidebarOpen;
  syncSidebarState();
});
```

```css
@media (max-width: 767px) {
  .email-workspace {
    display: flex;
    flex-direction: column;
  }

  .email-filter-rail {
    width: 100%;
    order: 1;
  }

  .email-inbox-list {
    width: 100%;
    min-width: 0;
    order: 2;
  }

  .email-reader-pane {
    display: none;
  }

  .email-workspace.is-reader-open .email-filter-rail,
  .email-workspace.is-reader-open .email-inbox-list {
    display: none;
  }

  .email-workspace.is-reader-open .email-reader-pane {
    display: block;
  }
}
```

- [ ] **Step 3: Preserve list filters, list scroll, and selection when returning from mobile reader**

- [ ] **Step 4: Run responsive tests**

Run: `cd /Users/damian/browser-manager && npm test -- tests/ui/shell-layout.test.js tests/ui/email-workspace-contract.test.js --runInBand`
Expected: PASS

- [ ] **Step 5: Commit responsive reader behavior**

```bash
git add public/style.css public/app.js tests/ui/shell-layout.test.js tests/ui/email-workspace-contract.test.js
git commit -m "feat: implement mobile email list/reader state transitions"
```

---

### Task 10: Logs Alignment + Final Regression + Docs

**Files:**
- Modify: `public/style.css`
- Modify: `public/index.html`
- Modify: `tests/ui/shell-layout.test.js`
- Modify: `README.md` (if route/layout screenshots or notes are maintained)

- [ ] **Step 1: Add/adjust tests to ensure Logs remains task-shaped and not reader-pane patterned**

- [ ] **Step 2: Apply final style alignment so Logs shares shell tokens without mail workspace controls**

- [ ] **Step 3: Run focused suites**

Run: `cd /Users/damian/browser-manager && npm test -- tests/ui/shell-layout.test.js tests/ui/categorisation-ui.test.js tests/ui/settings-panel.test.js --runInBand`
Expected: PASS

- [ ] **Step 4: Run full test suite**

Run: `cd /Users/damian/browser-manager && npm test -- --runInBand`
Expected: PASS (all suites)

- [ ] **Step 5: Commit final integration**

```bash
git add public/index.html public/style.css public/app.js tests/ui/*.test.js tests/portal-state.test.js tests/email-helpers.test.js README.md
git commit -m "feat: implement fyxer outlook shell redesign"
```

---

## Verification Checklist (Before Merge)

- [ ] Route fallback always lands on Email for invalid hashes.
- [ ] Sidebar contains only Email, Settings, Logs.
- [ ] Email three-region behavior works on desktop/tablet; mobile two-state behavior works with explicit back control.
- [ ] Empty, loading, and error states are distinct and spec-compliant.
- [ ] Search/filter precedence follows: search -> category/state filters.
- [ ] Badge color mapping is frontend-owned and static.
- [ ] Settings explicit-save model works; dirty state is visible and protected.
- [ ] Categorization General/Advanced semantics and visibility rules match spec.
- [ ] Logs shares shell design tokens but keeps logs-first interaction model.

## Risks + Mitigations

- **Risk:** Regressions from large `public/app.js` edits.
  - **Mitigation:** Land in small test-first commits per task; keep helper extraction incremental.
- **Risk:** CSS conflicts from legacy styles.
  - **Mitigation:** Introduce shell-scoped class prefixes and validate per-view snapshots/selectors in tests.
- **Risk:** Hidden coupling with websocket update handlers.
  - **Mitigation:** Add targeted tests for selection preservation and dirty-state websocket ignore behavior.

## Execution Notes

- Keep backend routes/websocket payload shapes unchanged unless a task explicitly documents a compatible extension.
- Prefer adding pure helper functions for filter/selection logic so tests remain deterministic.
- If any task requires touching backend contracts, stop and update spec/plan before implementation.

---

Plan complete and saved to `docs/superpowers/plans/2026-04-13-fyxer-outlook-shell-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?