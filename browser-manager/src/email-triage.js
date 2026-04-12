const { EventEmitter } = require('events');

class EmailTriage extends EventEmitter {
  constructor(extractor, scorer, options = {}) {
    super();
    this.extractor = extractor;
    this.scorer = scorer;
    this.lastTriageResult = [];
    this.minScore = Number(options.minScore || process.env.TRIAGE_MIN_SCORE || 20);
    this.maxItems = Number(options.maxItems || process.env.TRIAGE_MAX_ITEMS || 20);
    this.lastRunMeta = {
      totalExtracted: 0,
      actionableCount: 0,
      minScore: this.minScore,
      maxItems: this.maxItems
    };
  }

  async run() {
    try {
      // Extract emails
      const emails = await this.extractor.getInboxEmails();
      console.log(`[EmailTriage] Extracted ${emails.length} emails`);

      // Score each email
      const scored = emails.map(email => this.scorer.score(email));

      // Filter by configured confidence threshold.
      const actionable = scored.filter((result) => result.score >= this.minScore);

      // Sort by score descending
      actionable.sort((a, b) => b.score - a.score);

      // Configurable max size.
      const topItems = actionable.slice(0, this.maxItems);

      // Store result
      this.lastTriageResult = topItems;
      this.lastRunMeta = {
        totalExtracted: emails.length,
        actionableCount: actionable.length,
        minScore: this.minScore,
        maxItems: this.maxItems
      };

      // Emit event
      this.emit('triage-complete', {
        timestamp: new Date().toISOString(),
        totalExtracted: emails.length,
        actionableCount: actionable.length,
        minScore: this.minScore,
        topItems
      });

      console.log(`[EmailTriage] Scored: ${actionable.length} actionable items, top ${topItems.length} returned`);
      return topItems;
    } catch (error) {
      console.error('[EmailTriage] Error during triage:', error.message);
      this.emit('triage-error', { error: error.message });
      return [];
    }
  }

  getLastResult() {
    return this.lastTriageResult;
  }

  getLastRunMeta() {
    return this.lastRunMeta;
  }
}

module.exports = EmailTriage;
