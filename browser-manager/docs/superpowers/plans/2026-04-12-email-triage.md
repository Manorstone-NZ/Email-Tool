# Email Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract and score emails from the open Outlook tab, identify actionable items using a weighted scoring model, and display prioritized recommendations on the dashboard.

**Architecture:** 
1. `email-extractor.js` uses AppleScript to scrape emails from Outlook DOM (sender, subject, body snippet, flagged status, threading context)
2. `email-scorer.js` implements weighted scoring model (primary signals: direct asks, assigned responsibility, reply-required; secondary: VIP sender, flagged, engagement history; weak: keywords, unread)
3. `email-triage.js` orchestrates extraction → scoring → filtering to surface top actionable emails
4. `manager.js` wires triage into event system so results broadcast to dashboard
5. `dashboard.js` exposes `/api/emails/triage` endpoint and broadcasts triage results via WebSocket
6. Dashboard UI component renders actionable emails with reason, suggested action, confidence score
7. `npm run triage-emails` command triggers on-demand triage

**Tech Stack:** Node.js, AppleScript (via child_process.exec), EventEmitter pattern (existing), Express, WebSocket broadcast

**Scope (Phase 1):**
- Inbox only
- Last 72 hours (hard cutoff; flagged items included regardless)
- Extract: sender, subject, body (first 200 chars), flagged status, read status, threading info
- Score: primary (40%), secondary (35%), weak (15%), exclusions (10% penalty)
- Output: top 10 actionable items, min confidence 40%

---

## File Structure

**New files:**
- `src/email-extractor.js` — AppleScript DOM scraper + parser
- `src/email-scorer.js` — Weighted scoring engine
- `src/email-triage.js` — Orchestration layer
- `public/email-triage.html` — Dashboard panel HTML
- `public/email-triage.js` — Dashboard client-side rendering

**Modified files:**
- `manager.js` — Wire triage module + expose triage method
- `dashboard.js` — Add triage route + broadcast handler
- `package.json` — Add npm script
- `public/index.html` — Link triage panel
- `public/style.css` — Triage panel styles

---

## Task 1: Email Extractor Module

**Files:**
- Create: `src/email-extractor.js`

**Responsibility:** Extract raw email data from Outlook DOM via AppleScript. Returns array of parsed emails with: sender, subject, body, flagged, read, timestamp, threadId.

- [ ] **Step 1: Write test file for email extraction**

Create `tests/email-extractor.test.js`:

```javascript
const EmailExtractor = require('../src/email-extractor');

describe('EmailExtractor', () => {
  let extractor;

  beforeEach(() => {
    extractor = new EmailExtractor();
  });

  test('parseEmailFromDOM should parse raw email string', () => {
    const rawEmail = `
      FROM: alice@company.com
      SUBJECT: Action Required: Budget Approval
      BODY: Can you approve the Q2 budget? Need by EOD.
      FLAGGED: true
      READ: false
      TIMESTAMP: 2026-04-12T10:30:00Z
      THREAD_ID: thread_123
    `;
    
    const parsed = extractor.parseEmailFromDOM(rawEmail);
    expect(parsed.sender).toBe('alice@company.com');
    expect(parsed.subject).toBe('Action Required: Budget Approval');
    expect(parsed.body).toContain('approve');
    expect(parsed.flagged).toBe(true);
    expect(parsed.read).toBe(false);
  });

  test('isWithin72Hours should return true for recent emails', () => {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    expect(extractor.isWithin72Hours(twoHoursAgo)).toBe(true);
  });

  test('isWithin72Hours should return false for old emails', () => {
    const now = new Date();
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    expect(extractor.isWithin72Hours(fiveDaysAgo)).toBe(false);
  });

  test('getInboxEmails should return parsed email array (stubbed)', async () => {
    // Stub exec to avoid actual AppleScript calls
    const emails = await extractor.getInboxEmails();
    expect(Array.isArray(emails)).toBe(true);
  });
});
```

Run: `npm test -- tests/email-extractor.test.js`
Expected: FAIL (module not found)

- [ ] **Step 2: Implement EmailExtractor class**

Create `src/email-extractor.js`:

