# AI Provider Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make browser-manager honor configured AI provider selection and display the chosen provider in both triage and draft-review UX.

**Architecture:** Add a small provider factory that resolves settings into provider instances, inject those instances from `manager.js` into existing services, and reuse the existing `providerUsed` field to surface provider provenance in the client. Keep service APIs stable and cover the change with narrow regression tests first.

**Tech Stack:** Node.js, Jest, existing service classes, browser dashboard client

---

## File Structure

**New files:**
- `src/ai-provider-factory.js` — Resolves provider names and models into concrete provider instances.

**Modified files:**
- `manager.js` — Inject resolved providers at startup and after settings updates.
- `public/app.js` — Show provider information more clearly in the draft flow and expose any small helper needed for testing.
- `tests/priority-service.test.js` — Add settings-driven provider-resolution coverage.
- `tests/draft-service.test.js` — Add provider carry-through assertions if needed.
- `tests/dashboard-settings.test.js` or new focused test — Verify provider-related settings handling if parsing changes.
- `tests/public-app.test.js` or equivalent focused test file — Verify provider label formatting/helper behavior if a testable client helper is added.

---

## Task 1: Provider Resolution Test First

**Files:**
- Create: `tests/ai-provider-factory.test.js`
- Create: `src/ai-provider-factory.js`

- [ ] **Step 1: Write the failing test**

Add tests that verify configured provider names resolve to the expected provider classes, map `aiClaudeModel` and `aiGemmaModel` into the provider constructor options, default safely for unknown names, and allow primary/fallback to resolve to the same provider type.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/damian/browser-manager && npm test -- tests/ai-provider-factory.test.js --runInBand`
Expected: FAIL because the factory module does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Implement a provider factory that returns concrete `primaryProvider` and `fallbackProvider` instances using:
- `aiProviderPrimary` and `aiProviderFallback` for provider selection
- `aiClaudeModel` for Claude instances
- `aiGemmaModel` for LM Studio instances
- current defaults when settings are absent or invalid

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/damian/browser-manager && npm test -- tests/ai-provider-factory.test.js --runInBand`
Expected: PASS.

## Task 2: Manager Wiring Test First

**Files:**
- Modify: `manager.js`
- Create or Modify: `tests/manager-ai-provider.test.js`

- [ ] **Step 1: Write the failing test**

Add a test that verifies `BrowserManager` resolves providers from settings and injects them into `PriorityService` and `DraftService`, including re-application inside `applySettings` when AI-related keys are present (`aiProviderPrimary`, `aiProviderFallback`, `aiClaudeModel`, `aiGemmaModel`, `maxDraftLength`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/damian/browser-manager && npm test -- tests/manager-ai-provider.test.js --runInBand`
Expected: FAIL because manager still hard-codes providers.

- [ ] **Step 3: Write minimal implementation**

Wire `manager.js` to call the provider factory during startup and AI settings updates.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/damian/browser-manager && npm test -- tests/manager-ai-provider.test.js --runInBand`
Expected: PASS.

## Task 3: Draft Flow Visibility Test First

**Files:**
- Modify: `public/app.js`
- Create: `tests/public-app-provider.test.js`

- [ ] **Step 1: Write the failing test**

Add a focused test for a small helper or formatter that turns a draft result into provider-visible text for the review flow, using `unknown provider` when `providerUsed` is empty.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/damian/browser-manager && npm test -- tests/public-app-provider.test.js --runInBand`
Expected: FAIL because the helper or visibility behavior does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Update `public/app.js` to format and show provider information after draft generation and before approval/send.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/damian/browser-manager && npm test -- tests/public-app-provider.test.js --runInBand`
Expected: PASS.

## Task 4: Focused Regression Verification

**Files:**
- Modify: existing touched files only as needed

- [ ] **Step 1: Run the focused test set**

Run: `cd /Users/damian/browser-manager && npm test -- tests/ai-provider-factory.test.js tests/manager-ai-provider.test.js tests/public-app-provider.test.js tests/priority-service.test.js tests/draft-service.test.js --runInBand`
Expected: PASS.

- [ ] **Step 2: Run one startup smoke check**

Run: `cd /Users/damian/browser-manager && pkill -f 'node manager.js' 2>/dev/null || true && lsof -ti:4100 | xargs kill -9 2>/dev/null || true && npm start 2>&1 | head -40`
Expected: startup reaches dashboard bind without provider-selection errors.