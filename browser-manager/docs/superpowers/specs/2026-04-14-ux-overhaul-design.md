# Browser Manager — UX Overhaul Design Spec

**Date:** 2026-04-14
**Status:** Draft
**Goal:** Transform the Browser Manager dashboard from a utilitarian tool into a premium, agency-quality email triage application with the "Warm Minimal" design language.

## Overview

A comprehensive visual and functional overhaul of all three views (Email, Settings, Logs) plus the application shell. The design targets the quality bar of leading creative firms — warm neutrals, generous whitespace, soft rounded surfaces, and purposeful color-coded categorization.

Key changes:
- **Shell**: Full sidebar → 56px icon rail
- **Email list**: Large cards with action buttons → medium-density scannable rows with smart priority grouping
- **Scoring**: Raw percentage → smart priority tiers (Act Now / Review / Low Priority) with heat-gradient borders
- **Drafts**: Modal dialog → inline editing in the reader pane
- **Categories**: Sidebar filter rail → horizontal pill bar with counts
- **Tags**: Hidden in filter rail → visible pills on rows + filterable via popover
- **Search**: Basic input → real-time filtering with clear state indicators
- **Settings**: Flat form → tabbed card layout with Graph connection status
- **Categorization**: Raw lists → visual tag builder and IF/THEN rule editor with live match counts
- **Logs**: Plain table → summary stats + contextual entries with filter pills

---

## 1. Design System

### 1.1 Color Tokens (CSS Custom Properties)

**Surfaces:**
| Token | Value | Usage |
|-------|-------|-------|
| `--bg-canvas` | `#fafaf8` | Page background |
| `--bg-surface` | `#ffffff` | Cards, panels |
| `--bg-surface-warm` | `#faf8f5` | Selected states, AI draft cards |
| `--bg-rail` | `#f5f3f0` | Icon rail, secondary surfaces |
| `--bg-muted` | `#ebe6df` | Active nav, pressed states |

**Borders:**
| Token | Value | Usage |
|-------|-------|-------|
| `--border-default` | `#e8e5e0` | Card borders |
| `--border-subtle` | `#ece8e3` | Dividers, separators |
| `--border-input` | `#e0dbd4` | Form control borders |

**Text:**
| Token | Value | Usage |
|-------|-------|-------|
| `--text-primary` | `#1a1a1a` | Headings, bold labels |
| `--text-secondary` | `#444444` | Body text |
| `--text-tertiary` | `#777777` | Secondary info |
| `--text-muted` | `#a09890` | Timestamps, hints, placeholders |

**Category Accents:**
| Category | Foreground | Background | Border |
|----------|-----------|------------|--------|
| Needs Reply | `#9b3c3c` | `#fef0f0` | `#f5d0d0` |
| Waiting | `#8b6a2f` | `#fef8ec` | `#f0e0c0` |
| FYI | `#4a6380` | `#eef3f8` | `#d4e0ec` |
| Notification | `#777060` | `#f0f0ec` | `#e0e0d8` |
| Marketing | `#7a6088` | `#f5f0f8` | `#e0d8e8` |

**Category left-border accents (stronger versions for card borders):**
| Category | Border Color |
|----------|-------------|
| Needs Reply | `#c0564a` |
| Waiting | `#b8860b` |
| FYI | `#4a6380` |
| Notification | `#777060` |
| Marketing | `#7a6088` |

**Score Heat Gradient:**
| Token | Value | Score Range | Usage |
|-------|-------|-------------|-------|
| `--score-hot` | `#c0564a` | 80–100 | Highest priority heat border + dot |
| `--score-warm` | `#d4a030` | 60–79 | Medium-high priority |
| `--score-mild` | `#d4a574` | 40–59 | Medium priority |
| `--score-cool` | `#e0dbd4` | 20–39 | Low priority |

**Priority Tier Backgrounds:**
| Token | Value | Usage |
|-------|-------|-------|
| `--tier-act-now-bg` | `#fef0f0` | Act Now section header tint |
| `--tier-review-bg` | `#fef8ec` | Review section header tint |
| `--tier-low-bg` | `#f5f3f0` | Low Priority section header tint |