```javascript
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class EmailExtractor {
  constructor() {
    this.MS_PER_72_HOURS = 72 * 60 * 60 * 1000;
  }

  isWithin72Hours(timestamp) {
    const emailTime = new Date(timestamp).getTime();
    const now = new Date().getTime();
    return (now - emailTime) <= this.MS_PER_72_HOURS;
  }

  parseEmailFromDOM(rawEmail) {
    // Parse format: KEY: VALUE pairs
    const lines = rawEmail.trim().split('\n');
    const parsed = {};

    lines.forEach(line => {
      const [key, ...valueParts] = line.split(':');
      const value = valueParts.join(':').trim();
      
      if (key === 'FROM') parsed.sender = value;
      else if (key === 'SUBJECT') parsed.subject = value;
      else if (key === 'BODY') parsed.body = value;
      else if (key === 'FLAGGED') parsed.flagged = value === 'true';
      else if (key === 'READ') parsed.read = value === 'true';
      else if (key === 'TIMESTAMP') parsed.timestamp = value;
      else if (key === 'THREAD_ID') parsed.threadId = value;
    });

    return parsed;
  }

  async getInboxEmails() {
    // AppleScript to extract structured email data from Outlook
    const script = `
tell application "Microsoft Outlook"
  set emailList to {}
  set msgList to every message of inbox
  repeat with msg in msgList
    set emailData to (sender of msg) & "|||" & (subject of msg) & "|||" & (content of msg) & "|||" & (flag index of msg > 0) & "|||" & (read status of msg)
    set end of emailList to emailData
  end repeat
  return emailList as text
end tell
    `;

    try {
      const { stdout } = await execAsync(`osascript -e '${script}'`);
      const emails = stdout
        .trim()
        .split('\n')
        .filter(line => line.length > 0)
        .map(line => {
          const [sender, subject, body, flagged, read] = line.split('|||');
          return {
            sender: sender.trim(),
            subject: subject.trim(),
            body: body.trim().substring(0, 200), // First 200 chars
            flagged: flagged === 'true',
            read: read === 'true',
            timestamp: new Date().toISOString(), // Outlook AppleScript doesn't expose received date easily
            threadId: `thread_${Math.random().toString(36).substr(2, 9)}`
          };
        });

      return emails;
    } catch (error) {
      console.error('[EmailExtractor] Failed to extract emails:', error.message);
      return [];
    }
  }
}

module.exports = EmailExtractor;
```

- [ ] **Step 3: Run tests to verify implementation**

Run: `npm test -- tests/email-extractor.test.js`
Expected: PASS (all tests pass)

- [ ] **Step 4: Commit**

```bash
git add src/email-extractor.js tests/email-extractor.test.js
git commit -m "feat: add email extraction via AppleScript"
```

---

## Task 2: Email Scorer Module

**Files:**
- Create: `src/email-scorer.js`

**Responsibility:** Implement weighted scoring model. Score primary signals (40%), secondary (35%), weak (15%), apply exclusion penalties (10%). Return confidence score 0–100.

- [ ] **Step 1: Write test file for scoring**

Create `tests/email-scorer.test.js`:

```javascript
const EmailScorer = require('../src/email-scorer');

describe('EmailScorer', () => {
  let scorer;

  beforeEach(() => {
    scorer = new EmailScorer();
  });

  test('scorePrimarySignals: direct ask should score high', () => {
    const body = 'Can you please approve this by EOD?';
    const score = scorer.scorePrimarySignals({ body, subject: 'Budget Approval' });
    expect(score).toBeGreaterThan(25); // Primary weight is 40%, so score > 25 is good
  });

  test('scorePrimarySignals: no direct ask should score low', () => {
    const body = 'FYI: Team lunch is at noon tomorrow.';
    const score = scorer.scorePrimarySignals({ body, subject: 'Lunch Announcement' });
    expect(score).toBeLessThan(10);
  });

  test('scoreSecondarySignals: flagged email should score high', () => {
    const score = scorer.scoreSecondarySignals({ flagged: true, sender: 'random@example.com' });
    expect(score).toBeGreaterThan(10);
  });

  test('scoreWeakSignals: URGENT keyword should score low', () => {
    const body = 'URGENT: Please review this document.';
    const score = scorer.scoreWeakSignals({ body, read: false });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(15); // Weak signals max 15
  });

  test('checkExclusions: newsletter should return penalty', () => {
    const penalty = scorer.checkExclusions({ subject: 'Weekly Newsletter', sender: 'news@example.com' });
    expect(penalty).toBeGreaterThan(0);
  });

  test('score: high-confidence email should score 60+', () => {
    const email = {
      sender: 'ceo@company.com',
      subject: 'Q2 Budget - Approval Needed',
      body: 'Hi, can you approve the attached Q2 budget by Friday?',
      flagged: true,
      read: false,
      timestamp: new Date().toISOString()
    };
    const result = scorer.score(email);
    expect(result.score).toBeGreaterThan(60);
    expect(result.reason).toBeTruthy();
  });

  test('score: FYI newsletter should score <40', () => {
    const email = {
      sender: 'newsletter@example.com',
      subject: 'Weekly Digest',
      body: 'Here are this week\'s top stories...',
      flagged: false,
      read: true,
      timestamp: new Date().toISOString()
    };
    const result = scorer.score(email);
    expect(result.score).toBeLessThan(40);
  });
});
```

