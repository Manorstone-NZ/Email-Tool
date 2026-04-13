# Portal Redesign Design Spec

Date: 2026-04-12
Status: Draft for review
Owner: GitHub Copilot + Damian

## 1. Goal

Redesign the current dashboard into a cleaner portal with separate views for Email, Logs, and Settings, while preserving existing backend APIs and websocket behavior.

Primary outcomes:
- Move logging into its own page.
- Make email cards richer and easier to triage.
- Add clear categorization and user state handling.
- Use a familiar Gmail-like browsing experience for email.

## 2. Chosen Approach

Selected architecture: **Hybrid route-based shell (Option 3)**.

Rationale:
- Keeps one static app bundle and simple deployment.
- Adds clear separation of concerns without backend routing changes.
- Enables growth without large rework.

Routing model:
- `#email` (default)
- `#logs`
- `#settings`

Top-level navigation:
- Email | Logs | Settings

## 3. Information Architecture

### 3.1 Global
- Top nav is the only primary navigation across views.
- Secondary controls stay inside each view.
- Default route: `#email`.

### 3.2 Email View
- Gmail-style center experience.
- Left rail is split into distinct sections with independent filters and counts:
  - Categories: Needs Reply, Waiting on Others, FYI
  - State: All, Flagged, Pinned, Done
  - Tags (optional section): Approval, Vendor, Urgent
- Main pane shows rich cards with expandable details.
- Search and refresh controls are local to Email view.

Left-rail rule:
- Category and state controls must be visually and structurally separated to avoid filter ambiguity.

### 3.3 Logs View
- Independent page with filter-first table.
- Sticky filter row.
- Newest-first ordering.
- Row click expands details.
- Live updates toggle defaults to off.

### 3.4 Settings View
- Separate page (not slide-out panel).
- Existing settings form moved here.
- Keeps Email and Logs focused and uncluttered.

## 4. Email Classification and State Model

### 4.1 Primary Categories
- Needs Reply
- Waiting on Others
- FYI

### 4.2 State Buckets
- Flagged
- Pinned
- Done

State filter semantics:
- `All` is not a state and represents "no state filter applied".

### 4.3 Tags
- Approval
- Vendor
- Urgent
- Future-ready for additional tags (for example Internal, Customer)

### 4.4 Data Shape (frontend-enriched)
Each rendered email item should include:
- `primaryCategory`: `Needs Reply | Waiting on Others | FYI`
- `tags`: `string[]`
- `score`: `number`
- `reason`: `string`
- `uiState`: `{ flagged: boolean, pinned: boolean, done: boolean }`
- `timestamp`: `string | null` (source timestamp, ISO8601 when available)
- `ingestedAt`: `string` (client ingestion/fetch timestamp, ISO8601)
- `recommendedAction`: `Review Later | Review / Respond | Approve / Decide | Review`

Notes:
- `Flagged` should be treated as a state, not a primary category.
- One item has exactly one primary category and zero or more tags.

State source:
- `flagged` derives from normalized payload `item.flagged` (boolean). If absent, fall back to `false`.
- `pinned` and `done` are user-managed local UI states.

## 5. Rich Email Card Design

Collapsed card content:
- Sender identity (avatar initial + sender)
- Subject (primary visual anchor)
- Recommended action (prominent near subject)
- Preview snippet (1-2 lines)
- Category/tag pills
- Score/confidence metadata (secondary)
- Timestamp
- Quick actions: Open, Pin, Done

Expanded card content:
- Longer body preview
- Classification reason
- Matched rules/signals (why this was categorized)
- Optional raw metadata block for inspection/debugging

Expanded metadata rule:
- Raw metadata stays collapsed by default and is visually secondary to triage content.

Interaction rules:
- Click card to expand/collapse.
- Open action launches `openUrl` in new tab.
- Pin/Done are local UI state controls (initial implementation).
- Clicking `Open`, `Pin`, or `Done` must not trigger expand/collapse.

