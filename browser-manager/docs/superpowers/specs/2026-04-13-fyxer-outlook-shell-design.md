# Fyxer / Outlook Shell Redesign — Design Spec

Date: 2026-04-13
Status: Draft for review
Owner: GitHub Copilot + Damian

## 1. Goal

Redesign the browser-manager front end to feel much closer to Fyxer and Outlook while preserving the existing backend routes, triage pipeline, websocket behavior, and core email actions.

Primary outcomes:
- Replace the current top-nav portal with a persistent left sidebar shell.
- Make Email the primary landing workspace.
- Rebuild Email into a true three-region workspace:
  - filter rail
  - inbox list
  - reader pane
- Move Categorization under Settings rather than exposing it as a top-level peer product.
- Keep Logs in the same shell/design system without forcing it into a mail-style workspace.
- Apply a flat, quiet design language rather than drifting back into large card-heavy SaaS UI.

## 2. Chosen Approach

Selected architecture: shell-first redesign with a limited amount of state-model cleanup.

Rationale:
- The current top nav conflicts with the target interaction model.
- A sidebar shell immediately changes the product feel.
- Email needs a real workspace layout, not richer cards.
- Only minimal state cleanup is required for selection state and reader state.
- Existing APIs and actions can remain intact, limiting regression risk.

Not chosen:
- A full frontend state rewrite in the same pass.
- A fake Dashboard or placeholder-heavy shell for unfinished surfaces.

## 3. Information Architecture

### 3.1 Top-Level Navigation

Sidebar for v1:
- Email
- Settings
- Logs

Rules:
- No fake Dashboard in v1.
- No unfinished placeholder items in the sidebar by default.
- Future items may be added later only when they have real behavior or are clearly marked as disabled.

### 3.2 Route Model

Top-level routes:
- `#email` (default)
- `#settings`
- `#logs`

Route rules:
- Email is the default landing route.
- Unknown or missing route falls back to Email.
- Route changes must not trigger full-page reloads.

### 3.3 Settings Information Architecture

Settings contains internal sub-navigation:
- General
- Categorization

Categorization contains internal tabs:
- General
- Advanced

Rationale:
- Categorization is a settings domain, not a peer product surface.
- This keeps the shell lean and reduces IA clutter.

## 4. Visual System Principles

The redesign follows one locked visual principle:

**Flat and quiet, not soft and floaty.**

Meaning:
- minimal shadows
- restrained tinting
- clean separators over stacked cards
- tighter row density in Email
- emphasis through typography, spacing, and alignment
- quiet shell chrome with pale surfaces and restrained borders

Design rules:
- Avoid oversized cards as the dominant layout primitive.
- Avoid heavy pill/badge overuse in scan surfaces.
- Avoid layout motion caused by asynchronous updates.
- Keep primary action accents restrained and deliberate.

## 5. Shell Contract

### 5.1 Global Layout

The app shell consists of:
- persistent left sidebar
- light main content canvas
- no heavy top route bar

Shell behavior:
- sidebar remains visible across Email, Settings, and Logs on desktop
- desktop breakpoint: `>= 1100px`
- tablet breakpoint: `768px–1099px`
- mobile breakpoint: `< 768px`
- on tablet and mobile, the sidebar collapses behind a menu toggle rather than remaining permanently visible
- on mobile, Email has two explicit states:
  - list state shows the filter rail and inbox list within the main content area; the reader pane is not visible
  - reader state shows the selected email as a full-screen detail view; the filter rail and inbox list are hidden until the user goes back
- on mobile, the reader view includes a back action that returns to the prior list state with filters, list scroll, and selection preserved where possible
- on mobile, the back action is a visible leading control in the reader header; system back gestures may also work, but the UI must not rely on them as the only exit path
- sidebar transitions must not shift content width while route data is loading
- the main content area owns the route-specific layout

### 5.2 Shell Styling

Rules:
- pale background
- light content canvas
- restrained borders
- subtle section tinting only where it adds structure
- no visually dominant gradients
- no heavy shadows as the main separation mechanism

## 6. Email Workspace Contract

### 6.1 Layout

Three fixed regions inside the Email route:

#### Left Filter Rail

Purpose:
- mailbox context
- triage filters
- lightweight counts

Content:
- search
- category filters
- state filters
- optional tags
- refresh action

Search UX:
- real-time client-side filtering as the user types
- placeholder text: `Search mail`
- clear control appears only when the search query is non-empty

Layout constraints:
- fixed width: 240px–280px
- independent vertical scroll
- no horizontal scroll in normal layout
- on mobile list state, the filter rail becomes a full-width section above the inbox list rather than a side-by-side column
- on mobile list state, the filter rail is part of the page's single vertical flow and does not create a second side-by-side region

#### Middle Inbox List