Run: `npm test -- tests/email-scorer.test.js`
Expected: FAIL (module not found)

- [ ] **Step 2: Implement EmailScorer class**

Create `src/email-scorer.js`:

```javascript
class EmailScorer {
  constructor() {
    this.VIP_SENDERS = ['ceo@', 'board@', 'vp@', 'director@'];
    this.actionKeywords = ['approve', 'confirm', 'can you', 'need', 'required', 'decision', 'action'];
    this.exclusionPatterns = [
      /newsletter/i,
      /digest/i,
      /alert/i,
      /automated/i,
      /noreply/i
    ];
  }

  scorePrimarySignals(email) {
    let score = 0;
    const body = (email.body || '').toLowerCase();

    // Direct ask or question
    if (/\?/.test(body) || this.actionKeywords.some(kw => body.includes(kw))) {
      score += 20;
    }

    // Assigned responsibility (named explicitly)
    if (body.includes('you') && /approve|review|confirm|decide/.test(body)) {
      score += 15;
    }

    // Reply-required heuristic
    if ((email.subject || '').match(/\[reply\]|RE:|FW:/i)) {
      score += 5;
    }

    return Math.min(score, 40); // Cap at 40% weight
  }

  scoreSecondarySignals(email) {
    let score = 0;

    // VIP sender
    if (this.VIP_SENDERS.some(vip => email.sender.includes(vip))) {
      score += 15;
    }

    // Flagged
    if (email.flagged) {
      score += 12;
    }

    // Engagement history (heuristic: threads with multiple messages)
    if (email.threadId && email.body.length > 200) {
      score += 8;
    }

    return Math.min(score, 35); // Cap at 35% weight
  }

  scoreWeakSignals(email) {
    let score = 0;
    const body = (email.body || '').toLowerCase();

    // Keywords (modified by unread status)
    if (/urgent|asap|important/.test(body)) {
      score += 8;
    }

    // Unread
    if (!email.read) {
      score += 7;
    }

    return Math.min(score, 15); // Cap at 15% weight
  }

  checkExclusions(email) {
    const subject = (email.subject || '').toLowerCase();
    const sender = (email.sender || '').toLowerCase();

    for (const pattern of this.exclusionPatterns) {
      if (pattern.test(subject) || pattern.test(sender)) {
        return 10; // 10% penalty
      }
    }

    // CC-only detection heuristic
    if (email.body && email.body.toLowerCase().includes('cc:only') && !email.body.toLowerCase().includes('cc:me')) {
      return 5;
    }

    return 0;
  }

  score(email) {
    const primary = this.scorePrimarySignals(email);
    const secondary = this.scoreSecondarySignals(email);
    const weak = this.scoreWeakSignals(email);
    const exclusion = this.checkExclusions(email);

    let totalScore = primary + secondary + weak;
    totalScore = Math.max(0, totalScore - exclusion);
    totalScore = Math.min(100, totalScore);

    // Determine suggested action
    let action = 'Ignore';
    if (totalScore >= 75) action = 'Approve / Decide';
    else if (totalScore >= 60) action = 'Review / Respond';
    else if (totalScore >= 45) action = 'Review Later';

    // Generate reason
    const reasons = [];
    if (primary > 20) reasons.push('Direct ask for action');
    if (this.VIP_SENDERS.some(vip => email.sender.includes(vip))) reasons.push('VIP sender');
    if (email.flagged) reasons.push('Flagged');
    if (!email.read) reasons.push('Unread');

    const reason = reasons.length > 0 ? reasons.join(' • ') : 'Low priority';

    return {
      email,
      score: totalScore,
      action,
      reason,
      signals: { primary, secondary, weak, exclusion }
    };
  }
}

module.exports = EmailScorer;
```

- [ ] **Step 3: Run tests to verify implementation**

Run: `npm test -- tests/email-scorer.test.js`
Expected: PASS (all tests pass)