**Special:**
| Token | Value | Usage |
|-------|-------|-------|
| `--accent-ai` | `#d4a574` | AI draft accents, brand mark, primary CTA in draft context |
| `--accent-brand` | `#5a4a38` | Active pill fills, primary dark actions |
| `--status-success` | `#5a9a6a` | Connected, success states |
| `--status-warning` | `#d4a030` | Expiring, warning states |
| `--status-error` | `#c0564a` | Disconnected, error states |

### 1.2 Border Radii

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | `8px` | Small controls, badges |
| `--radius-md` | `12px` | Cards, email rows |
| `--radius-lg` | `14px` | Large cards, containers |
| `--radius-pill` | `99px` | Pills, buttons, search inputs |

### 1.3 Typography Scale

- **Page title:** 20px / 700
- **Reader subject:** 18px / 700
- **Section heading:** 16px / 700 (within settings cards)
- **Card title / setting label:** 14–15px / 600
- **Body text:** 14px / 400, line-height 1.6
- **Sender name / strong meta:** 13px / 600
- **Meta text / descriptions:** 12px / 400
- **Section label (uppercase):** 11px / 600, letter-spacing 0.06em, text-transform uppercase
- **Badge text:** 10–11px / 600
- Font stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif`
- All sizes should use `rem` for accessibility scaling.

### 1.4 Reusable Components

**`.pill`** — Rounded pill element used for category filters, log type filters, state filters, action buttons.
- Default: `background: white; border: 1px solid var(--border-input); color: var(--text-tertiary); border-radius: var(--radius-pill); padding: 5px 14px; font-size: 12px; font-weight: 600;`
- Active: `background: var(--accent-brand); color: white; border-color: transparent;`
- Category variant: uses category background/foreground/border colors.

**`.btn`** — Pill-shaped button.
- Primary (AI): `background: var(--accent-ai); color: white;`
- Primary (Dark): `background: var(--accent-brand); color: white;`
- Secondary: `background: white; border: 1px solid var(--border-input); color: var(--accent-brand);`
- Ghost: `background: white; border: 1px solid var(--border-input); color: var(--text-muted);`
- Danger: `background: white; border: 1px solid #f5d0d0; color: var(--status-error);`
- All buttons: `border-radius: var(--radius-pill); font-size: 12–13px; font-weight: 600; padding: 6–9px 14–22px;`

**`.avatar`** — Circular sender initials.
- Sizes: 40px (reader), 36px (list), 28px (small).
- Background color derived from sender name hash (warm palette: peach, sage, lavender, sky, sand).
- Text color: darker shade of background.

**`.card`** — White surface container.
- `background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: var(--radius-lg); padding: 16–20px;`
- Category variant: adds `border-left: 3px solid [category-border-color]`.
- AI variant: `background: var(--bg-surface-warm); border-left: 3px solid var(--accent-ai);`

**`.badge`** — Small inline status label.
- Category badge: `font-size: 10px; font-weight: 600; padding: 1–2px 7–8px; border-radius: var(--radius-pill);` with category colors.
- Status badge: same size, uses success/warning/error colors.

**`.toggle`** — Warm-styled toggle switch (replaces checkboxes where boolean).
- Track: 44px × 24px, border-radius: 12px.
- On: `background: var(--accent-ai);` (or category color). Knob slides right.
- Off: `background: var(--border-input);` Knob slides left.
- Knob: 20px circle, white, subtle shadow.

**`.input`, `.select`, `.textarea`** — Form controls.
- `border: 1px solid var(--border-input); border-radius: 10px; padding: 9px 14px; font-size: 13px; background: white;`
- Focus: `border-color: var(--accent-ai); box-shadow: 0 0 0 3px rgba(212, 165, 116, 0.15);`

**`.toast`** — Notification bar.
- Rounded container with colored left-accent or icon + text + optional action button.
- Variants: warning (amber), success (green), error (red).
- Auto-dismiss after 5 seconds or manual dismiss.