Purpose:
- fast scan
- selection
- triage visibility

Content per row:
- sender
- subject
- preview line
- category badge
- manual suppression indicator when `skipAutomation === true`
- timestamp
- optional unread styling

Layout constraints:
- flexible width with minimum width of 360px
- independent vertical scroll
- no horizontal scroll in normal layout
- on mobile list state, the inbox list becomes full width below the filter rail and the 360px minimum width no longer applies

#### Right Reader Pane

Purpose:
- read selected message in detail
- show triage metadata without cluttering the list

Content:
- sender block
- subject
- timestamp
- preview/body area
- category
- category source
- confidence
- skipAutomation state
- urgency
- recommended action
- existing message actions

Layout constraints:
- fills remaining horizontal space
- independent vertical scroll
- no modal or pop-out for normal reading

#### Layout Stability

Rules:
- layout must remain stable during data updates
- region widths must not shift as items load or update
- scrolling one region must not scroll the others

### 6.2 Selection State

Selection is first-class route-local UI state.

Rules:
- exactly one selected email at a time when the list is non-empty
- first visible item auto-selects on initial load
- if the selected item disappears due to filtering, selection moves to the first visible item
- if no visible items remain, the reader pane shows an empty state
- selection is preserved across data refreshes if the selected item still exists in the list
- if the selected item updates via websocket, the reader pane updates in place without resetting reader scroll position

Keyboard baseline:
- Up / Down arrows move selection in the inbox list
- Enter focuses or opens the selected item in the reader pane
- Esc clearing selection is out of scope for v1 and must not be partially implemented

Touch baseline:
- tapping an inbox row selects it and opens the mobile reader state on mobile
- returning from the mobile reader uses the explicit back control in the reader header
- swipe-driven navigation between list and reader is out of scope for v1

Non-goals:
- no multi-select
- no bulk actions in v1

### 6.3 Inbox List Row Design

Rows must be:
- flat
- compact
- separated by hairline borders
- lightly highlighted on hover
- clearly highlighted when selected

Avoid:
- stacked cards
- oversized pills
- deep shadows
- too many competing secondary badges

Recommended row hierarchy:
- sender
- subject
- category badge / manual indicator
- preview
- timestamp

Visual rules:
- selected state overrides unread styling
- unread is always secondary to selected state
- target row height: 72–88px
- spacing must be consistent across all rows
- preview line is limited to a single truncated line in the inbox list

Category badge rules:
- fixed or bounded width to prevent layout shift
- max width: `112px`
- text truncates with ellipsis when it exceeds available width
- full label is exposed via tooltip/title when truncation occurs
- colour mapping must be consistent and static
- category badge colour mapping is defined in the frontend design system and must not be derived from Outlook category tags or backend values at runtime
- badge rendering must not change row height between items

Actions:
- primary message actions do not live in list rows
- list rows are for scanning and selection only

Virtualization stance:
- virtualization must be introduced once the inbox list regularly exceeds ~`200` rendered rows or shows measurable performance degradation
- virtualization is not required for v1 but the layout must not block it later

### 6.4 Reader Pane Detail Hierarchy

Top section:
- subject
- sender
- recipients if needed
- timestamp

Secondary metadata strip:
- category
- source
- confidence
- urgency
- recommended action
- manual / automation-suppressed indicator if relevant

Rules:
- metadata strip must wrap cleanly
- must not overflow horizontally
- metadata strip uses wrapping inline groups with `gap`-based spacing rather than fixed-position columns
- lower-priority fields (`urgency`, `source`, `confidence`) may truncate before `category` and `recommended action`
- metadata strip must remain within a maximum of two visual lines on desktop before truncation rules apply
- implementation uses `display: flex`, `flex-wrap: wrap`, and gap-based spacing on desktop and tablet breakpoints
- below the tablet breakpoint, metadata remains wrapped inside the reader header area rather than becoming a separate scrollable strip

Main body:
- preview/body text
- existing actions in the header area

Loading behavior on selection change:
- subject/sender header updates immediately
- body area may show a loading skeleton if needed
- no full-pane flicker during selection changes

Empty content behavior:
- if the selected item has no preview/body, show a neutral `No content available` state

Action placement:
- primary message actions live in the reader pane header, not in the list

### 6.5 Empty and Loading States

Inbox loading:
- eight skeleton rows in list
- reader pane placeholder

No results after filtering:
- list shows `No messages match current filters`
- reader pane shows a neutral empty state

Nothing loaded yet:
- list shows loading or fetch error
- reader pane mirrors that state

Error-state rule:
- data fetch errors must render a distinct error state, not reuse empty or `No messages match current filters` messaging

No selected item:
- reader pane shows `Select an email to view details`

First route entry:
- fetch data
- render list
- auto-select first visible item
- render reader pane
- no intermediate empty flash