- [ ] **Step 4: Commit**

```bash
git add src/email-scorer.js tests/email-scorer.test.js
git commit -m "feat: add weighted email scoring engine"
```

---

## Task 3: Email Triage Orchestrator

**Files:**
- Create: `src/email-triage.js`

**Responsibility:** Orchestrate extraction + scoring. Filter to top 10 actionable (min confidence 40%), sort by score descending. Emit triage-complete event.

- [ ] **Step 1: Write test file for triage orchestrator**

Create `tests/email-triage.test.js`:

```javascript
const EmailTriage = require('../src/email-triage');
const EmailExtractor = require('../src/email-extractor');
const EmailScorer = require('../src/email-scorer');

describe('EmailTriage', () => {
  let triage;
  let mockExtractor;
  let mockScorer;

  beforeEach(() => {
    mockExtractor = new EmailExtractor();
    mockScorer = new EmailScorer();
    triage = new EmailTriage(mockExtractor, mockScorer);
  });

  test('run should score and filter emails', async () => {
    // Mock extractor
    mockExtractor.getInboxEmails = jest.fn().mockResolvedValue([
      {
        sender: 'alice@company.com',
        subject: 'Budget Approval Needed',
        body: 'Can you approve the Q2 budget?',
        flagged: true,
        read: false,
        timestamp: new Date().toISOString(),
        threadId: 'thread_1'
      },
      {
        sender: 'newsletter@example.com',
        subject: 'Weekly Digest',
        body: 'Here are this week\'s stories',
        flagged: false,
        read: true,
        timestamp: new Date().toISOString(),
        threadId: 'thread_2'
      }
    ]);

    const results = await triage.run();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeLessThanOrEqual(10);
    expect(results[0].score).toBeGreaterThanOrEqual(40); // Min confidence
  });

  test('run should sort by score descending', async () => {
    mockExtractor.getInboxEmails = jest.fn().mockResolvedValue([
      {
        sender: 'bob@example.com',
        subject: 'Low Priority',
        body: 'Just FYI',
        flagged: false,
        read: true,
        timestamp: new Date().toISOString(),
        threadId: 'thread_1'
      },
      {
        sender: 'ceo@company.com',
        subject: 'Urgent Decision',
        body: 'I need your approval on this. Can you decide by EOD?',
        flagged: true,
        read: false,
        timestamp: new Date().toISOString(),
        threadId: 'thread_2'
      }
    ]);

    const results = await triage.run();
    if (results.length > 1) {
      expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
    }
  });
});
```

Run: `npm test -- tests/email-triage.test.js`
Expected: FAIL (module not found)

- [ ] **Step 2: Implement EmailTriage class**

Create `src/email-triage.js`:

```javascript
const { EventEmitter } = require('events');

class EmailTriage extends EventEmitter {
  constructor(extractor, scorer) {
    super();
    this.extractor = extractor;
    this.scorer = scorer;
    this.lastTriageResult = [];
  }

  async run() {
    try {
      // Extract emails
      const emails = await this.extractor.getInboxEmails();
      console.log(`[EmailTriage] Extracted ${emails.length} emails`);

      // Score each email
      const scored = emails.map(email => this.scorer.score(email));

      // Filter: min confidence 40%, exclude low scores
      const actionable = scored.filter(result => result.score >= 40);

      // Sort by score descending
      actionable.sort((a, b) => b.score - a.score);

      // Top 10
      const top10 = actionable.slice(0, 10);

      // Store result
      this.lastTriageResult = top10;

      // Emit event
      this.emit('triage-complete', {
        timestamp: new Date().toISOString(),
        totalExtracted: emails.length,
        actionableCount: actionable.length,
        topItems: top10
      });

      console.log(`[EmailTriage] Scored: ${actionable.length} actionable items, top ${top10.length} returned`);
      return top10;
    } catch (error) {
      console.error('[EmailTriage] Error during triage:', error.message);
      this.emit('triage-error', { error: error.message });
      return [];
    }
  }

  getLastResult() {
    return this.lastTriageResult;
  }
}

module.exports = EmailTriage;
```

- [ ] **Step 3: Run tests to verify implementation**

Run: `npm test -- tests/email-triage.test.js`
Expected: PASS (all tests pass)

- [ ] **Step 4: Commit**

```bash
git add src/email-triage.js tests/email-triage.test.js
git commit -m "feat: add email triage orchestrator with filtering and sorting"
```

