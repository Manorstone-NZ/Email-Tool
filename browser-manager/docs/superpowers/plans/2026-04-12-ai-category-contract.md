# AI Category Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the classifier return authoritative category values for email filters, propagate them through triage, and keep heuristic fallback only when AI is unavailable or invalid.

**Architecture:** Extend the normalized priority decision shape in `src/priority-service.js`, persist `primaryCategory` and `categorySource` in `src/email-triage.js`, and update `public/email-helpers.js` to trust validated AI categories before falling back to local derivation.

**Tech Stack:** Node.js, Jest, existing triage services, frontend helper module

---

## File Structure

**Modified files:**
- `src/priority-service.js` — Add required `category` to prompts and validation output.
- `src/email-triage.js` — Persist `primaryCategory` and `categorySource` from AI results.
- `public/email-helpers.js` — Prefer AI category and emit `categorySource` fallback metadata.
- `tests/priority-service.test.js` — Add classifier category validation coverage.
- `tests/email-triage.test.js` — Add triage propagation coverage.
- `tests/email-helpers.test.js` — Add frontend category selection and heuristic fallback coverage.

---

## Task 1: Classifier Contract Test First

**Files:**
- Modify: `tests/priority-service.test.js`
- Modify: `src/priority-service.js`

- [ ] **Step 1: Write the failing tests**

Add tests that require valid classifier output to include a valid category, and reject output with missing or invalid categories.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/damian/browser-manager && npm test -- tests/priority-service.test.js --runInBand`
Expected: FAIL because category is not required yet.

- [ ] **Step 3: Write minimal implementation**

Extend prompt text, validation, and normalized return shape in `src/priority-service.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/damian/browser-manager && npm test -- tests/priority-service.test.js --runInBand`
Expected: PASS.

## Task 2: Triage Propagation Test First

**Files:**
- Modify: `tests/email-triage.test.js`
- Modify: `src/email-triage.js`

- [ ] **Step 1: Write the failing test**

Add a test that verifies triage writes `primaryCategory` and `categorySource = 'ai'` from a validated priority decision.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/damian/browser-manager && npm test -- tests/email-triage.test.js --runInBand`
Expected: FAIL because triage does not propagate category metadata yet.

- [ ] **Step 3: Write minimal implementation**

Persist AI category metadata in `src/email-triage.js` when available.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/damian/browser-manager && npm test -- tests/email-triage.test.js --runInBand`
Expected: PASS.

## Task 3: Frontend Category Fallback Test First

**Files:**
- Modify: `tests/email-helpers.test.js`
- Modify: `public/email-helpers.js`

- [ ] **Step 1: Write the failing tests**

Add tests that verify `mapEmailItem` trusts a valid AI `primaryCategory` and marks `categorySource = 'ai'`, but falls back to heuristic derivation and `categorySource = 'heuristic'` when AI category is absent.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/damian/browser-manager && npm test -- tests/email-helpers.test.js --runInBand`
Expected: FAIL because fallback source metadata and AI category preference are incomplete.

- [ ] **Step 3: Write minimal implementation**

Update `public/email-helpers.js` to prefer valid AI categories and mark the category source.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/damian/browser-manager && npm test -- tests/email-helpers.test.js --runInBand`
Expected: PASS.

## Task 4: Focused Verification

- [ ] **Step 1: Run the focused regression suite**

Run: `cd /Users/damian/browser-manager && npm test -- tests/priority-service.test.js tests/email-triage.test.js tests/email-helpers.test.js --runInBand`
Expected: PASS.

- [ ] **Step 2: Run the broader confidence suite**

Run: `cd /Users/damian/browser-manager && npm test -- tests/priority-service.test.js tests/email-triage.test.js tests/email-helpers.test.js tests/ai-provider-factory.test.js tests/manager-ai-provider.test.js tests/public-app-provider.test.js tests/draft-service.test.js --runInBand`
Expected: PASS.