**`.status-dot`** — Connection status indicator.
- 10px circle: green (connected), amber-pulsing (expiring), red (disconnected).

### 1.5 CSS File Structure

Split the current monolithic `style.css` into:
- `tokens.css` — custom properties only
- `base.css` — reset, typography, body defaults
- `components.css` — pills, cards, badges, buttons, forms, toggles, toasts
- `shell.css` — icon rail, view switching, mobile drawer
- `email.css` — email list, reader pane, draft editor
- `settings.css` — settings tabs, connection card, provider cards, categorization builder
- `logs.css` — logs summary bar, filter pills, log entries, expanded details
- `responsive.css` — breakpoints and mobile overrides

Import all via a single `style.css`:
```css
@import 'tokens.css';
@import 'base.css';
@import 'components.css';
@import 'shell.css';
@import 'email.css';
@import 'settings.css';
@import 'logs.css';
@import 'responsive.css';
```

HTML keeps a single `<link rel="stylesheet" href="style.css">`.

---

## 2. Shell & Navigation

### 2.1 Icon Rail

Replaces the current 240px text sidebar with a 56px-wide icon rail.

**Structure:**
- Fixed-position vertical strip on the left edge.
- Background: `var(--bg-rail)`. Right border: `var(--border-default)`.
- **Top:** Brand mark — 32px rounded square with `var(--accent-ai)` background and white "B" monogram. 12px gap below.
- **Middle:** Navigation icons stacked vertically, 6px gap:
  - Inbox (envelope icon)
  - Settings (gear icon)
  - Logs (list icon)
- **Bottom:** Graph connection status widget (see section 4.1).

**Icon states:**
- Default: 40px × 40px hit area, icon stroke color `#a09890`.
- Hover: icon stroke darkens to `var(--text-tertiary)`.
- Active: `background: var(--bg-muted); border-radius: 10px;` with a 3px-wide left-edge accent bar in `var(--accent-ai)`. Icon stroke: `var(--accent-brand)`.

**View switching:** Clicking a nav icon switches the active view (Email/Settings/Logs) with a CSS opacity/transform crossfade transition (150ms ease).

### 2.2 Mobile Navigation

- **≥1100px:** Icon rail visible.
- **768–1099px:** Icon rail collapses. Floating hamburger button (fixed, top-left, z-index 1101) toggles a slide-out drawer with icon + text labels.
- **<768px:** Same drawer behavior.

---

## 3. Email Workspace

### 3.1 Layout

Three-region layout within the portal main area:
```
[Icon Rail 56px] [Email List ~380px] [Reader Pane flex-1]
```

The email workspace is `display: grid; grid-template-columns: minmax(320px, 380px) minmax(420px, 1fr);` (the icon rail is outside the workspace, part of the shell).

### 3.2 Search Bar

Sits at the very top of the email list panel.

**Layout:** Pill-shaped input (`border-radius: var(--radius-pill)`) with search icon on the left, flex-1. Refresh button (icon-only, 34px square, rounded) to the right.

**Behavior:**
- Filters the email list in real-time as the user types (debounced 300ms).
- Searches across sender name, subject, and preview text (client-side, same as current implementation).
- Works in combination with category, state, and tag filters (AND logic — all filters apply together).
- When a search is active, a clear button (X icon) appears inside the input on the right.

**Empty search results:** "No emails match your search" centered with muted text in the warm empty-state style.

### 3.3 Category & State Filter Bar

Replaces the 260px filter rail sidebar. Sits below the search bar.

**Row 1 — Category pills:**
- Horizontal row: `All (count)`, `Needs Reply (count)`, `Waiting (count)`, `FYI (count)`.
- Uses `.pill` component with category color variants.
- "All" uses `var(--accent-brand)` when active (dark pill).
- Counts are inline, slightly lower opacity.

**Row 2 — State + tag filters:**
- Smaller ghost-style pills: `Flagged`, `Pinned`, `Done`.
- A filter icon button on the right opens a **tag filter popover**.
- Separated from category pills by 4px vertical gap.
- Divider line (`var(--border-subtle)`) below this row.