### 6.6 Filter Rail Behavior

Rules:
- category filter is single-select
- state filter is single-select in v1
- search is client-side only across the currently loaded dataset in v1
- search is applied before category/state filters, and all filters operate on the same in-memory dataset
- filter changes do not reset reader scroll unless selection changes
- refresh reloads the inbox list while preserving current filters and selection where possible

### 6.7 WebSocket and Refresh Behavior

Refresh:
- reloads list data
- preserves filters
- preserves selection if selected item still exists

WebSocket updates:
- new items appear at the top of the list
- if no item is selected, first visible item auto-selects
- if an item is already selected, incoming items do not override selection
- if the selected item updates, the reader pane updates in place
- inbox list scroll position is preserved during live updates unless the user is already effectively at the top (`scrollTop <= 24px`)
- manual refresh preserves inbox scroll position where possible; if impossible, it must preserve selection before scroll restoration attempts

### 6.8 Route Behavior

Email route:
- default landing route
- loads triage feed
- preserves current filters and selection for the lifetime of the loaded app session, including route changes to Settings and Logs and back

Settings route:
- independent page within same shell
- no mail workspace layout

Logs route:
- independent page within same shell
- no reader-pane pattern

### 6.9 Testing Hooks

To support UI testing:
- each region must expose stable data attributes
- recommended examples:
  - `data-region="filter-rail"`
  - `data-region="inbox-list"`
  - `data-region="reader-pane"`

These hooks are for testing and must not drive business logic.

## 7. Settings + Categorization Contract

### 7.1 Settings Route

Settings is a top-level shell route with bounded content width and a single vertical scroll.

Rules:
- one page-level vertical scroll only
- no nested scroll regions inside settings sections
- content width is readability-first and stable
- no layout shifts during load/save/tab changes

Inside Settings, v1 has:
- General
- Categorization

Inside Categorization, there are two sub-tabs:
- General
- Advanced

### 7.2 Tab Behavior

Rules:
- tab switches do not re-fetch data
- tab switches use cached local state
- each tab preserves its own last scroll position within the active Settings route session
- tab switches do not discard unsaved changes
- tab state is preserved while the app remains loaded; switching to Email or Logs and back to Settings must restore the last active Settings tab
- tab changes must not cause layout shift

### 7.3 Save Model

Chosen model for v1: **Option A — explicit save**.

Rules:
- all changes require explicit `Update preferences`
- toggles update local state only
- rules, labels, and structured inputs remain local until save
- `Update preferences` is the single commit action for settings changes
- button is disabled while saving
- success feedback is subtle and local to the page header/action area
- error feedback appears near the same action area
- save failure does not auto-retry
- save failure preserves unsaved local edits so the user can correct and retry manually
- no blocking overlays

### 7.4 General Settings Page

Purpose:
- provider/runtime/mailbox/AI configuration

Layout:
- grouped sections stacked vertically
- flat, quiet, separator-driven structure
- labels and helper text establish hierarchy, not box-heavy cards

Rules:
- operational settings only
- no categorization-rule editing here
- sensitive fields remain visually restrained

### 7.5 Categorization General Tab

This tab mirrors the Fyxer preference feel closely.

Fixed section order:
1. `Move these out of my Inbox`
2. `Keep these in my Inbox`
3. `Existing categories`
4. `Topic-based labels`

No dynamic reordering.

Section semantics:
- `Move these out of my Inbox` contains category-like preference rows that describe mail patterns the product should actively file out of the inbox when enabled
- `Keep these in my Inbox` contains category-like preference rows that describe mail patterns the product should leave in the inbox when enabled
- `Existing categories` is the direct UI surface for the current backend canonical categories (`todo`, `fyi`, `to_follow_up`, `notification`, `marketing`)
- in `Existing categories`, the primary toggle maps directly to `categories.<key>.enabled`
- `Existing categories` rows may expose secondary controls for `targetFolderName`, `outlookCategoryTag`, and per-category topic-label enablement because those are part of the current persisted backend model
- `Existing categories` is not mutually exclusive with sections 1 and 2; sections 1 and 2 describe inbox-behavior preferences, while `Existing categories` configures the underlying category definitions already supported by the backend
- `Move these out of my Inbox` and `Keep these in my Inbox` influence inbox behavior preferences, while `Existing categories` defines the canonical category configuration used by the backend
- if both apply, backend categorization determines the category, and inbox behavior settings determine whether the message remains in or is moved out of the inbox

Each category/settings row contains:
- left:
  - primary label
  - optional helper text on second line
- right:
  - toggle as primary control
- optional secondary control:
  - aligned predictably beside or beneath the primary control when needed
  - only visible when the corresponding category is enabled, unless explicitly required for configuration preview

