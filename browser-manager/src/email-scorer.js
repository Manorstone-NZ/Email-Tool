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
      score += 6;
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