Done interaction rule:
- When a user marks an item as done, it should disappear from the current list unless the active state filter is `Done`.
- In the `Done` filter, done items remain visible with their completed visual state.

Action and confidence normalization:
- Recommended action uses canonical values from scorer output (`Review Later`, `Review / Respond`, `Approve / Decide`, fallback `Review`).
- Confidence display is always derived from numeric `score` (for example `41%`) and is always secondary to subject and action.

Time display rule:
- If `timestamp` exists, display relative time derived from `timestamp`.
- If `timestamp` is `null`, display relative time derived from `ingestedAt`.
- Tooltip always shows the resolved ISO timestamp source used for display.

## 6. Logs Page Design

Filter-first controls:
- Search text
- Type filter (`all`, `automation`, `user`)
- Time filter (`15m`, `1h`, `24h`, `all`)
- Clear filters
- Live updates toggle (off by default)

Table columns:
- Timestamp
- Type
- Action
- Summary
- Details (expandable row)

Behavior:
- Client-side filtering on existing event stream.
- Newest first.
- Sticky filters.
- Visible result count above table.

Empty state behavior:
- No log rows available: show `No logs found`.
- Filters applied with no matches: show `No results match current filters` plus a clear-filters action.

Default filter state:
- Type: `all`
- Time: `24h`
- Live updates: `off`

## 7. Technical Implementation Plan (Design-Level)

Constraints:
- No backend breaking changes.
- Reuse existing endpoints and websocket payloads.

Expected frontend structure:
- Hash router in `public/app.js` for `#email/#logs/#settings`.
- View containers in `public/index.html`.
- Shared design tokens and layout primitives in `public/style.css`.

Routing behavior:
- No hash on initial load redirects to `#email`.
- Unknown hash redirects to `#email`.
- Browser back/forward (`hashchange`) updates active view without full reload.

Classification helper layer (required):
- `deriveEmailTags(item)`
- `derivePrimaryCategory(item)`
- `deriveRecommendedAction(item)`
- `deriveScoreMeta(item)`
- `deriveUiState(item, localState)`

Shared constants (single source of truth):
- `RECOMMENDED_ACTIONS = ['Review Later', 'Review / Respond', 'Approve / Decide', 'Review']`

Action normalization rule:
- Mapping layer must normalize `item.action` into `RECOMMENDED_ACTIONS` before any rendering.
- Unknown or missing values fall back to `Review`.

Helper-layer constraints:
- Helpers are pure functions.
- Helpers must not access DOM APIs.
- Helpers must not read/write local storage directly.
- Helpers must not depend on mutable view state.

Do not embed classification logic directly in rendering code.

Compatibility mapping (existing payload -> view model):
- `id` <- `item.threadId || item.openUrl || sha1(lower(sender)+"|"+lower(subject))`
- `sender` <- `item.sender`
- `subject` <- `item.subject`
- `preview` <- `item.body`
- `openUrl` <- `item.openUrl`
- `score` <- `item.score`
- `recommendedAction` <- normalized `deriveRecommendedAction(item)`
- `reason` <- `item.reason`
- `timestamp` <- `item.timestamp` when present, else `null`
- `ingestedAt` <- local fetch time
- `flagged` <- `Boolean(item.flagged)`

Identity stability rule:
- `id` generation must not depend on local runtime timestamps.
- Fallback hash should avoid mutable preview/body content to preserve stability across refresh.

## 8. Non-Goals

- No backend DB persistence for pinned/done in this iteration.
- No backend API schema migrations.
- No auth/permission model changes.

## 8.1 State Persistence Scope

- `pinned` and `done` persist in browser `localStorage` keyed by canonical `id` (from compatibility mapping).
- No server persistence in this iteration.
- `flagged` is not written to local state; it comes from message data.

Storage key contract:
- key: `portal.email.state.v1`
- value shape: `{ [id: string]: { pinned: boolean, done: boolean, updatedAt: string } }`

Versioning rule:
- If state schema changes, bump storage key version (for example `portal.email.state.v2`).
- No automatic migration is required in the first implementation; old state may be discarded.

