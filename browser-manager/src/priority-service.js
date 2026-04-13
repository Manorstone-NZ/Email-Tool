const ClaudeProvider = require('./ai-claude-provider');
const LmStudioProvider = require('./ai-lmstudio-provider');

const VALID_PRIORITIES = new Set(['respond-now', 'respond-today', 'review-later', 'ignore']);
const VALID_CATEGORIES = new Set(['Needs Reply', 'Waiting on Others', 'FYI']);

function isPriorityReplyRecommended(priority) {
  return priority === 'respond-now' || priority === 'respond-today';
}

function validatePriorityResult(obj, providerUsed) {
  const priority = String(obj?.priority || '').toLowerCase().trim();
  if (!VALID_PRIORITIES.has(priority)) {
    throw new Error(`Invalid priority value: ${priority || '<empty>'}`);
  }

  const category = String(obj?.category || '').trim();
  if (!VALID_CATEGORIES.has(category)) {
    throw new Error(`Invalid category value: ${category || '<empty>'}`);
  }

  const reason = String(obj?.reason || '').trim();
  if (!reason) {
    throw new Error('Missing reason from model output');
  }

  const draftTone = String(obj?.draftTone || 'professional-direct').trim() || 'professional-direct';
  const confidenceNum = Number(obj?.confidence);
  const confidence = Number.isFinite(confidenceNum)
    ? Math.max(0, Math.min(1, confidenceNum))
    : 0.5;

  return {
    available: true,
    priority,
    category,
    reason,
    draftTone,
    confidence,
    providerUsed,
    responseRecommended: isPriorityReplyRecommended(priority),
  };
}

class PriorityService {
  constructor(options = {}) {
    this.primary = options.primaryProvider || new ClaudeProvider({
      model: options.claudeModel,
    });
    this.fallback = options.fallbackProvider || new LmStudioProvider({
      model: options.gemmaModel,
    });
    this.eventLogger = options.eventLogger || null;
  }

  buildPrompts(email, baseline) {
    const safeEmail = email && typeof email === 'object' ? email : {};
    const safeBaseline = baseline && typeof baseline === 'object' ? baseline : {};

    const systemPrompt = [
      'You are an email triage classifier.',
      'Return JSON only with fields: priority, category, reason, draftTone, confidence.',
      'Valid priorities: respond-now, respond-today, review-later, ignore.',
      'Valid categories: Needs Reply, Waiting on Others, FYI.',
      'confidence must be a decimal between 0 and 1.',
      'Never include markdown or prose outside JSON.',
    ].join(' ');

    const userPrompt = JSON.stringify({
      task: 'Classify whether this email needs a human response and urgency.',
      baseline: {
        score: safeBaseline.score,
        action: safeBaseline.action,
        reason: safeBaseline.reason,
      },
      email: {
        sender: safeEmail.sender,
        subject: safeEmail.subject,
        body: safeEmail.body,
        timestamp: safeEmail.timestamp,
        read: safeEmail.read,
        flagged: safeEmail.flagged,
      },
    });

    return { systemPrompt, userPrompt };
  }

  async prioritize(email, baseline) {
    const { systemPrompt, userPrompt } = this.buildPrompts(email, baseline);

    try {
      const primaryObj = await this.primary.completeJson(systemPrompt, userPrompt);
      const validPrimary = validatePriorityResult(primaryObj, this.primary.name);
      return validPrimary;
    } catch (primaryError) {
      if (this.eventLogger) {
        this.eventLogger.logAutomationEvent('email-priority-primary-failed', {
          provider: this.primary.name,
          error: primaryError.message,
        });
      }
    }

    try {
      const fallbackObj = await this.fallback.completeJson(systemPrompt, userPrompt);
      const validFallback = validatePriorityResult(fallbackObj, this.fallback.name);
      return validFallback;
    } catch (fallbackError) {
      if (this.eventLogger) {
        this.eventLogger.logAutomationEvent('email-priority-fallback-failed', {
          provider: this.fallback.name,
          error: fallbackError.message,
        });
      }
      return {
        available: false,
        priority: null,
        category: null,
        reason: 'AI priority unavailable',
        draftTone: null,
        confidence: null,
        providerUsed: null,
        responseRecommended: false,
      };
    }
  }
}

module.exports = {
  PriorityService,
  isPriorityReplyRecommended,
};
