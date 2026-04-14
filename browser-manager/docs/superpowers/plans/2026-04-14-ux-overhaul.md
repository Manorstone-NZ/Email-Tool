# UX Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Browser Manager dashboard into a premium, agency-quality email triage app with the "Warm Minimal" design language — icon rail navigation, smart priority grouping, inline draft editing, tabbed settings, and actionable logs.

**Architecture:** Complete CSS rewrite split into 8 files with design tokens. HTML restructured for icon rail + two-panel email workspace. JS rendering functions updated view-by-view, preserving all backend logic and WebSocket communication. One new backend endpoint for pattern match preview.

**Tech Stack:** Vanilla JS, Express, WebSocket, plain CSS with custom properties, inline SVG icons (Feather-style).

**Spec:** `docs/superpowers/specs/2026-04-14-ux-overhaul-design.md`

---

## File Structure

### New CSS files (replace `public/style.css`):
| File | Responsibility |
|------|---------------|
| `public/css/tokens.css` | CSS custom properties: colors, radii, typography |
| `public/css/base.css` | Reset, body, typography defaults, hidden utility |
| `public/css/components.css` | Reusable: .pill, .btn, .card, .badge, .avatar, .toggle, .input, .toast, .status-dot |
| `public/css/shell.css` | Icon rail, view switching, mobile drawer |
| `public/css/email.css` | Search bar, filter pills, priority tiers, email rows, reader pane, inline draft |
| `public/css/settings.css` | Settings tabs, connection card, provider cards, categorization builder, advanced |
| `public/css/logs.css` | Summary stats bar, filter pills, log entries, expanded details |
| `public/css/responsive.css` | Breakpoints: ≥1100px, 768–1099px, <768px |
| `public/style.css` | Barrel file: 8 @import statements |

### Modified files:
| File | What Changes |
|------|-------------|
| `public/index.html` | Shell → icon rail, filter rail → pill bar in list area, draft modal removed, settings restructured into tabs, logs restructured |
| `public/app.js` | renderTriage(), renderEmailCards(), renderReaderPane(), renderLogs(), settings methods — all rendering updated. New: priority grouping, tag popover, inline draft editing, Graph status widget, log summary stats |
| `public/email-helpers.js` | New: avatarColor(), scoreToHeatColor(), groupByPriorityTier(). Updated: getCategoryColor() to new palette, filterEmailItems() for tag popover logic |
| `public/portal-state.js` | New: get/setGroupByPriority() localStorage preference |
| `public/portal-constants.js` | New: PRIORITY_TIERS, HEAT_GRADIENT_THRESHOLDS, AVATAR_PALETTE constants |
| `dashboard.js` | New endpoint: GET /api/categorization/preview |

### Test files to update:
| File | What Changes |
|------|-------------|
| `tests/email-helpers.test.js` | New tests for avatarColor, scoreToHeatColor, groupByPriorityTier |
| `tests/ui/email-workspace-contract.test.js` | Update for new HTML structure, priority tiers, pill bar |
| `tests/ui/shell-layout.test.js` | Update for icon rail instead of sidebar |

---

## Phase 1: CSS Foundation

### Task 1: Create CSS tokens and base

**Files:**
- Create: `public/css/tokens.css`
- Create: `public/css/base.css`
- Modify: `public/index.html` (change stylesheet link)

- [ ] **Step 1: Create `public/css/` directory**

```bash
mkdir -p browser-manager/public/css
```

- [ ] **Step 2: Write `tokens.css`**

Create `public/css/tokens.css` with all design tokens from spec section 1.1–1.2:

```css
:root {
  /* Surfaces */
  --bg-canvas: #fafaf8;
  --bg-surface: #ffffff;
  --bg-surface-warm: #faf8f5;
  --bg-rail: #f5f3f0;
  --bg-muted: #ebe6df;

  /* Borders */
  --border-default: #e8e5e0;
  --border-subtle: #ece8e3;
  --border-input: #e0dbd4;

  /* Text */
  --text-primary: #1a1a1a;
  --text-secondary: #444444;
  --text-tertiary: #777777;
  --text-muted: #a09890;

  /* Category accents — foreground */
  --cat-needs-reply-fg: #9b3c3c;
  --cat-waiting-fg: #8b6a2f;
  --cat-fyi-fg: #4a6380;
  --cat-notification-fg: #777060;
  --cat-marketing-fg: #7a6088;

  /* Category accents — background */
  --cat-needs-reply-bg: #fef0f0;
  --cat-waiting-bg: #fef8ec;
  --cat-fyi-bg: #eef3f8;
  --cat-notification-bg: #f0f0ec;
  --cat-marketing-bg: #f5f0f8;

  /* Category accents — border */
  --cat-needs-reply-border: #f5d0d0;
  --cat-waiting-border: #f0e0c0;
  --cat-fyi-border: #d4e0ec;
  --cat-notification-border: #e0e0d8;
  --cat-marketing-border: #e0d8e8;

  /* Category left-border accents (stronger) */
  --cat-needs-reply-accent: #c0564a;
  --cat-waiting-accent: #b8860b;
  --cat-fyi-accent: #4a6380;
  --cat-notification-accent: #777060;
  --cat-marketing-accent: #7a6088;

  /* Score heat gradient */
  --score-hot: #c0564a;
  --score-warm: #d4a030;
  --score-mild: #d4a574;
  --score-cool: #e0dbd4;

  /* Priority tier backgrounds */
  --tier-act-now-bg: #fef0f0;
  --tier-review-bg: #fef8ec;
  --tier-low-bg: #f5f3f0;

  /* Special */
  --accent-ai: #d4a574;
  --accent-brand: #5a4a38;
  --status-success: #5a9a6a;
  --status-warning: #d4a030;
  --status-error: #c0564a;

  /* Radii */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 14px;
  --radius-pill: 99px;
}
```

