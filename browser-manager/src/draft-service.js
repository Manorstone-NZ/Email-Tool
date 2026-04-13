const crypto = require('crypto');
const ClaudeProvider = require('./ai-claude-provider');
const LmStudioProvider = require('./ai-lmstudio-provider');
const { computeContentHash } = require('./approval-service');

function makeDraftId(emailId) {
  const nonce = crypto.randomUUID();
  return `draft-${emailId}-${nonce}`;
}

function validateDraftOutput(obj) {
  const subject = String(obj?.subject || '').trim();
  const body = String(obj?.body || '').trim();
  const draftTone = String(obj?.draftTone || 'professional-direct').trim() || 'professional-direct';
  const questions = Array.isArray(obj?.followUpQuestions)
    ? obj.followUpQuestions.map((x) => String(x).trim()).filter(Boolean)
    : [];

  if (!subject) {
    throw new Error('Draft output missing subject');
  }
  if (!body) {
    throw new Error('Draft output missing body');
  }

  return { subject, body, draftTone, followUpQuestions: questions };
}

class DraftService {
  constructor(options = {}) {
    this.primary = options.primaryProvider || new ClaudeProvider({
      model: options.claudeModel,
    });
    this.fallback = options.fallbackProvider || new LmStudioProvider({
      model: options.gemmaModel,
    });
    this.eventLogger = options.eventLogger || null;
    this.maxDraftLength = Number(options.maxDraftLength || process.env.AI_MAX_DRAFT_LENGTH || 4000);
    this.draftsByEmailId = new Map();
  }

  buildPrompts(email, priorityDecision) {
    const systemPrompt = [
      'You draft concise professional email replies.',
      'Return JSON only with fields: subject, body, draftTone, followUpQuestions.',
      'Do not invent facts or commitments not present in input.',
      'Avoid legal or pricing promises unless explicitly confirmed.',
      'Ask follow-up questions if key information is missing.',
    ].join(' ');

    const userPrompt = JSON.stringify({
      task: 'Draft a reply email for human review.',
      priorityDecision,
      email: {
        sender: email?.sender,
        subject: email?.subject,
        body: email?.body,
        timestamp: email?.timestamp,
      },
    });

    return { systemPrompt, userPrompt };
  }

  getDraft(emailId) {
    return this.draftsByEmailId.get(String(emailId)) || null;
  }

  listDrafts() {
    return Array.from(this.draftsByEmailId.values());
  }

  async generateDraft(emailId, email, priorityDecision) {
    const key = String(emailId);
    const existing = this.getDraft(key);
    const baseVersion = existing ? Number(existing.version || 0) + 1 : 1;
    const { systemPrompt, userPrompt } = this.buildPrompts(email, priorityDecision);

    let result;
    let providerUsed = null;

    try {
      const primaryObj = await this.primary.completeJson(systemPrompt, userPrompt);
      result = validateDraftOutput(primaryObj);
      providerUsed = this.primary.name;
    } catch (primaryError) {
      if (this.eventLogger) {
        this.eventLogger.logAutomationEvent('email-draft-primary-failed', {
          provider: this.primary.name,
          emailId: key,
          error: primaryError.message,
        });
      }

      try {
        const fallbackObj = await this.fallback.completeJson(systemPrompt, userPrompt);
        result = validateDraftOutput(fallbackObj);
        providerUsed = this.fallback.name;
      } catch (fallbackError) {
        if (this.eventLogger) {
          this.eventLogger.logAutomationEvent('email-draft-fallback-failed', {
            provider: this.fallback.name,
            emailId: key,
            error: fallbackError.message,
          });
        }
        throw new Error('AI draft unavailable: both providers returned invalid output');
      }
    }

    const safeBody = result.body.slice(0, this.maxDraftLength);
    const now = new Date().toISOString();
    const draft = {
      draftId: existing ? existing.draftId : makeDraftId(key),
      emailId: key,
      status: 'pending_review',
      providerUsed,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
      approvedAt: null,
      approvedBy: null,
      approvedVersion: null,
      approvedContentHash: null,
      sentAt: null,
      rejectedAt: null,
      subject: result.subject,
      body: safeBody,
      followUpQuestions: result.followUpQuestions,
      policyFlags: [],
      version: baseVersion,
    };

    this.draftsByEmailId.set(key, draft);
    return draft;
  }

  editDraft(emailId, updates) {
    const key = String(emailId);
    const draft = this.getDraft(key);
    if (!draft) {
      throw new Error('Draft not found');
    }

    const nextSubject = updates.subject !== undefined ? String(updates.subject) : draft.subject;
    const nextBody = updates.body !== undefined ? String(updates.body) : draft.body;

    const edited = {
      ...draft,
      subject: nextSubject,
      body: nextBody.slice(0, this.maxDraftLength),
      version: Number(draft.version || 0) + 1,
      updatedAt: new Date().toISOString(),
      status: 'pending_review',
      approvedAt: null,
      approvedBy: null,
      approvedVersion: null,
      approvedContentHash: null,
    };

    this.draftsByEmailId.set(key, edited);
    return edited;
  }

  approveDraft(emailId, approvedBy = 'user') {
    const key = String(emailId);
    const draft = this.getDraft(key);
    if (!draft) {
      throw new Error('Draft not found');
    }

    const approved = {
      ...draft,
      status: 'approved',
      approvedAt: new Date().toISOString(),
      approvedBy: String(approvedBy || 'user'),
      approvedVersion: draft.version,
      approvedContentHash: computeContentHash(draft.subject, draft.body),
      updatedAt: new Date().toISOString(),
    };

    this.draftsByEmailId.set(key, approved);
    return approved;
  }

  rejectDraft(emailId, reason) {
    const key = String(emailId);
    const draft = this.getDraft(key);
    if (!draft) {
      throw new Error('Draft not found');
    }

    const rejected = {
      ...draft,
      status: 'rejected',
      rejectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      rejectionReason: String(reason || '').trim(),
    };

    this.draftsByEmailId.set(key, rejected);
    return rejected;
  }

  markSent(emailId) {
    const key = String(emailId);
    const draft = this.getDraft(key);
    if (!draft) {
      throw new Error('Draft not found');
    }

    const sent = {
      ...draft,
      status: 'sent',
      sentAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.draftsByEmailId.set(key, sent);
    return sent;
  }
}

module.exports = DraftService;