**Tag filter popover:**
- Triggered by the filter icon button.
- Shows all available tags (derived from current triage items) as toggleable pills.
- Multiple tags can be selected (OR logic within tags — email matches if it has ANY selected tag).
- When tag filters are active, the selected tags appear as small pills inline in the filter bar (between state pills and the filter icon), so the user can see what's active and click to remove.

### 3.4 Smart Priority Grouping & Scoring

The email list is organized into priority tiers derived from the existing scoring system (`email-scorer.js`). The scorer produces a 0–100 score and an urgency level (high/medium/low) from category + source type + confidence.

**Priority tiers:**

| Tier | Criteria | Visual Treatment |
|------|----------|-----------------|
| **Act Now** | urgency `high` AND score ≥ 70 | Section header with warm rose tint (`#fef0f0`), bold label "Act Now" with count. Rose left-border on rows. |
| **Review** | urgency `medium` OR (urgency `high` AND score < 70) | Section header with amber tint (`#fef8ec`), label "Review" with count. Amber left-border on rows. |
| **Low Priority** | urgency `low` | Section header with muted tint (`#f5f3f0`), label "Low Priority" with count. Neutral left-border on rows. |

**Section headers:** Lightweight dividers between groups — not heavy cards. A thin horizontal line with the tier label (11px uppercase, tier color) and count on the left. Collapsible — clicking the header toggles the section open/closed (all open by default).

**Heat-gradient left border:** Each email row gets a 3px left border whose color maps to its score:
- 80–100: warm rose `#c0564a`
- 60–79: amber `#d4a030`
- 40–59: warm gold `#d4a574`
- 20–39: neutral `#e0dbd4`

This provides an instant visual sense of priority within each group.

**Score indicator in the row:** A small filled-dot indicator (8px) next to the timestamp, using the same heat-gradient color scale. Subtle but visible — communicates score without showing a raw number. Full score details (numeric score, urgency, recommended action, scoring reasons) are shown in the reader pane metadata.

**Within each tier:** Emails are sorted by score descending (highest first), preserving the current sort behavior.

**Settings controls:**
- The existing `minScore` threshold control is retained (renamed to "Priority threshold" with description "Hide emails scoring below this value").
- New toggle: **"Group by priority"** (on/off). When off, the list displays as a flat score-sorted list with the heat-gradient borders but no tier section headers. Default: on.

**Interaction with filters:** Category, state, tag, and search filters apply BEFORE grouping. If you filter to "Needs Reply" only, the visible emails are grouped into tiers based on their individual scores. Empty tiers are hidden.

### 3.5 Email List Rows

Medium-density two-line rows replacing the current large cards.

**Structure per row:**
```
[Heat border 3px] [Avatar 36px] [Content area]
                                  Line 1: Sender (semibold) + Category pill (small) + [Tag pills if any] + Score dot + Timestamp (right-aligned, muted)
                                  Line 2: Subject (medium weight) + " — " + Preview snippet (muted, truncated)
```

**Tag pills in rows:** If the email has tags, they appear as small ghost-style pills (10px font, `background: var(--bg-rail); color: var(--text-tertiary); border-radius: var(--radius-pill); padding: 1px 7px;`) after the category pill on line 1. Maximum 2 visible — if more, show "+N" overflow indicator.

**Styling:**
- `background: var(--bg-surface); border-radius: var(--radius-md); padding: 12px 14px; margin-bottom: 4px;`
- Left border: 3px solid, color from heat-gradient scale based on score.
- No other visible border by default (border-top/right/bottom: 1px solid transparent).
- **Hover:** Subtle warm background tint, gentle lift shadow.
- **Selected:** `background: var(--bg-surface-warm); border-top/bottom: 1px solid var(--border-subtle);` (left border keeps heat-gradient color).
- **Action buttons are NOT shown in the list.** All actions live in the reader pane.

**Avatar colors:** Generated from sender name hash. Palette of 6 warm hues: peach `#e8d5c4`, sky `#c4d5e8`, lavender `#d4c4e8`, sage `#c4e0d8`, sand `#e8dcc4`, rose `#e8c4c4`. Text color is a darker shade of the same hue.

