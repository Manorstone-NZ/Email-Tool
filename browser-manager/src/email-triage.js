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
