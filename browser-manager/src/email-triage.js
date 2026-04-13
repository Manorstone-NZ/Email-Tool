const { EventEmitter } = require('events');

function normalizeCategorizationSettings(categorizationSettings) {
  if (categorizationSettings && typeof categorizationSettings.getSettings === 'function') {
    return categorizationSettings;
  }

  const settings = categorizationSettings && typeof categorizationSettings === 'object'
    ? categorizationSettings
    : {};

  return {
    getSettings() {
      return settings;
    },
  };
}

class EmailTriage extends EventEmitter {
  constructor(graphAPI, mailActionService, categorizationSettings, folderCache) {
    super();
    this.graphAPI = graphAPI;
    this.mailActionService = mailActionService;
    this.categorizationSettings = normalizeCategorizationSettings(categorizationSettings);
    this.folderCache = folderCache;
    this.lastTriageResult = [];
    this.lastRunMeta = {
      totalExtracted: 0,
      minScore: null,
      error: null,
    };
  }

  setCategorizationSettings(categorizationSettings) {
    this.categorizationSettings = normalizeCategorizationSettings(categorizationSettings);
  }

  getLastResult() {
    return this.lastTriageResult;
  }

  getLastRunMeta() {
    return this.lastRunMeta;
  }

  async run(onlyMailbox, options = {}) {
    const settings = this.categorizationSettings?.getSettings?.() || {};
    const categorize = require('./email-categorizer');
    const score = require('./email-scorer');
    const parsedMinScore = Number(options.minScore);
    const effectiveMinScore = Number.isFinite(parsedMinScore) ? parsedMinScore : 20;

    // If no categorizer, fallback to direct scorer (legacy mode)
    const useCategorizer = Boolean(categorize && settings);

    let emails;
    try {
      if (
        this.graphAPI
        && this.graphAPI.providerName === 'graph'
        && typeof this.graphAPI.getAccessToken === 'function'
        && !this.graphAPI.getAccessToken()
      ) {
        throw new Error('Graph access token is missing or expired. Run: npm run graph-auth');
      }

      const fetchEmails = this.graphAPI && (
        this.graphAPI.getEmails
        || this.graphAPI.getInboxEmails
      );

      if (typeof fetchEmails !== 'function') {
        throw new Error('Email provider does not implement getEmails/getInboxEmails');
      }

      emails = await fetchEmails.call(this.graphAPI, onlyMailbox);
    } catch (error) {
      console.error('[EmailTriage.run] Failed to fetch emails:', error.message);
      this.emit('triage-error', { error: error.message });
      this.lastRunMeta = {
        totalExtracted: 0,
        minScore: effectiveMinScore,
        error: error.message,
      };
      return [];
    }

    const triageItems = [];

    for (const email of emails) {
      let decision = null;
      let scoring = null;
      let actionResult = null;

      // Step 1: Categorise
      if (useCategorizer) {
        try {
          decision = categorize(email, settings);
        } catch (error) {
          console.warn('[EmailTriage.run] Categorisation error:', error.message);
          decision = { category: 'fyi', skipAutomation: false, source: 'heuristic', confidence: 0.5, reasons: ['Categorisation failed; defaulted to fyi'] };
        }
      }

      // Early skip: meeting requests are not actionable in this triage context
      if (decision && decision.isMeetingRequest) {
        continue;
      }

      // Step 2: Check for null category (should be rare)
      if (decision && decision.category === null) {
        console.warn('[EmailTriage.run] Email has null category; skipping scorer and actions:', email.messageId);
        // Emit null-category item
        const item = this._buildTriageItem(email, decision, null, null);
        triageItems.push(item);
        continue;
      }

      // Step 3: Score
      if (decision) {
        try {
          scoring = score(email, decision);
        } catch (error) {
          console.warn('[EmailTriage.run] Scoring error:', error.message);
          scoring = { urgency: 'low', score: 30, recommendedAction: 'Review Later', reasons: ['Scoring failed'] };
        }
      }

      // Step 4: Apply Actions
      if (decision && scoring) {
        try {
          actionResult = await this.mailActionService?.applyActions?.(email, decision, settings);
        } catch (error) {
          console.warn('[EmailTriage.run] Action service error:', error.message);
          actionResult = { category: decision.category, skipped: true, skipReason: 'action_service_error' };
        }
      }

      // Step 5: Build Triage Item
      const item = this._buildTriageItem(email, decision, scoring, actionResult);
      triageItems.push(item);
    }

    // Filter by score threshold first, then remove marketing unless explicitly included.
    const scoreFiltered = triageItems.filter((item) => {
      if (typeof item.score !== 'number') {
        return true;
      }
      return item.score >= effectiveMinScore;
    });

    const filtered = options.includeMarketing
      ? scoreFiltered
      : scoreFiltered.filter(item => item.category !== 'marketing');

    // Sort: by score descending
    filtered.sort((a, b) => (b.score || 0) - (a.score || 0));

    // Prioritise VIP senders
    const vipEmails = options.vipEmails || [];
    filtered.sort((a, b) => {
      const aIsVip = vipEmails.includes(a.sender);
      const bIsVip = vipEmails.includes(b.sender);
      if (aIsVip && !bIsVip) return -1;
      if (!aIsVip && bIsVip) return 1;
      return 0;
    });

    // Mark high-priority items for AI review
    for (const item of filtered) {
      if (item.urgency === 'high' && item.score >= 70) {
        item.markedForAiReview = true;
      }
    }

    // Emit via WebSocket
    for (const item of filtered) {
      process.nextTick(() => this.emit('triageItem', item));
    }

    this.lastTriageResult = filtered;
    this.lastRunMeta = {
      totalExtracted: emails.length,
      minScore: effectiveMinScore,
      error: null,
    };

    this.emit('triage-complete', {
      totalExtracted: emails.length,
      actionableCount: filtered.length,
      topItems: filtered.slice(0, 5).map((item) => ({
        email: item.email,
        score: item.score,
        action: item.recommendedAction,
      })),
    });

    return filtered;
  }

  _buildTriageItem(email, decision, scoring, actionResult) {
    const normalizedBody = email.body || email.fullBody || email.preview || '';
    const preview = email.preview || String(normalizedBody).slice(0, 200);
    const normalizedEmail = {
      ...email,
      sender: email.sender || email.senderEmail || '',
      body: normalizedBody,
      preview,
      category: decision?.category || null,
    };

    return {
      id: `${email.messageId}-${Date.now()}`,
      emailId: email.emailId,
      messageId: email.messageId,
      threadId: email.threadId,
      email: normalizedEmail,
      sender: email.senderEmail,
      subject: email.subject,
      preview,

      // Categorisation fields
      category: decision?.category || null,
      categorySource: decision?.source || null,
      categorizationConfidence: decision?.confidence || null,
      skipAutomation: decision?.skipAutomation || false,
      matchedTopicLabel: decision?.matchedTopicLabel || null,
      matchedRuleId: decision?.matchedRuleId || null,

      // Scoring fields
      urgency: scoring?.urgency || null,
      score: scoring?.score || null,
      recommendedAction: scoring?.recommendedAction || null,

      // Combined reasons
      reasons: [
        ...(decision?.reasons || []),
        ...(scoring?.reasons || []),
        ...(actionResult?.acted ? [`Actions applied: ${actionResult.actionsApplied.join(', ')}`] : [])
      ].slice(0, 10) // Limit to 10 reasons for UI display
    };
  }
}

module.exports = EmailTriage;