### 3.6 Reader Pane

Right panel showing the selected email and AI draft.

**Header section (sticky top):**
- Avatar (40px) + Subject (18px/700) + Sender name, email, timestamp (12px muted).
- Right side: Category badge + tag pills + score badge (shows numeric score, e.g., "Score: 85" with heat-gradient color).
- Below header: **Score detail strip** (collapsible, collapsed by default) — clicking the score badge toggles it. Shows: urgency level, recommended action, and scoring reasons as a small muted list. This gives full transparency into why the email was ranked where it is.
- Below: Action button bar — Reply, Pin, Archive, Mark Done (`.btn` secondary). Delete isolated on right (`.btn` danger).

**Body section (scrollable):**
- Clean reading area. `font-size: 14px; line-height: 1.65; color: var(--text-secondary);`
- Pre-wrap for plain text, sanitized HTML rendering for rich emails.

**AI Draft section (below email body):**
- `.card` AI variant: `background: var(--bg-surface-warm); border-left: 3px solid var(--accent-ai); border-radius: var(--radius-lg); padding: 16px 18px;`
- Header: AI icon (20px rounded square, `var(--accent-ai)` fill) + "AI DRAFT" label (12px/700, uppercase, `var(--accent-ai)` color) + provider name (11px muted).
- Draft body text: `font-size: 13px; line-height: 1.55; color: var(--text-secondary);`
- Actions: **Send Draft** (`.btn` primary-ai), **Edit** (`.btn` secondary), **Regenerate** (`.btn` ghost).

**Draft editing flow (replaces the modal):**
- Clicking "Edit" transforms the draft card into an editable state:
  - Draft text becomes a `<textarea>` with the same styling.
  - Subject becomes an `<input>`.
  - Save/Cancel buttons replace the Send/Edit/Regenerate buttons.
- All editing happens inline within the reader pane — no modal overlay.
- Clicking "Send Draft" shows a brief inline confirmation: the Send button transforms to "Confirm Send?" for 3 seconds, then reverts. This prevents accidental sends.

**Empty state:** When no email is selected, centered placeholder with muted text: "Select an email to read." Warm, minimal — no heavy illustrations.

### 3.7 Mobile Email Experience

- **<768px:** Single-panel mode.
  - Email list takes full width. Category pills wrap as needed.
  - Tapping an email slides the reader pane in from the right (full width).
  - Back button (pill-shaped, top-left) returns to list.
  - Filter rail and reader pane never visible simultaneously.

---

## 4. Settings

### 4.1 Graph Connection Status Widget

Lives at the **bottom of the icon rail** — always visible regardless of active view.

**Visual:** 36px square button with white background, subtle border, rounded corners (8px). Contains a Graph/check icon. A 10px status dot (green/amber/red) sits at the bottom-right corner with a 2px rail-colored border ring.

**Interaction:** Clicking opens a **slide-out status panel** (overlays from right or as a popover) showing:
- Connection state label ("Connected" / "Expiring Soon" / "Disconnected")
- Token expiry countdown
- Last sync timestamp
- Account email
- One-click "Reconnect" button

**Proactive warning:** When token expiry < 15 minutes:
- Status dot pulses amber.
- A toast notification appears at the top of the email list: "Graph connection expiring — click to reconnect" with a "Reconnect" action button.

### 4.2 Settings Layout

**Page title:** "Settings" (20px/700), top of content area.

**Tab navigation:** Horizontal pill row below the title:
- `Connection` | `AI Providers` | `Categorization` | `Advanced`
- Uses `.pill` component. Active tab: dark fill. Others: white with border.

**Sticky save bar:** When any setting is dirty (changed from saved state), a bar appears at the bottom of the settings area:
- Background: `var(--bg-surface-warm)`.
- Left: "Unsaved changes" text (amber color).
- Right: "Discard" (ghost button) + "Save Changes" (dark primary button).

### 4.3 Connection Tab

