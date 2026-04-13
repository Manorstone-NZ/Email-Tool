'use strict';

const CANONICAL_CATEGORIES = ['todo', 'fyi', 'to_follow_up', 'notification', 'marketing'];

function _normalizeText(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function _noreplyFrom(email) {
  if (!email) return false;
  const local = email.split('@')[0].toLowerCase();
  return local === 'noreply' || local === 'no-reply' || local === 'info' || local.startsWith('noreply') || local.startsWith('no-reply');
}

function _matchesRule(email, rule) {
  const senderEmail = _normalizeText(email.senderEmail);
  const senderDomain = _normalizeText(email.senderDomain);
  const subject = _normalizeText(email.subject);
  const ruleValue = _normalizeText(rule.value);

  if (rule.type === 'sender_email') {
    return senderEmail === ruleValue;
  }

  if (rule.type === 'sender_domain') {
    return senderDomain === ruleValue;
  }

  if (rule.type === 'subject_exact') {
    return subject === ruleValue;
  }

  if (rule.type === 'subject_contains') {
    return subject.includes(ruleValue);
  }

  return false;
}

function _categorizeHeuristic(email) {
  const senderEmail = _normalizeText(email.senderEmail);
  const bodyText = _normalizeText(`${email.subject || ''} ${email.preview || ''}`);

  const todoSignal = /(can you|please|approve|review|action required|need your|by eod|today)/;
  if (todoSignal.test(bodyText)) {
    return _defaultDecision('todo', 0.7, 'heuristic', ['Action-oriented language detected'], false);
  }

  if (email.isNotification) {
    return _defaultDecision('notification', 0.75, 'heuristic', ['Email marked as auto-generated notification'], false);
  }

  if (_noreplyFrom(senderEmail)) {
    return _defaultDecision('fyi', 0.7, 'heuristic', ['Sender is noreply/info account'], false);
  }

  return _defaultDecision('fyi', 0.5, 'heuristic', ['No matching rule, transition, or label; default to fyi'], false);
}

function _categorizeWithoutCustomRules(email, settings) {
  const topicLabels = settings.topicLabels || [];
  const categorySettings = settings.categories || {};
  const combinedText = _normalizeText(`${email.senderEmail || ''} ${email.subject || ''} ${email.preview || ''}`);

  let baseResult = null;

  if (settings.topicLabelsGloballyEnabled !== false) {
    for (const label of topicLabels) {
      if (!label.enabled) continue;
      const catSettings = categorySettings[label.mapsToCategory] || {};
      if (catSettings.topicLabelsEnabled === false) continue;

      for (const pattern of (label.patterns || [])) {
        if (combinedText.includes(_normalizeText(pattern))) {
          baseResult = {
            category: label.mapsToCategory,
            skipAutomation: false,
            source: 'topic_label',
            confidence: 0.85,
            matchedTopicLabel: label.key,
            reasons: [`Matched topic label "${label.key}": pattern "${pattern}"`],
          };
          break;
        }
      }

      if (baseResult) break;
    }
  }

  if (!baseResult) {
    baseResult = _categorizeHeuristic(email);
  }

  const hasUserReplyInThread = email.hasUserReplyInThread === true || email.isReply === true;
  if (hasUserReplyInThread && baseResult.category === 'todo') {
    return {
      category: 'to_follow_up',
      skipAutomation: false,
      source: 'reply_transition',
      confidence: 0.95,
      reasons: ['User has replied in thread and base category was todo'],
    };
  }

  return baseResult;
}

function categorize(email, settings) {
  if (!email || typeof email !== 'object') {
    console.warn('[email-categorizer] Invalid email object');
    return _defaultDecision('fyi', 0.5, 'heuristic', [], false);
  }

  if (!settings || typeof settings !== 'object') {
    console.warn('[email-categorizer] Invalid settings object');
    return _defaultDecision('fyi', 0.5, 'heuristic', [], false);
  }

  const customRules = settings.customRules || [];
  const naturalDecision = _categorizeWithoutCustomRules(email, settings);

  for (const rule of customRules) {
    if (!rule.enabled) continue;

    if (_matchesRule(email, rule)) {
      if (rule.action === 'skip_automation') {
        const reasons = [...(naturalDecision.reasons || []), `Matched custom rule: ${rule.type}=${rule.value}`];
        return {
          ...naturalDecision,
          skipAutomation: true,
          matchedRuleId: rule.id,
          reasons,
        };
      }
      const reasons = [`Matched custom rule: ${rule.type}=${rule.value}`];
      return {
        category: rule.action,
        skipAutomation: false,
        source: 'custom_rule',
        confidence: 1.0,
        matchedRuleId: rule.id,
        reasons,
      };
    }
  }

  return naturalDecision;
}

function _defaultDecision(category, confidence, source, reasons, skipAutomation) {
  return {
    category,
    skipAutomation: skipAutomation || false,
    source,
    confidence,
    reasons,
  };
}

module.exports = categorize;