Rules:
- row alignment must remain consistent across sections
- helper text may wrap, but must not break control alignment
- rows stay flat and visually quiet
- toggles align on a clean vertical axis
- row click does not toggle by default
- only the toggle control changes toggle state unless accessibility behavior is intentionally expanded later

### 7.6 Categorization Advanced Tab

Purpose:
- detailed configuration that would clutter the General tab

Advanced contains only configuration that:
- is not required for normal operation
- would clutter the General tab
- is stable enough to expose in v1

Advanced contains in v1:
- marketing classification strategy
- alternative email identities
- custom rules

General contains in v1:
- move/keep inbox category toggles
- existing categories behavior
- topic-based labels

Topic labels belong exclusively to `Categorization > General` in v1.

Custom rules belong exclusively to `Categorization > Advanced` in v1.

Advanced does not become:
- a debug dump
- an experimental controls bucket
- a place for temporary/internal-only flags

### 7.7 Custom Rules Contract

Each rule row includes:
- enable/disable control
- input field
- destination category select
- remove action

Column alignment must remain stable:
- enable column
- input column
- category column
- action column

Rules:
- controls do not shift position as rows are added/removed
- adding/removing a row affects only the local row area
- unrelated rows must not jump
- no oversized card wrapper per rule
- rows stay inline and flat wherever viewport allows
- new rules append to the end
- reorder only via explicit up/down controls
- no drag-and-drop in v1

### 7.8 Topic Labels Contract

Rules:
- ordered list maps directly to backend categorizer evaluation priority before default fallback heuristics
- ordered list maps directly to evaluation priority
- new labels append to the end
- no drag-and-drop in v1
- the UI must communicate clearly that order matters

### 7.9 Inline Validation

Rules:
- errors appear inline in the affected row
- invalid rows remain editable
- other rows stay editable and unaffected
- validation must not collapse or reset the list
- validation must not block interaction elsewhere in the section

### 7.10 Toggle Interaction

Rules:
- only the toggle control triggers state change
- row click does not toggle
- this avoids accidental changes

### 7.11 Loading, Saving, and Empty States

Loading:
- page-level loading state on first load
- no blocking overlay
- stable layout placeholders where needed

Saving:
- disable `Update preferences`
- subtle saving/saved/error feedback near action area

Empty states:
- include short explanation
- include inline add action
- must not cause panel collapse or unstable height

Applies to:
- custom rules
- topic labels
- alternative emails or similar sparse collections

### 7.12 Concurrency / Live Update Behavior

Rules:
- last write wins
- settings save replaces the full settings object
- no merge semantics in v1

For live updates:
- `settings_updated` may refresh clean UI state
- it must not overwrite in-progress unsaved local edits
- a local dirty flag determines whether incoming websocket settings are applied or ignored in the current session
- if the page is dirty, incoming settings are ignored until the user saves or discards local edits
- when the page has unsaved changes, a persistent visual indicator (for example, `Unsaved changes`) must be shown
- navigation away from Settings should not silently discard unsaved changes without user confirmation (if confirmation is implemented)

### 7.13 Testing Expectations

Behavioral expectations:
- toggles do not cause layout shift
- adding/removing rules does not reflow unrelated rows
- tab switch preserves unsaved form state
- validation errors stay scoped to the affected row

Recommended stable hooks:
- `data-region="settings-page"`
- `data-region="settings-tabs"`
- `data-region="categorization-general"`
- `data-region="categorization-advanced"`
- `data-region="custom-rules"`
- `data-setting-row="<key>"`

## 8. Logs Contract

Logs shares the shell and design system, but not the mail workspace.

Structure:
- filter bar
- event table
- expandable detail area

Rules:
- do not force Logs into the inbox/reader interaction model
- reuse shell spacing, typography, tinting, and sidebar structure
- keep Logs task-shaped for event inspection rather than message reading

## 9. Implementation Constraints

Locked constraints:
- preserve current backend APIs and websocket message shapes where feasible
- do not rewrite the backend triage pipeline as part of the redesign
- limit state cleanup to what is required for:
  - inbox row selection
  - reader-pane state
  - settings local edit state
- no modal-first reading model for Email
- no bulk actions or multi-select in v1

## 10. Non-Goals

Out of scope for v1:
- placeholder navigation items for unfinished products
- multi-select inbox behavior
- bulk actions
- full front-end state architecture rewrite
- drag-and-drop ordering for topic labels or rules
- experimental/debug settings controls in Advanced

## 11. Review Checklist

Implementation must preserve the following:
- sidebar remains lean and route-accurate
- Email is row-first and workspace-driven
- reader pane is persistent on desktop and full-screen on smaller screens
- Settings uses explicit save
- Categorization stays inside Settings
- Logs shares the shell without mimicking Email
- flat-and-quiet visual principle remains intact