**Graph Connection Card:**
- `.card` with prominent layout.
- Left: Status icon (40px, green/amber/red background tint) + connection name + status label.
- Right: "Reconnect" button.
- Below: Three stat cards in a grid — Token Expiry, Last Sync, Account. Each is a small rounded card (`var(--bg-canvas)` background) with uppercase label + bold value.

**Email Provider Card:**
- `.card` with description.
- Three selectable option cards in a row: "Microsoft Graph", "Chrome (Outlook Web)", "Auto-detect".
- Selected option: `border: 2px solid var(--accent-ai); background: var(--bg-surface-warm);`
- Others: default card border.

**Archive Destination Card:**
- `.card` with a select dropdown for folder choice.

### 4.4 AI Providers Tab

**Primary Provider Card:**
- `.card` with provider dropdown, model dropdown, API key input (masked with reveal toggle).
- Clear visual hierarchy: provider name large, model and key as sub-fields.

**Fallback Provider Card:**
- Same structure as primary.

**AI Settings Card:**
- Enable AI Drafting toggle (`.toggle` component).
- Max Draft Length input.

**Scoring & Priority Card:**
- **Priority threshold** slider/input (replaces the current "Triage Threshold %" label): value 0–100, with description "Hide emails scoring below this value." Maps to the existing `minScore` setting.
- **Group by priority** toggle (`.toggle`): on/off. When on, the email list shows Act Now / Review / Low Priority tier sections. When off, flat score-sorted list with heat-gradient borders only. Default: on. This is a new client-side preference stored in localStorage.

### 4.5 Categorization Tab

**Categories Section:**
- Grid of category cards (3 columns on desktop, responsive).
- Each card: `.card` with left border accent in category color.
  - Header: Category name + enable/disable toggle.
  - Description text (muted).
  - Large count number in category color + "emails in inbox" label.

**Topic Labels Section:**
- Header: "Topic Labels" + "+ Add Label" button (`.btn` primary-ai).
- Each label is a `.card` row:
  - Left: Tag icon in a small colored square (matching the mapped category).
  - Label name (13px/600).
  - Pattern tags: small pills showing each match pattern.
  - Category mapping: small category badge with arrow "→ FYI".
  - Match count: "4 matches" in success color.
  - Edit icon button on right.
- **Adding/editing a label** opens an inline editing state within the card:
  - Label name input.
  - Pattern input: type-to-add tags (press Enter or comma to add). Each tag is a removable pill.
  - Category dropdown.
  - Save/Cancel buttons.

**Custom Rules Section:**
- Header: "Custom Rules" + "+ Add Rule" button.
- Each rule is a `.card` row with visual IF/THEN formatting:
  - `IF` badge (warm dark background) + condition type text + value in a code-style pill + `THEN` badge + category badge.
  - Match count on right.
  - Edit icon button.
- **Adding/editing a rule** opens inline editing:
  - Condition type dropdown (sender email, sender domain, subject contains, subject exact).
  - Value input.
  - Action: category dropdown or "Skip automation" toggle.
  - Save/Cancel buttons.

**Live match preview:** Each label and rule shows a real-time count of how many current inbox emails would match. This requires a lightweight backend endpoint that tests patterns against current triage items without re-running full categorization.

### 4.6 Advanced Tab

Contains infrequently-changed settings in card sections:
- **Inbox Settings Card:** Lookback days input, VIP senders textarea.
- **Signature Card:** Email signature textarea.
- **Developer Card:** Extra settings JSON textarea.

---

## 5. Logs

### 5.1 Layout

**Page title:** "Logs" (20px/700) with Live toggle (`.toggle` component) on the right.

**Summary Stats Bar:**
- Horizontal row of stat cards below the title:
  - Total actions today (neutral)
  - Errors (red accent)
  - Drafts generated (AI accent)
  - Sent (success accent)
- Each card: white background, border, rounded. Bold count + muted label.
- Clickable — clicking a stat card activates the corresponding filter.

**Filter Pills:**
- Horizontal row: `All`, `Errors`, `Drafts`, `Categorization`, `Actions`.
- Uses `.pill` component with relevant color tints.
- Search input (pill-shaped) on the right.

