const crypto = require('crypto');
const ClaudeProvider = require('./ai-claude-provider');
const LmStudioProvider = require('./ai-lmstudio-provider');
const { computeContentHash } = require('./approval-service');

function makeDraftId(emailId) {
  const nonce = crypto.randomUUID();
  return `draft-${emailId}-${nonce}`;
}

function validateDraftOutput(obj, options = {}) {
  const allowMissingSubject = Boolean(options.allowMissingSubject);
  const source = obj && typeof obj === 'object'
    ? (obj.draft && typeof obj.draft === 'object' ? obj.draft : obj)
    : {};

  const subject = String(
    source.subject
    || source.subjectLine
    || source.subject_line
    || source.draftSubject
    || ''
  ).trim();
  const body = String(
    source.body
    || source.draftBody
    || source.emailBody
    || source.email_body
    || source.reply
    || source.message
    || source.text
    || ''
  ).trim();
  const draftTone = String(
    source.draftTone
    || source.tone
    || 'professional-direct'
  ).trim() || 'professional-direct';

  const rawQuestions = source.followUpQuestions ?? source.follow_up_questions ?? [];
  const questions = Array.isArray(rawQuestions)
    ? rawQuestions.map((x) => String(x).trim()).filter(Boolean)
    : (String(rawQuestions || '').trim() ? [String(rawQuestions).trim()] : []);

  if (!subject && !allowMissingSubject) {
    throw new Error('Draft output missing subject');
  }
  if (!body) {
    throw new Error('Draft output missing body');
  }

  return { subject, body, draftTone, followUpQuestions: questions };
}

function buildFallbackSubject(email) {
  const sourceSubject = String(email && email.subject ? email.subject : '').trim();
  if (!sourceSubject) {
    return 'Re: Follow up';
  }
  if (/^re:/i.test(sourceSubject)) {
    return sourceSubject;
  }
  return `Re: ${sourceSubject}`;
}

function buildLocalFallbackDraft(email, priorityDecision) {
  const sender = String(email && email.sender ? email.sender : '').trim();
  const subject = buildFallbackSubject(email);
  const priority = String(priorityDecision && priorityDecision.priority ? priorityDecision.priority : '').trim();
  const reasonLine = priority ? `Priority noted: ${priority}.` : 'Priority noted from inbox triage.';

  const greeting = sender ? `Hi ${sender},` : 'Hi there,';
  const body = [
    greeting,
    '',
    `Thanks for your message about "${String(email && email.subject ? email.subject : 'your request').trim() || 'your request'}".`,
    reasonLine,
    'I have received this and will follow up shortly with a complete response.',
    '',
    'Best regards,',
  ].join('\n');

  return {
    subject,
    body,
    draftTone: 'professional-direct',
    followUpQuestions: [],
  };
}

function normalizeSignature(signature) {
  return String(signature || '').replace(/\r\n/g, '\n').trim();
}

function appendSignature(body, signature) {
  const normalizedBody = String(body || '').replace(/\r\n/g, '\n').trimEnd();
  const normalizedSignature = normalizeSignature(signature);
  if (!normalizedSignature) {
    return normalizedBody;
  }
  const bodyWithoutSignature = stripTrailingSignoff(normalizedBody);
  if (normalizedBody.endsWith(normalizedSignature)) {
    return normalizedBody;
  }
  if (!bodyWithoutSignature) {
    return normalizedSignature;
  }
  return `${bodyWithoutSignature}\n\n${normalizedSignature}`;
}

function stripTrailingSignoff(body) {
  const text = String(body || '').trimEnd();
  if (!text) {
    return text;
  }

  // Remove common closing blocks so configured signature is authoritative.
  const signoffPattern = /\n\s*\n\s*(best regards|kind regards|regards|sincerely|cheers)[^\n]*\n[\s\S]*$/i;
  const stripped = text.replace(signoffPattern, '');
  return stripped.trimEnd();
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
    this.emailSignature = normalizeSignature(options.emailSignature || process.env.DRAFT_EMAIL_SIGNATURE || '');
    this.draftsByEmailId = new Map();
  }

  buildPrompts(email, priorityDecision) {
    const systemPrompt = [
      'You draft concise professional email replies.',
      'Return JSON only with fields: subject, body, draftTone, followUpQuestions.',
      'Write from the mailbox owner perspective (the recipient), never as the original sender.',
      'If the inbound email describes meetings, onsite visits, or completed work, do not claim you personally performed those actions unless explicitly stated in context.',
      'Treat names and sign-offs in the inbound email body as external parties unless explicitly identified as the mailbox owner.',
      'Do not invent facts or commitments not present in input.',
      'Avoid legal or pricing promises unless explicitly confirmed.',
      'Ask follow-up questions if key information is missing.',
    ].join(' ');

    const userPrompt = JSON.stringify({
      task: 'Draft a reply email for human review.',
      perspective: 'Mailbox owner is responding as an interested third party recipient.',
      mailboxOwnerSignature: this.emailSignature || null,
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
      result = validateDraftOutput(primaryObj, { allowMissingSubject: true });
      if (!String(result.subject || '').trim()) {
        result.subject = buildFallbackSubject(email);
      }
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
        result = validateDraftOutput(fallbackObj, { allowMissingSubject: true });
        if (!String(result.subject || '').trim()) {
          result.subject = buildFallbackSubject(email);
        }
        providerUsed = this.fallback.name;
      } catch (fallbackError) {
        if (this.eventLogger) {
          this.eventLogger.logAutomationEvent('email-draft-fallback-failed', {
            provider: this.fallback.name,
            emailId: key,
            error: fallbackError.message,
          });
        }

        result = buildLocalFallbackDraft(email, priorityDecision);
        providerUsed = 'local-fallback-template';

        if (this.eventLogger) {
          this.eventLogger.logAutomationEvent('email-draft-local-fallback-used', {
            emailId: key,
            primaryProvider: this.primary.name,
            fallbackProvider: this.fallback.name,
            primaryError: primaryError && primaryError.message ? primaryError.message : 'unknown',
            fallbackError: fallbackError && fallbackError.message ? fallbackError.message : 'unknown',
          });
        }
      }
    }

    const safeBody = appendSignature(result.body, this.emailSignature).slice(0, this.maxDraftLength);
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