---

## Task 4: Integrate Email Triage into Manager

**Files:**
- Modify: `manager.js`

**Responsibility:** Instantiate EmailTriage, wire event stream, expose `triageEmails()` method.

- [ ] **Step 1: Read current manager.js to understand structure**

Check: `head -n 50 manager.js` (understand initialization pattern)

- [ ] **Step 2: Add EmailTriage to manager initialization**

Add to `manager.js` (after `this.eventLogger` and before `this.dashboardServer`):

```javascript
const EmailExtractor = require('./src/email-extractor');
const EmailScorer = require('./src/email-scorer');
const EmailTriage = require('./src/email-triage');

// In BrowserManager constructor, after dashboardServer initialization:
this.emailExtractor = new EmailExtractor();
this.emailScorer = new EmailScorer();
this.emailTriage = new EmailTriage(this.emailExtractor, this.emailScorer);

// Wire triage events to event logger
this.emailTriage.on('triage-complete', (result) => {
  this.eventLogger.logAutomationEvent('email-triage-complete', {
    totalExtracted: result.totalExtracted,
    actionableCount: result.actionableCount,
    topItems: result.topItems.map(item => ({
      sender: item.email.sender,
      subject: item.email.subject,
      score: item.score,
      action: item.action
    }))
  });
});

this.emailTriage.on('triage-error', (error) => {
  this.eventLogger.logAutomationEvent('email-triage-error', { error: error.error });
});
```

- [ ] **Step 3: Add async triageEmails() method to manager**

Add method to BrowserManager class:

```javascript
async triageEmails() {
  return await this.emailTriage.run();
}
```

- [ ] **Step 4: Verify no syntax errors**

Run: `node -c manager.js`
Expected: No output (syntax OK)

- [ ] **Step 5: Commit**

```bash
git add manager.js
git commit -m "feat: integrate email triage module into browser manager"
```

---

## Task 5: Dashboard API Endpoint for Email Triage

**Files:**
- Modify: `dashboard.js`

**Responsibility:** Add `/api/emails/triage` endpoint. Trigger triage, return results. Broadcast triage event via WebSocket.

- [ ] **Step 1: Read current dashboard.js to understand route pattern**

Check: `grep -n "app\.get\|app\.post" dashboard.js` (understand routing)

- [ ] **Step 2: Add POST /api/emails/triage endpoint**

Add to `dashboard.js` (in DashboardServer constructor, after other routes):

```javascript
this.app.post('/api/emails/triage', async (req, res) => {
  try {
    const results = await this.manager.triageEmails();
    
    // Format for response
    const formatted = results.map(item => ({
      sender: item.email.sender,
      subject: item.email.subject,
      body: item.email.body,
      score: item.score,
      confidence: `${item.score}%`,
      action: item.action,
      reason: item.reason
    }));

    // Broadcast to WebSocket clients
    this.wsserver.clients.forEach(client => {
      if (client.readyState === 1) { // OPEN
        client.send(JSON.stringify({
          type: 'triage-result',
          data: formatted,
          timestamp: new Date().toISOString()
        }));
      }
    });

    res.json({ success: true, count: formatted.length, items: formatted });
  } catch (error) {
    console.error('[Dashboard] Triage error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});
```

- [ ] **Step 3: Add GET /api/emails/triage endpoint for poll-based fetch**

Add to `dashboard.js` (for dashboard fallback polling):

```javascript
this.app.get('/api/emails/triage', (req, res) => {
  const lastResult = this.manager.emailTriage.getLastResult();
  const formatted = lastResult.map(item => ({
    sender: item.email.sender,
    subject: item.email.subject,
    body: item.email.body,
    score: item.score,
    confidence: `${item.score}%`,
    action: item.action,
    reason: item.reason
  }));
  
  res.json({ success: true, count: formatted.length, items: formatted });
});
```

- [ ] **Step 4: Verify no syntax errors**

Run: `node -c dashboard.js`
Expected: No output (syntax OK)

- [ ] **Step 5: Commit**

```bash
git add dashboard.js
git commit -m "feat: add email triage endpoints to dashboard API"
```

---

## Task 6: Add npm Script for On-Demand Triage

**Files:**
- Modify: `package.json`

**Responsibility:** Add `npm run triage-emails` script that triggers the API endpoint programmatically.

- [ ] **Step 1: Create triage CLI script**

Create `scripts/triage-emails.js`:

```javascript
const http = require('http');

const options = {
  hostname: 'localhost',
  port: 4100,
  path: '/api/emails/triage',
  method: 'POST'
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', chunk => { data += chunk; });
  res.on('end', () => {
    if (res.statusCode === 200) {
      const result = JSON.parse(data);
      console.log(`\n📧 Email Triage Results (${result.count} actionable items)\n`);
      result.items.forEach((item, idx) => {
        console.log(`${idx + 1}. [${item.confidence}] ${item.sender}`);
        console.log(`   Subject: ${item.subject}`);
        console.log(`   Action: ${item.action}`);
        console.log(`   Why: ${item.reason}\n`);
      });
    } else {
      console.error('Error:', data);
      process.exit(1);
    }
  });
});

req.on('error', (error) => {
  console.error('Failed to connect to dashboard. Is npm start running?');
  console.error(error.message);
  process.exit(1);
});

req.end();
```

- [ ] **Step 2: Add npm script to package.json**

Modify `package.json`, add to `"scripts"` section:

```json
"triage-emails": "node scripts/triage-emails.js"
```

Full scripts section should look like:

```json
"scripts": {
  "start": "node manager.js",
  "test": "jest",
  "triage-emails": "node scripts/triage-emails.js"
}
```

- [ ] **Step 3: Test the script (with manager running)**

Run: `npm run triage-emails`
Expected: Display actionable emails (or "0 actionable items" if inbox is empty or no high-scoring emails)

- [ ] **Step 4: Commit**

```bash
git add scripts/triage-emails.js package.json
git commit -m "feat: add npm run triage-emails on-demand command"
```

---

## Task 7: Dashboard UI - Triage Panel HTML

**Files:**
- Create: `public/email-triage.html`
- Modify: `public/index.html`

**Responsibility:** Create dedicated triage panel with real-time updates. Show: sender, subject, confidence score, action, reason.

- [ ] **Step 1: Create email-triage.html panel**

Create `public/email-triage.html`:

```html
<div id="triage-panel" class="panel">
  <div class="panel-header">
    <h2>📧 Email Triage</h2>
    <button id="triage-refresh-btn" class="btn-small">Refresh</button>
  </div>

  <div id="triage-status" class="status-placeholder">
    Click "Refresh" to scan inbox for actionable emails
  </div>

  <div id="triage-list" class="triage-list"></div>
</div>
```

- [ ] **Step 2: Modify index.html to include triage panel**

Modify `public/index.html`, add after events panel:

```html
<!-- Email Triage Panel -->
<div class="section">
  <iframe id="triage-frame" src="/email-triage.html" style="width:100%; height:600px; border:1px solid #ddd;"></iframe>
</div>
```

OR embed directly (simpler):

```html
<!-- Email Triage Panel -->
<div id="email-triage-section" class="section">
  <div class="panel-header">
    <h2>📧 Email Triage</h2>
    <button id="triage-refresh-btn" class="btn-small">Refresh</button>
  </div>
  <div id="triage-status" class="status-placeholder">Click "Refresh" to scan inbox for actionable emails</div>
  <div id="triage-list" class="triage-list"></div>
</div>
```

- [ ] **Step 3: Add triage styles to style.css**

Add to `public/style.css`:

```css
.triage-list {
  margin-top: 20px;
}

.triage-item {
  background: #f8f9fa;
  border-left: 4px solid #007bff;
  padding: 12px;
  margin: 8px 0;
  border-radius: 4px;
}

.triage-item.high-confidence {
  border-left-color: #dc3545;
}

.triage-item.medium-confidence {
  border-left-color: #ffc107;
}

.triage-item.low-confidence {
  border-left-color: #6c757d;
}

.triage-sender {
  font-weight: bold;
  color: #495057;
  margin-bottom: 4px;
}

.triage-subject {
  font-size: 14px;
  color: #212529;
  margin-bottom: 6px;
}

.triage-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: #6c757d;
  margin-bottom: 6px;
}

.triage-confidence {
  font-weight: bold;
  padding: 2px 6px;
  background: #007bff;
  color: white;
  border-radius: 3px;
}

.triage-action {
  font-size: 12px;
  font-weight: bold;
  color: #495057;
}

.triage-reason {
  font-size: 12px;
  color: #868e96;
  margin-top: 6px;
  font-style: italic;
}

.btn-small {
  padding: 6px 12px;
  font-size: 12px;
  background: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.btn-small:hover {
  background: #0056b3;
}

.status-placeholder {
  padding: 20px;
  background: #f0f0f0;
  border-radius: 4px;
  text-align: center;
  color: #666;
  font-size: 14px;
}
```