### 5.2 Log Entries

Replaces the current table layout with a card-based list.

**Each entry is a row within a single `.card` container:**
- Left: 32px icon square (rounded, category-tinted background) with action-specific icon:
  - Checkmark (success/sent)
  - Tag (categorization)
  - X-circle (error)
  - Pencil (draft generated)
  - Archive, pin, delete icons for user actions
- Middle (flex):
  - Line 1: Action name (13px/600) + " — " + related email subject (12px, muted, clickable to navigate to that email).
  - Line 2: Context description (11px, muted). E.g., "Replied to Sarah Chen via Graph API" or "Claude API timeout, retried with Gemma."
- Right: Status badge (success/warning/error/draft) + relative timestamp.

**Error entries** get a subtle red background tint (`#fffbfb`).

**Expanded detail:** Clicking a row expands an accordion section below it showing full JSON details (monospace, warm-styled code block). Smooth height transition animation.

### 5.3 Log Summary Computation

The summary stats bar requires counting log entries by type for the current day. This is computed client-side from the existing `logs[]` array in DashboardClient. No backend changes needed — just aggregate counts from the in-memory log data with filters:
- **Actions today:** all logs with today's date.
- **Errors:** logs where type includes error/failure.
- **Drafts generated:** logs with draft-generation action.
- **Sent:** logs with draft-sent action.

---

## 6. Responsive Breakpoints

| Breakpoint | Layout |
|-----------|--------|
| ≥1100px | Icon rail (56px) + email list (~380px) + reader pane (flex). Settings/logs get full width minus rail. |
| 768–1099px | Icon rail collapses to hamburger drawer. Email list + reader side by side. |
| <768px | Single panel. Email list full width → tap to slide reader in. Settings/logs stack vertically. |

---

## 7. Migration Notes

### 7.1 What Changes

- **HTML structure:** `index.html` gets restructured — sidebar becomes icon rail, filter rail is removed (replaced by pills in email list area), draft modal is removed (replaced by inline editing in reader pane), settings form restructured into tabbed cards.
- **CSS:** Complete rewrite split into 8 files. All current class names change.
- **app.js:** Rendering functions need significant updates:
  - `renderEmailCards()` — new compact row format, no action buttons in list.
  - Reader pane rendering — adds inline draft section with edit/send flow.
  - Settings rendering — tabbed layout, card-based sections, new categorization UI.
  - Logs rendering — summary bar, pill filters, contextual entries.
  - Draft modal code removed, replaced by inline reader pane draft editing.
  - New: Graph connection status widget and proactive warning logic.
- **email-helpers.js:** Category colors updated to new palette. Avatar color generation function needed.
- **New endpoint needed:** Pattern match preview (counts how many inbox emails match a given pattern/rule).

### 7.2 What Stays the Same

- **Backend logic:** Express server, WebSocket communication, draft generation, categorization engine — all unchanged.
- **Data model:** No changes to how emails, drafts, settings, or logs are stored/transmitted.
- **portal-state.js, portal-constants.js:** Minimal changes (state key names may shift slightly).
- **Functionality:** All existing features preserved. This is additive (new features) + visual (reskin), not reductive.

### 7.3 New Backend Endpoint

**`GET /api/categorization/preview?type=topic_label&patterns=budget,invoice`** (or similar)
- Accepts a pattern type and values.
- Tests against current triage items in memory.
- Returns `{ matchCount: 4, matchedIds: [...] }`.
- Lightweight — no AI calls, just string matching.

---

## 8. Mockup Reference

Visual mockups created during brainstorming are preserved in:
`.superpowers/brainstorm/85905-1776108154/`

- `visual-direction.html` — Three visual direction options (Warm Minimal selected)
- `layout-options.html` — Two layout structure options (Icon Rail selected)
- `email-list-mockup.html` — Full email workspace mockup with list + reader + draft
- `design-system.html` — Color tokens, components, typography
- `settings-mockup.html` — Settings connection tab, categorization tab, logs view