## 9. Testing Strategy (Implementation Stage)

- Unit tests for classification helpers (category/tag/state derivation).
- UI behavior checks:
  - Route switching
  - Email filter chips
  - Logs filters and row expansion
  - Unknown hash fallback to `#email`
  - Back/forward hash navigation
  - Local state persistence for pin/done
- Regression validation for:
  - `/api/events`
  - `/api/emails/triage`
  - websocket event updates

UI state tests:
- Email view loading, empty, and error state rendering.
- Logs view loading, empty, and error state rendering.

Empty state rules:
- Email with no items loaded: show `No emails found`.
- Email with active filters and no matches: show `No results match current filters` plus a clear-filters action.
- Logs with no rows loaded: show `No logs found`.
- Logs with active filters and no matches: show `No results match current filters` plus a clear-filters action.

## 9.1 Filter and Live Semantics

Email filter precedence (applied in this order):
1. Text search
2. Primary category selection (`Needs Reply`, `Waiting on Others`, `FYI`)
3. State filter selection (`Flagged`, `Pinned`, `Done`; `All` means no state filter)
4. Optional tag chip selection (`Approval`, `Vendor`, `Urgent`)

Count behavior:
- Left-rail counts are computed after text search is applied, before active category/state/tag filter narrowing.
- UI hint should be shown near counts: "Counts reflect current search".

Logs live toggle behavior:
- When live is off, incoming websocket log events are not appended to current table model.
- When live is turned on, client refreshes from `/api/events` and resumes websocket append behavior.
- No buffering while live is off (explicitly dropped for clarity).
- UI must display a visible paused indicator while live is off (for example "Live updates paused").
- UI should display a lightweight refresh indicator when live mode is turned back on and `/api/events` is being reloaded.

Logs time filter source:
- Time window filters operate against the currently loaded `/api/events` dataset.
- This is in-memory filtering, not server-side range querying.

Performance guardrail:
- If loaded email items exceed 500, emit a console warning noting that list virtualization may be needed in a later iteration.

## 10. Risks and Mitigations

Risk: Category ambiguity from heuristic matching.
Mitigation: Keep helpers isolated and easy to tune; expose reasons in expanded card.

Risk: UI complexity in single-page shell.
Mitigation: Strict view separation and route-scoped controls.

Risk: Live logs causing noise/perf issues.
Mitigation: Default live toggle off and client-side filter pipeline.

Risk: Large client-side email list causing sluggish rendering/filtering.
Mitigation: Add a soft warning threshold at 500 items and treat virtualization as a follow-up optimization if reached.

## 10.1 Future-Friendly Extension

- The current model should preserve a clean path to a future `Queue mode` view, defined as `Needs Reply` and not `Done`.
- Queue mode is explicitly out of scope for this implementation, but current filtering/state rules should not block adding it later.

## 10.2 Recommended Build Order

1. Shell and routing
  - Hash router
  - Top nav
  - View containers
2. Data mapping and helper layer
  - Compatibility mapping
  - Pure helper functions
  - Unit tests
3. Email view
  - Left rail
  - Card rendering
  - Expand/collapse
  - Pin/done state
4. Email filters
  - Search
  - Category/state/tag filtering
  - Counts
5. Logs view
  - Table
  - Filters
  - Row expansion
  - Live toggle
6. Settings move

## 11. Acceptance Criteria

- App opens to `#email` with Gmail-style rich cards.
- Logs are on `#logs` with filter-first table view.
- Settings are on `#settings` as independent page.
- Email items show primary category, tags, and state handling (`Flagged`, `Pinned`, `Done`).
- Category derivation logic lives in dedicated helper functions.
- Existing API endpoints and websocket flows continue to work.
- Route fallback sends unknown hashes to `#email`.
- Pin/Done state persists across browser refresh via local storage.
- Time display follows `timestamp` first, `ingestedAt` fallback, with ISO tooltip.
- Empty states distinguish between no data and no filter matches.
- Clicking card actions does not accidentally toggle expansion.