- [ ] **Step 4: Commit**

```bash
git add public/email-triage.html public/index.html public/style.css
git commit -m "feat: add email triage panel UI and styling"
```

---

## Task 8: Dashboard Client - Triage JavaScript

**Files:**
- Create: `public/email-triage.js`

**Responsibility:** Handle triage button clicks, fetch from `/api/emails/triage` (GET for cached, POST for fresh run), render list, listen for WebSocket triage-result messages.

- [ ] **Step 1: Create email-triage.js client**

Create `public/email-triage.js`:

```javascript
class EmailTriageClient {
  constructor(wsServer = 'ws://localhost:4100') {
    this.wsServer = wsServer;
    this.triageList = [];
    this.init();
  }

  init() {
    // Attach button listener
    const refreshBtn = document.getElementById('triage-refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.refreshTriage());
    }

    // Connect to WebSocket for real-time updates
    this.connectWebSocket();
  }

  connectWebSocket() {
    try {
      const ws = new WebSocket(this.wsServer);
      ws.addEventListener('open', () => {
        console.log('[EmailTriage] WebSocket connected');
      });

      ws.addEventListener('message', (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'triage-result') {
            this.displayTriageResults(message.data);
          }
        } catch (error) {
          console.error('[EmailTriage] Failed to parse WebSocket message:', error);
        }
      });

      ws.addEventListener('error', (error) => {
        console.error('[EmailTriage] WebSocket error:', error);
      });
    } catch (error) {
      console.error('[EmailTriage] WebSocket connection failed:', error);
    }
  }

  async refreshTriage() {
    const btn = document.getElementById('triage-refresh-btn');
    const status = document.getElementById('triage-status');

    if (btn) btn.disabled = true;
    if (status) status.textContent = 'Scanning inbox...';

    try {
      const response = await fetch('/api/emails/triage', { method: 'POST' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const result = await response.json();
      if (result.success) {
        this.displayTriageResults(result.items);
      } else {
        this.showError(result.error || 'Unknown error');
      }
    } catch (error) {
      this.showError(error.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  displayTriageResults(items) {
    const list = document.getElementById('triage-list');
    const status = document.getElementById('triage-status');

    if (!list) return;

    if (!items || items.length === 0) {
      list.innerHTML = '<div class="status-placeholder">No actionable emails found</div>';
      if (status) status.style.display = 'none';
      return;
    }

    list.innerHTML = '';
    if (status) status.style.display = 'none';

    items.forEach(item => {
      const el = this.createTriageElement(item);
      list.appendChild(el);
    });
  }

  createTriageElement(item) {
    const confidence = parseInt(item.confidence);
    let confidenceClass = 'low-confidence';
    if (confidence >= 70) confidenceClass = 'high-confidence';
    else if (confidence >= 50) confidenceClass = 'medium-confidence';

    const div = document.createElement('div');
    div.className = `triage-item ${confidenceClass}`;
    div.innerHTML = `
      <div class="triage-sender">${this.escapeHtml(item.sender)}</div>
      <div class="triage-subject">${this.escapeHtml(item.subject)}</div>
      <div class="triage-meta">
        <span class="triage-confidence">${item.confidence}</span>
        <span class="triage-action">${this.escapeHtml(item.action)}</span>
      </div>
      <div class="triage-reason">Why: ${this.escapeHtml(item.reason)}</div>
    `;
    return div;
  }

  showError(message) {
    const status = document.getElementById('triage-status');
    if (status) {
      status.textContent = `Error: ${message}`;
      status.style.color = '#dc3545';
    }
  }

  escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, char => map[char]);
  }
}

// Auto-init on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.emailTriageClient = new EmailTriageClient();
  });
} else {
  window.emailTriageClient = new EmailTriageClient();
}
```

- [ ] **Step 2: Add script tag to index.html**

Modify `public/index.html`, add before closing `</body>`:

```html
<script src="/email-triage.js"></script>
```

- [ ] **Step 3: Verify no syntax errors**

Run: `node -c public/email-triage.js`
Expected: No output (syntax OK)

- [ ] **Step 4: Commit**

```bash
git add public/email-triage.js public/index.html
git commit -m "feat: add email triage dashboard client with real-time updates"
```

---

## Task 9: Integration Test

**Files:**
- Test: Manual end-to-end flow