- [ ] **Step 3: Write `base.css`**

Create `public/css/base.css` with reset and typography:

```css
*, *::before, *::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
  background: var(--bg-canvas);
  min-height: 100vh;
  color: var(--text-secondary);
  font-size: 0.875rem;
  line-height: 1.6;
}

[hidden] {
  display: none !important;
}

h1, h2, h3, h4 {
  color: var(--text-primary);
  font-weight: 700;
  line-height: 1.3;
}
```

- [ ] **Step 4: Create barrel `style.css`**

Replace `public/style.css` content with:

```css
@import 'css/tokens.css';
@import 'css/base.css';
@import 'css/components.css';
@import 'css/shell.css';
@import 'css/email.css';
@import 'css/settings.css';
@import 'css/logs.css';
@import 'css/responsive.css';
```

- [ ] **Step 5: Create placeholder files for remaining CSS**

Create empty files for `components.css`, `shell.css`, `email.css`, `settings.css`, `logs.css`, `responsive.css` so the imports don't error.

- [ ] **Step 6: Verify page loads without errors**

Open `http://localhost:4100` and confirm the page loads (will look unstyled — that's expected).

- [ ] **Step 7: Commit**

```bash
git add public/css/ public/style.css
git commit -m "refactor: split CSS into token-based file structure"
```

---

### Task 2: Build reusable component CSS

**Files:**
- Create: `public/css/components.css`

- [ ] **Step 1: Write `.pill` component**

```css
.pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  border-radius: var(--radius-pill);
  padding: 5px 14px;
  cursor: pointer;
  border: 1px solid var(--border-input);
  background: var(--bg-surface);
  color: var(--text-tertiary);
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.pill:hover { background: var(--bg-rail); }
.pill.is-active { background: var(--accent-brand); color: #fff; border-color: transparent; }

/* Category pill variants */
.pill--needs-reply { background: var(--cat-needs-reply-bg); color: var(--cat-needs-reply-fg); border-color: var(--cat-needs-reply-border); }
.pill--waiting { background: var(--cat-waiting-bg); color: var(--cat-waiting-fg); border-color: var(--cat-waiting-border); }
.pill--fyi { background: var(--cat-fyi-bg); color: var(--cat-fyi-fg); border-color: var(--cat-fyi-border); }
.pill--notification { background: var(--cat-notification-bg); color: var(--cat-notification-fg); border-color: var(--cat-notification-border); }
.pill--marketing { background: var(--cat-marketing-bg); color: var(--cat-marketing-fg); border-color: var(--cat-marketing-border); }

.pill-count { opacity: 0.6; margin-left: 2px; }
.pill--sm { font-size: 0.625rem; padding: 1px 7px; }
.pill--ghost { border-color: transparent; background: transparent; color: var(--text-muted); font-weight: 500; }
.pill--ghost:hover { background: var(--bg-rail); }
```

- [ ] **Step 2: Write `.btn` component**

```css
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: var(--radius-pill);
  font-size: 0.8125rem;
  font-weight: 600;
  padding: 9px 22px;
  cursor: pointer;
  border: 1px solid transparent;
  font-family: inherit;
  transition: background 0.15s, box-shadow 0.15s;
}

.btn--primary-ai { background: var(--accent-ai); color: #fff; }
.btn--primary-ai:hover { box-shadow: 0 2px 8px rgba(212,165,116,0.3); }

.btn--primary { background: var(--accent-brand); color: #fff; }
.btn--primary:hover { box-shadow: 0 2px 8px rgba(90,74,56,0.3); }

.btn--secondary { background: var(--bg-surface); border-color: var(--border-input); color: var(--accent-brand); }
.btn--secondary:hover { background: var(--bg-rail); }

.btn--ghost { background: var(--bg-surface); border-color: var(--border-input); color: var(--text-muted); }
.btn--ghost:hover { background: var(--bg-rail); }

.btn--danger { background: var(--bg-surface); border-color: var(--cat-needs-reply-border); color: var(--status-error); }
.btn--danger:hover { background: var(--cat-needs-reply-bg); }

.btn--sm { font-size: 0.75rem; padding: 6px 14px; }
.btn--icon { padding: 6px; width: 34px; height: 34px; }
```

- [ ] **Step 3: Write `.card`, `.badge`, `.avatar` components**

```css
/* Card */
.card {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: 16px 20px;
}

.card--category { border-left: 3px solid; }
.card--ai { background: var(--bg-surface-warm); border-left: 3px solid var(--accent-ai); }

/* Badge */
.badge {
  display: inline-flex;
  align-items: center;
  font-size: 0.625rem;
  font-weight: 600;
  border-radius: var(--radius-pill);
  padding: 2px 8px;
  white-space: nowrap;
}

/* Avatar */
.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-weight: 700;
  flex-shrink: 0;
}

.avatar--lg { width: 40px; height: 40px; font-size: 0.875rem; }
.avatar--md { width: 36px; height: 36px; font-size: 0.8125rem; }
.avatar--sm { width: 28px; height: 28px; font-size: 0.625rem; }
```

- [ ] **Step 4: Write `.toggle`, form controls, `.toast`, `.status-dot`**

```css
/* Toggle */
.toggle {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
  cursor: pointer;
}

.toggle input { opacity: 0; width: 0; height: 0; position: absolute; }

.toggle-track {
  position: absolute;
  inset: 0;
  background: var(--border-input);
  border-radius: 12px;
  transition: background 0.2s;
}

.toggle input:checked + .toggle-track { background: var(--accent-ai); }

.toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  background: #fff;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0,0,0,0.15);
  transition: transform 0.2s;
}

.toggle input:checked ~ .toggle-knob { transform: translateX(20px); }

/* Form controls */
.form-input,
.form-select,
.form-textarea {
  width: 100%;
  border: 1px solid var(--border-input);
  border-radius: 10px;
  padding: 9px 14px;
  font-size: 0.8125rem;
  font-family: inherit;
  background: var(--bg-surface);
  color: var(--text-secondary);
  transition: border-color 0.2s, box-shadow 0.2s;
}

.form-input:focus,
.form-select:focus,
.form-textarea:focus {
  outline: none;
  border-color: var(--accent-ai);
  box-shadow: 0 0 0 3px rgba(212,165,116,0.15);
}

.form-textarea { resize: vertical; min-height: 60px; line-height: 1.45; }
.form-label {
  display: block;
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 4px;
}

.form-hint { font-size: 0.6875rem; color: var(--text-muted); margin-top: 4px; }

/* Toast */
.toast {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 0.75rem;
  animation: toast-in 0.3s ease;
}

.toast--warning { background: var(--cat-waiting-bg); border: 1px solid var(--cat-waiting-border); color: var(--cat-waiting-fg); }
.toast--success { background: #f0faf3; border: 1px solid #c8e6d0; color: #3d7a55; }
.toast--error { background: var(--cat-needs-reply-bg); border: 1px solid var(--cat-needs-reply-border); color: var(--cat-needs-reply-fg); }

@keyframes toast-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }

/* Status dot */
.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot--success { background: var(--status-success); }
.status-dot--warning { background: var(--status-warning); animation: pulse 2s infinite; }
.status-dot--error { background: var(--status-error); }

@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

/* Section label */
.section-label {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}
```

- [ ] **Step 5: Verify components render correctly**

Create a temporary test page or inspect the app to confirm component classes apply correctly.

- [ ] **Step 6: Commit**

```bash
git add public/css/components.css
git commit -m "feat: add reusable component CSS — pills, buttons, cards, toggles, forms, toasts"
```

---

### Task 3: Build shell CSS + restructure HTML to icon rail

**Files:**
- Create: `public/css/shell.css`
- Modify: `public/index.html` — replace sidebar with icon rail

- [ ] **Step 1: Write `shell.css`**

Icon rail, nav icons, view switching, brand mark. See spec section 2.1.

```css
.app-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  background: var(--bg-canvas);
}

.icon-rail {
  background: var(--bg-rail);
  border-right: 1px solid var(--border-default);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 18px 0;
  gap: 6px;
  position: sticky;
  top: 0;
  height: 100vh;
}

.icon-rail__brand {
  width: 32px;
  height: 32px;
  background: var(--accent-ai);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
  color: #fff;
  font-weight: 800;
  font-size: 0.875rem;
}

.icon-rail__nav {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.nav-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: none;
  background: transparent;
  position: relative;
  transition: background 0.15s;
}

.nav-icon svg { stroke: var(--text-muted); transition: stroke 0.15s; }
.nav-icon:hover svg { stroke: var(--text-tertiary); }

.nav-icon.is-active {
  background: var(--bg-muted);
}

.nav-icon.is-active svg { stroke: var(--accent-brand); }

.nav-icon.is-active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 3px;
  background: var(--accent-ai);
  border-radius: 0 2px 2px 0;
}

.icon-rail__status {
  margin-top: auto;
  margin-bottom: 14px;
}

/* Graph status button in rail */
.graph-status-btn {
  width: 36px;
  height: 36px;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  cursor: pointer;
}

.graph-status-btn .status-dot {
  position: absolute;
  bottom: -2px;
  right: -2px;
  border: 2px solid var(--bg-rail);
}

/* Portal main */
.portal-main {
  width: 100%;
  overflow-y: auto;
}

/* View transitions */
[data-view] {
  animation: view-in 0.15s ease;
}

@keyframes view-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* Mobile sidebar toggle */
.app-sidebar-toggle { display: none; }
```

- [ ] **Step 2: Update `index.html` shell structure**

Replace the `<aside id="appSidebar">` and sidebar toggle with the icon rail. The `<main class="portal-main">` stays but loses padding (views manage their own).

Replace lines 10–17 (sidebar) with:

```html
<nav class="icon-rail" data-region="icon-rail">
    <div class="icon-rail__brand">B</div>
    <div class="icon-rail__nav">
        <button type="button" class="nav-icon is-active" data-route="email" aria-label="Email">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
        </button>
        <button type="button" class="nav-icon" data-route="settings" aria-label="Settings">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09c-.658.003-1.25.396-1.51 1z"/></svg>
        </button>
        <button type="button" class="nav-icon" data-route="logs" aria-label="Logs">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
        </button>
    </div>
    <div class="icon-rail__status">
        <button type="button" class="graph-status-btn" id="graphStatusBtn" aria-label="Graph connection status">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            <span class="status-dot status-dot--success" id="graphStatusDot"></span>
        </button>
    </div>
</nav>
```

Also remove the old `#sidebarToggleBtn`.

- [ ] **Step 3: Update `app.js` nav icon click handlers**

In `app.js`, update the route-change handler to target `.nav-icon[data-route]` instead of `.shell-nav-link[data-route]`. The `handleRouteChange()` method needs to toggle `is-active` on `.nav-icon` elements instead of `.shell-nav-link`.

Find the event listener setup (around line 1263) that attaches click handlers to `[data-route]` buttons. Update the selector and the active-class toggle from `shell-nav-link` to `nav-icon`.

- [ ] **Step 4: Verify shell renders**

Open `http://localhost:4100`. Confirm: thin icon rail on left, icons visible, clicking switches views, active state shows accent bar.

- [ ] **Step 5: Commit**

```bash
git add public/css/shell.css public/index.html public/app.js
git commit -m "feat: replace sidebar with icon rail navigation"
```

---

## Phase 2: Email Workspace

### Task 4: Email list HTML + CSS — search bar, filter pills, compact rows

**Files:**
- Create: `public/css/email.css`
- Modify: `public/index.html` — restructure email workspace (remove filter rail, add pill bar)
- Modify: `public/email-helpers.js` — add avatarColor(), scoreToHeatColor()
- Modify: `public/portal-constants.js` — add AVATAR_PALETTE, HEAT_GRADIENT_THRESHOLDS

- [ ] **Step 1: Add new constants to `portal-constants.js`**

```js
const AVATAR_PALETTE = [
  { bg: '#e8d5c4', fg: '#8b6a4f' }, // peach
  { bg: '#c4d5e8', fg: '#4f6a8b' }, // sky
  { bg: '#d4c4e8', fg: '#6a4f8b' }, // lavender
  { bg: '#c4e0d8', fg: '#3d7a65' }, // sage
  { bg: '#e8dcc4', fg: '#8b7a4f' }, // sand
  { bg: '#e8c4c4', fg: '#8b4f4f' }, // rose
];

const HEAT_GRADIENT_THRESHOLDS = [
  { min: 80, color: '#c0564a' },
  { min: 60, color: '#d4a030' },
  { min: 40, color: '#d4a574' },
  { min: 0,  color: '#e0dbd4' },
];

const PRIORITY_TIERS = [
  { key: 'act-now', label: 'Act Now', criteria: (item) => item.urgency === 'high' && (item.score || 0) >= 70 },
  { key: 'review', label: 'Review', criteria: (item) => item.urgency === 'medium' || (item.urgency === 'high' && (item.score || 0) < 70) },
  { key: 'low', label: 'Low Priority', criteria: (item) => item.urgency === 'low' || (!item.urgency) },
];
```

- [ ] **Step 2: Add helper functions to `email-helpers.js`**

Add `avatarColor(name)` — hash name to pick from AVATAR_PALETTE:

```js
function avatarColor(name) {
  const str = (name || '').trim();
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}
```

Add `scoreToHeatColor(score)`:

```js
function scoreToHeatColor(score) {
  const s = typeof score === 'number' ? score : 0;
  for (const t of HEAT_GRADIENT_THRESHOLDS) {
    if (s >= t.min) return t.color;
  }
  return HEAT_GRADIENT_THRESHOLDS[HEAT_GRADIENT_THRESHOLDS.length - 1].color;
}
```

Add `groupByPriorityTier(items)`:

```js
function groupByPriorityTier(items) {
  const groups = PRIORITY_TIERS.map(tier => ({ ...tier, items: [] }));
  for (const item of items) {
    const group = groups.find(g => g.criteria(item)) || groups[groups.length - 1];
    group.items.push(item);
  }
  return groups.filter(g => g.items.length > 0);
}
```

Update `getCategoryColor()` to return an object `{ fg, bg, border, accent }` matching the new token values instead of a single hex string.

- [ ] **Step 3: Write tests for new helpers**

In `tests/email-helpers.test.js`, add:

```js
describe('avatarColor', () => {
  it('returns a palette entry for a name', () => {
    const result = avatarColor('Sarah Chen');
    expect(result).toHaveProperty('bg');
    expect(result).toHaveProperty('fg');
  });

  it('returns consistent color for same name', () => {
    expect(avatarColor('Sarah Chen')).toEqual(avatarColor('Sarah Chen'));
  });

  it('handles empty string', () => {
    const result = avatarColor('');
    expect(AVATAR_PALETTE).toContainEqual(result);
  });
});

describe('scoreToHeatColor', () => {
  it('returns hot color for score >= 80', () => {
    expect(scoreToHeatColor(85)).toBe('#c0564a');
  });

  it('returns warm color for score 60-79', () => {
    expect(scoreToHeatColor(65)).toBe('#d4a030');
  });

  it('returns cool color for low scores', () => {
    expect(scoreToHeatColor(25)).toBe('#e0dbd4');
  });
});

describe('groupByPriorityTier', () => {
  it('groups items into tiers', () => {
    const items = [
      { urgency: 'high', score: 85 },
      { urgency: 'medium', score: 55 },
      { urgency: 'low', score: 30 },
    ];
    const groups = groupByPriorityTier(items);
    expect(groups[0].key).toBe('act-now');
    expect(groups[0].items).toHaveLength(1);
    expect(groups[1].key).toBe('review');
    expect(groups[2].key).toBe('low');
  });

  it('omits empty tiers', () => {
    const items = [{ urgency: 'low', score: 30 }];
    const groups = groupByPriorityTier(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('low');
  });
});
```

- [ ] **Step 4: Run tests**

```bash
cd browser-manager && npx jest tests/email-helpers.test.js --verbose
```

Expected: all new tests pass.

- [ ] **Step 5: Restructure email workspace HTML in `index.html`**

Replace the `<section id="view-email">` content. Remove `.email-filter-rail`. Replace with:

```html
<section id="view-email" class="email-workspace" data-view="email">
    <div class="email-list-panel" data-region="inbox-list">
        <!-- Search bar -->
        <div class="email-toolbar">
            <div class="email-search-wrap">
                <svg class="email-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input type="search" id="emailSearch" placeholder="Search emails..." class="email-search-input form-input">
                <button type="button" id="emailSearchClear" class="email-search-clear" hidden>&times;</button>
            </div>
            <button type="button" id="triageRefreshBtn" class="btn btn--icon btn--secondary" aria-label="Refresh">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            </button>
        </div>

        <!-- Category pills -->
        <div class="filter-bar" id="filterBar">
            <div class="filter-bar__categories" id="categoryPills"></div>
            <div class="filter-bar__state" id="statePills"></div>
        </div>

        <!-- Toast area -->
        <div id="toastArea" class="toast-area"></div>

        <!-- Triage status -->
        <p id="triageStatus" class="triage-status"></p>

        <!-- Email list with priority groups -->
        <div id="triageList" class="email-list"></div>
        <div id="emailEmptyState" class="empty-state" hidden>No emails found.</div>
    </div>

    <section id="readerPane" class="reader-pane" data-region="reader-pane" aria-label="Email reader pane"></section>
</section>
```

- [ ] **Step 6: Write `email.css`**

Full email workspace CSS covering: search bar, filter pills, priority tier headers, email rows with heat borders, reader pane, inline draft card. This is the largest CSS file. Follow spec sections 3.2–3.6 exactly.

Key classes: `.email-workspace`, `.email-list-panel`, `.email-toolbar`, `.email-search-wrap`, `.filter-bar`, `.tier-header`, `.email-row`, `.email-row.is-act-now`, `.reader-pane`, `.reader-header`, `.reader-actions`, `.reader-body`, `.draft-card`, `.draft-card.is-editing`, `.tag-popover`.

- [ ] **Step 7: Commit**

```bash
git add public/css/email.css public/index.html public/email-helpers.js public/portal-constants.js tests/email-helpers.test.js
git commit -m "feat: email workspace HTML/CSS — search, filter pills, compact rows, priority tiers"
```

---

### Task 5: Update `app.js` email rendering — compact rows + priority grouping

**Files:**
- Modify: `public/app.js` — renderTriage(), renderEmailCards(), updateRailCounts() → updateFilterCounts()

- [ ] **Step 1: Rewrite `renderEmailCards()` (~line 752)**

Replace the current card-based rendering with compact two-line rows. Each row is a `<div class="email-row">` with:
- Heat-gradient left border via inline style `border-left-color` from `scoreToHeatColor(item.score)`
- Avatar with `avatarColor(item.sender)`
- Line 1: sender + category badge + tag pills (max 2 + overflow) + score dot + timestamp
- Line 2: subject + preview snippet
- Act Now items get `.is-act-now` class (bold subject, "Action required" label, taller padding)

Use `groupByPriorityTier()` to wrap items in tier sections with `.tier-header` dividers. Respect the `groupByPriority` localStorage preference — if off, render flat list.

- [ ] **Step 2: Rewrite `updateRailCounts()` (~line 675) → `updateFilterCounts()`**

Instead of updating sidebar rail counts, update category pill counts and state pill counts in the new pill bar. Use `countEmailBuckets()` to get counts, then update `#categoryPills` and `#statePills` innerHTML.

- [ ] **Step 3: Add tag filter popover logic**

Add a filter button to the state pills row. On click, toggle a `.tag-popover` element showing all available tags as toggleable pills. Track selected tags in `emailFilters.tags[]`. Update `filterEmailItems()` call to include tag filter.

- [ ] **Step 4: Add search clear button behavior**

When `#emailSearch` has a value, show the `#emailSearchClear` button. Clicking it clears the input and triggers filter update.

- [ ] **Step 5: Verify email list renders**

Open `http://localhost:4100`. Confirm: category pills with counts, compact email rows, priority tier sections (if grouping enabled), heat-gradient borders, avatars with warm colors.

- [ ] **Step 6: Commit**

```bash
git add public/app.js
git commit -m "feat: compact email rows with priority grouping and heat-gradient borders"
```

---

### Task 6: Reader pane + inline draft editing

**Files:**
- Modify: `public/app.js` — renderReaderPane(), showDraftEditorModal() → inline editing
- Modify: `public/index.html` — remove `#draftEditorModal`

- [ ] **Step 1: Rewrite `renderReaderPane()` (~line 1193)**

New structure:
- Sticky header: avatar + subject + sender/email/time + category badge + tag pills + score badge
- Score detail strip (collapsed by default, toggle on score badge click): urgency, recommended action, reasons
- Action bar: Reply, Pin, Archive, Mark Done, Delete
- Body: email text
- AI Draft card (if draft exists): AI icon + label + provider + draft text + Send/Edit/Regenerate buttons

- [ ] **Step 2: Add "Move to..." folder action**

Add a "Move to..." button in the reader action bar. On click, it opens a dropdown popover listing Outlook folders (fetched once from `GET /api/graph/mail-folders` and cached in `this.folderCache`). Clicking a folder calls a new method `moveEmailToFolder(emailId, folderId)` that does `POST /api/emails/:id/move` (or reuse the existing Graph patch mechanism via a new endpoint). After moving, remove the email from `triageItems` and auto-select the next email.

New backend endpoint in `dashboard.js`:
```js
app.post('/api/emails/:id/move', async (req, res) => {
  const { folderId } = req.body;
  if (!folderId) return res.status(400).json({ error: 'folderId required' });
  // Use mailActionService._graphPatch to move email
  const result = await this.manager.moveEmail(req.params.id, folderId);
  res.json(result);
});
```

Add `moveEmail(emailId, folderId)` to `manager.js` that resolves the Graph message ID and patches `parentFolderId`.

- [ ] **Step 3: Implement inline draft editing**

Replace `showDraftEditorModal()` (Promise-based modal) with inline editing:
- "Edit" button transforms the draft card to editing mode: textarea + subject input + Save/Cancel
- "Send Draft" shows "Confirm Send?" for 3 seconds, then reverts
- Wire up `generateDraft()`, `sendDraft()` to work with inline UI

- [ ] **Step 4: Remove draft modal from HTML**

Delete the `#draftEditorModal` section from `index.html`. Remove `draft-editor-helpers.js` script tag (the `calculateEditorRows` function is no longer needed — textarea auto-sizes).

- [ ] **Step 5: Verify reader pane, draft flow, and move-to-folder**

Click an email → confirm reader pane shows with new layout. Click "Edit" on a draft → confirm inline editing. Click "Send Draft" → confirm 3-second confirmation. Click "Move to..." → confirm folder dropdown appears, selecting a folder moves the email.

- [ ] **Step 6: Commit**

```bash
git add public/app.js public/index.html
git commit -m "feat: reader pane with inline draft editing, remove draft modal"
```

---

## Phase 3: Settings

### Task 7: Settings HTML + CSS — tabbed layout + connection tab

**Files:**
- Create: `public/css/settings.css`
- Modify: `public/index.html` — restructure `#view-settings`
- Modify: `public/app.js` — loadSettings(), fillSettingsForm(), saveSettings()

- [ ] **Step 1: Write `settings.css`**

Settings tab pills, card sections, connection card with stat grid, provider selector cards, sticky save bar, categorization builder styles. Follow spec sections 4.2–4.6.

- [ ] **Step 2: Restructure settings HTML**

Replace the flat `<form id="settingsForm">` with tabbed structure:

```html
<section id="view-settings" data-view="settings" hidden>
    <h2 class="view-title">Settings</h2>
    <div class="settings-tabs" id="settingsTabs"></div>
    <div class="settings-content" id="settingsContent"></div>
    <div class="settings-save-bar" id="settingsSaveBar" hidden>
        <span class="settings-dirty-text">Unsaved changes</span>
        <button type="button" id="settingsDiscard" class="btn btn--ghost btn--sm">Discard</button>
        <button type="button" id="settingsSave" class="btn btn--primary btn--sm">Save Changes</button>
    </div>
</section>
```

The tab content is rendered dynamically by `app.js`.

- [ ] **Step 3: Update `app.js` settings rendering**

Rewrite settings rendering to:
- Render 4 tab pills (Connection, AI Providers, Categorization, Advanced)
- On tab click, render the corresponding tab content into `#settingsContent`
- Connection tab: Graph status card + email provider cards + archive folder
- AI Providers tab: primary/fallback cards + AI settings + scoring/priority controls
- Advanced tab: lookback, VIP, signature, extra JSON

- [ ] **Step 4: Wire up Graph status widget**

The `#graphStatusBtn` in the icon rail opens a popover showing connection details. Needs a new method `renderGraphStatusPopover()` that reads connection state from settings/WebSocket data.

- [ ] **Step 5: Verify settings tabs work**

Switch between tabs, confirm all form fields populate correctly, confirm save/discard works.

- [ ] **Step 6: Commit**

```bash
git add public/css/settings.css public/index.html public/app.js
git commit -m "feat: tabbed settings with connection card and Graph status widget"
```

---

### Task 8: Categorization tab — visual builder

**Files:**
- Modify: `public/app.js` — categorization rendering methods
- Modify: `dashboard.js` — new pattern preview endpoint

- [ ] **Step 1: Add pattern preview backend endpoint**

In `dashboard.js`, add:

```js
app.get('/api/categorization/preview', (req, res) => {
  const { type, value } = req.query;
  if (!type || !value) return res.json({ matchCount: 0, matchedIds: [] });

  const items = this.manager ? this.manager.getTriageItems() : [];
  const matchedIds = [];

  for (const item of items) {
    const email = item.email || item;
    let matches = false;

    if (type === 'sender_domain') {
      matches = (email.from || '').toLowerCase().includes(`@${value.toLowerCase()}`);
    } else if (type === 'sender_email') {
      matches = (email.from || '').toLowerCase() === value.toLowerCase();
    } else if (type === 'subject_contains') {
      matches = (email.subject || '').toLowerCase().includes(value.toLowerCase());
    } else if (type === 'topic_label') {
      const patterns = value.split(',').map(p => p.trim().toLowerCase());
      const text = `${email.subject || ''} ${email.bodyPreview || ''}`.toLowerCase();
      matches = patterns.some(p => text.includes(p));
    }

    if (matches) matchedIds.push(item.id || email.id);
  }

  res.json({ matchCount: matchedIds.length, matchedIds });
});
```

- [ ] **Step 2: Render category cards**

Render category grid with count, toggle, description, left-border accent. Each card shows live email count from `countEmailBuckets()`.

- [ ] **Step 3: Render topic labels builder**

Each label as a `.card` row with tag icon, name, pattern pills, category badge, match count (fetched from `/api/categorization/preview`), edit button. Inline editing: label name input, pattern tag input, category dropdown, save/cancel.

- [ ] **Step 4: Render custom rules builder**

Each rule as IF/THEN visual row with match count. Inline editing with condition type dropdown, value input, action dropdown.

- [ ] **Step 5: Verify categorization tab**

Add/edit a label, confirm match count updates. Add/edit a rule, confirm IF/THEN display.

- [ ] **Step 6: Commit**

```bash
git add public/app.js dashboard.js
git commit -m "feat: categorization builder with pattern preview and match counts"
```

---

## Phase 4: Logs

### Task 9: Logs view — summary stats + contextual entries

**Files:**
- Create: `public/css/logs.css`
- Modify: `public/index.html` — restructure `#view-logs`
- Modify: `public/app.js` — renderLogs()

- [ ] **Step 1: Write `logs.css`**

Summary stat cards, filter pills, log entry rows with icons, error tint, expanded details accordion. Follow spec section 5.

- [ ] **Step 2: Restructure logs HTML**

```html
<section id="view-logs" data-view="logs" hidden>
    <div class="logs-header">
        <h2 class="view-title">Logs</h2>
        <label class="toggle">
            <input type="checkbox" id="logsLiveToggle">
            <span class="toggle-track"></span>
            <span class="toggle-knob"></span>
        </label>
        <span class="logs-live-label" id="logsLiveLabel">Live</span>
    </div>
    <div class="logs-summary" id="logsSummary"></div>
    <div class="logs-filters" id="logsFilters"></div>
    <div class="logs-entries" id="logsEntries"></div>
</section>
```

- [ ] **Step 3: Rewrite `renderLogs()` (~line 331)**

New rendering:
- Summary bar: count actions today, errors, drafts generated, sent. Each clickable to filter.
- Filter pills: All, Errors, Drafts, Categorization, Actions + search input
- Log entries: icon + action name + email subject + context + status badge + timestamp
- Error rows get `.log-entry--error` class
- Click to expand accordion with JSON detail

- [ ] **Step 4: Add log summary computation**

New method `computeLogSummary()` that aggregates `this.logs[]` by type for today's date.

- [ ] **Step 5: Verify logs view**

Confirm summary stats show, filter pills work, entries display with icons and context.

- [ ] **Step 6: Commit**

```bash
git add public/css/logs.css public/index.html public/app.js
git commit -m "feat: logs view with summary stats, filter pills, and contextual entries"
```

---

## Phase 5: Responsive + Polish

### Task 10: Responsive breakpoints

**Files:**
- Create: `public/css/responsive.css`
- Modify: `public/app.js` — mobile drawer toggle

- [ ] **Step 1: Write `responsive.css`**

Three breakpoints per spec section 6:
- `≥1100px`: Icon rail + email list + reader side by side
- `768–1099px`: Icon rail collapses to hamburger drawer, email list + reader
- `<768px`: Single panel, email list full width, reader slides in

- [ ] **Step 2: Add mobile drawer toggle**

Show hamburger button on <1100px. Clicking it toggles a slide-out drawer with icon + text labels. Update `app.js` mobile handlers.

- [ ] **Step 3: Verify at all breakpoints**

Resize browser to test each breakpoint. Confirm: icon rail collapses, drawer works, single-panel mode on mobile, reader slide-in.

- [ ] **Step 4: Commit**

```bash
git add public/css/responsive.css public/app.js
git commit -m "feat: responsive breakpoints — icon rail collapse, mobile drawer, single-panel mode"
```

---

### Task 11: Graph connection proactive warnings + toast system

**Files:**
- Modify: `public/app.js` — toast rendering, Graph token monitoring

- [ ] **Step 1: Add toast rendering system**

New method `showToast(type, message, action)`:
- Renders a `.toast` element in `#toastArea`
- Types: 'warning', 'success', 'error'
- Optional action button (text + callback)
- Auto-dismiss after 5 seconds

- [ ] **Step 2: Add Graph token expiry monitoring**

In the WebSocket message handler, watch for Graph connection state. When token expiry < 15 minutes:
- Update `#graphStatusDot` class to `status-dot--warning`
- Show toast: "Graph connection expiring — click to reconnect" with Reconnect action

- [ ] **Step 3: Verify toast appears when Graph token is low**

Simulate low token expiry. Confirm amber pulsing dot and toast notification.

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat: toast notification system and Graph connection expiry warnings"
```

---

### Task 12: Final cleanup + delete old CSS

**Files:**
- Delete: Old `public/style.css` content (now barrel file)
- Modify: `public/app.js` — remove dead code (old card rendering, modal references, sidebar references)
- Update: `tests/ui/shell-layout.test.js`, `tests/ui/email-workspace-contract.test.js`

- [ ] **Step 1: Remove dead code from `app.js`**

Delete: old `renderEmailCards` card template code (replaced), `showDraftEditorModal` (replaced by inline), any sidebar toggle references, old rail rendering code.

- [ ] **Step 2: Update UI contract tests**

Update selectors in test files to match new class names (`.nav-icon` instead of `.shell-nav-link`, `.email-row` instead of `.email-card`, etc.).

- [ ] **Step 3: Run full test suite**

```bash
cd browser-manager && npx jest --verbose
```

Expected: all tests pass.

- [ ] **Step 4: Visual regression check**

Walk through entire app: email list → reader → draft → settings (all 4 tabs) → logs. Verify everything renders correctly with warm minimal aesthetic.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove dead code, update tests for new UI structure"
```

---

## Summary

| Phase | Tasks | What It Produces |
|-------|-------|-----------------|
| Phase 1: CSS Foundation | Tasks 1–3 | Token system, components, icon rail shell |
| Phase 2: Email Workspace | Tasks 4–6 | Compact rows, priority grouping, reader + inline drafts |
| Phase 3: Settings | Tasks 7–8 | Tabbed settings, Graph status, categorization builder |
| Phase 4: Logs | Task 9 | Summary stats, contextual entries |
| Phase 5: Polish | Tasks 10–12 | Responsive, toasts, cleanup |

Each task produces a working, committable state. The app remains functional throughout — no big-bang switchover.
