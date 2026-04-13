'use strict';

const CANONICAL_CATEGORIES = ['todo', 'fyi', 'to_follow_up', 'notification', 'marketing'];

function _noreplyFrom(email) {
  if (!email) return false;
  const local = email.split('@')[0].toLowerCase();
  return local === 'noreply' || local === 'no-reply' || local === 'info' || local.startsWith('noreply') || local.startsWith('no-reply');
}

function _extractDomain(email) {
  if (!email || typeof email !== 'string') return null;
  const parts = email.split('@');
  return parts.length === 2 ? parts[1].toLowerCase() : null;
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

  const senderEmail = (email.senderEmail || '').toLowerCase();
  const subject = (email.subject || '').toLowerCase();
  const customRules = settings.customRules || [];
  const topicLabels = settings.topicLabels || [];
  const categorySettings = settings.categories || {};

  for (const rule of customRules) {
    if (!rule.enabled) continue;

    let matched = false;
    if (rule.type === 'sender_email' && senderEmail === rule.value.toLowerCase()) {
      matched = true;
    } else if (rule.type === 'sender_domain') {
      const domain = _extractDomain(senderEmail);
      if (domain === rule.value.toLowerCase()) matched = true;
    } else if (rule.type === 'subject_contains' && subject.includes(rule.value.toLowerCase())) {
      matched = true;
    } else if (rule.type === 'subject_exact' && subject === rule.value.toLowerCase()) {
      matched = true;
    }

    if (matched) {
      if (rule.action === 'skip_automation') {
        const reasons = [`Matched custom rule: ${rule.type}=${rule.value}`];
        return {
          category: 'fyi',
          skipAutomation: true,
          source: 'custom_rule',
          confidence: 1.0,
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

  if (email.isReply) {
    return _defaultDecision('to_follow_up', 1.0, 'reply_transition', ['Email is a reply'], false);
  }

  if (settings.topicLabelsGloballyEnabled !== false) {
    for (const label of topicLabels) {
      if (!label.enabled) continue;
      const catSettings = categorySettings[label.mapsToCategory] || {};
      if (catSettings.topicLabelsEnabled === false) continue;

      for (const pattern of (label.patterns || [])) {
        if (subject.includes(pattern.toLowerCase()) || (email.preview && email.preview.toLowerCase().includes(pattern.toLowerCase()))) {
          const reasons = [`Matched topic label "${label.key}": pattern "${pattern}"`];
          return {
            category: label.mapsToCategory,
            skipAutomation: false,
            source: 'topic_label',
            confidence: 0.85,
            matchedTopicLabel: label.key,
            reasons,
          };
        }
      }
    }
  }

  if (email.isNotification) {
    return _defaultDecision('notification', 0.75, 'heuristic', ['Email marked as auto-generated notification'], false);
  }

  if (_noreplyFrom(senderEmail)) {
    return _defaultDecision('fyi', 0.7, 'heuristic', ['Sender is noreply/info account'], false);
  }

  return _defaultDecision('fyi', 0.5, 'heuristic', ['No matching rule, transition, or label; default to fyi'], false);
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