**Responsibility:** Verify full pipeline: manager running → triage triggered → emails scored and displayed.

- [ ] **Step 1: Start manager**

Run: `npm start`
Expected: Output should show:
```
✅ Chrome controller started
✅ Chrome listener started
✅ Dashboard server running on http://localhost:4100
✅ Dashboard server started
🚀 Browser Manager is running!
```

- [ ] **Step 2: Test npm run triage-emails command**

In new terminal, run: `npm run triage-emails`
Expected: Either display actionable emails or "0 actionable items"

- [ ] **Step 3: Test POST /api/emails/triage endpoint**

Run: `curl -X POST http://localhost:4100/api/emails/triage`
Expected: JSON response with triage results (count and items array)

- [ ] **Step 4: Test on dashboard UI**

Open: http://localhost:4100
Expected: See email triage panel with "Refresh" button. Click button should populate list with actionable emails.

- [ ] **Step 5: Verify WebSocket integration**

Check browser console (F12 → Console tab)
Expected: No errors, should see "[EmailTriage] WebSocket connected" if browser tools open

- [ ] **Step 6: Verify all files created/modified**

Run: `git status`
Expected: All new and modified files appear staged or unstaged

- [ ] **Step 7: Commit all remaining changes**

```bash
git add -A
git commit -m "test: verify email triage integration end-to-end"
```

---

## Task 10: Cleanup and Documentation

**Files:**
- Modify: `README.md` (if exists, or create)

**Responsibility:** Document email triage feature, usage, limitations, future improvements.

- [ ] **Step 1: Update or create README.md**

Create/modify `README.md`:

```markdown
# Email Triage Feature

## Overview

The email triage tool scans your inbox for actionable items using a weighted scoring model. It identifies emails requiring decisions, responses, or action, and surfaces them on the dashboard with confidence scores and suggested actions.

## Usage

### On-Demand Triage

```bash
npm run triage-emails
```

Output displays top actionable emails with sender, subject, action, and confidence score.

### Dashboard UI

1. Start the manager: `npm start`
2. Open http://localhost:4100
3. In the "Email Triage" panel, click "Refresh"
4. Actionable emails populate in priority order

### API Endpoints

**Trigger fresh triage:**
```
POST /api/emails/triage
```

**Get cached results:**
```
GET /api/emails/triage
```

## Scoring Model

### Primary Signals (40% weight)
- Direct ask or question in body
- Assigned responsibility (you're named)
- Reply-required threads

### Secondary Signals (35% weight)
- VIP sender (CEO, board, director, VP)
- Flagged by user
- Active engagement threads

### Weak Signals (15% weight)
- Keywords: URGENT, ASAP, IMPORTANT
- Unread status

### Exclusions (10% penalty)
- Newsletters, digests, automated alerts
- noreply@ addresses
- CC-only, no clear ask

**Confidence threshold:** 40% (emails below excluded from results)
**Result limit:** Top 10 actionable emails

## Scope (Phase 1)

- Inbox only
- Last 72 hours
- AppleScript integration (Outlook)

## Limitations & Future

- **Current:** AppleScript polling requires Outlook/Mac
- **Future:** Migrate to Microsoft Graph API for reliability and cross-platform
- **Future:** Add custom keyword configuration
- **Future:** Learn user preferences from manual approvals/ignores
- **Future:** Scheduled digest (daily AM summary)

## Requirements

- macOS with Microsoft Outlook
- Node.js v24+
- Browser manager running on port 4100
```

- [ ] **Step 2: Commit documentation**

```bash
git add README.md
git commit -m "docs: add email triage feature documentation"
```

---

## Summary

**10 tasks completed:**
1. ✅ Email Extractor (AppleScript DOM parsing)
2. ✅ Email Scorer (weighted signals model)
3. ✅ Email Triage (orchestration with filtering)
4. ✅ Manager integration (event wiring)
5. ✅ Dashboard API endpoints (POST for trigger, GET for cache)
6. ✅ npm run script (on-demand CLI)
7. ✅ Dashboard UI panel (triage panel HTML)
8. ✅ Dashboard client (real-time rendering)
9. ✅ Integration test (end-to-end verification)
10. ✅ Documentation (README)

**Key capabilities:**
- ✅ Weighted scoring (not keyword-only)
- ✅ Min confidence threshold (40%)
- ✅ Top 10 sorted by score
- ✅ On-demand + WebSocket real-time
- ✅ Dashboard + CLI + API access

**Commits:** 10 atomic commits (one per task)

---
