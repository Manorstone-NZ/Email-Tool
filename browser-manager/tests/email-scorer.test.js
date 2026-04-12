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

  test('scorePrimarySignals: could you please send should score as direct ask', () => {
    const body = 'Could you please send me the report from yesterday for record keeping.';
    const score = scorer.scorePrimarySignals({ body, subject: 'Requesting report' });
    expect(score).toBeGreaterThanOrEqual(20);
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

  test('scoreSecondarySignals: custom VIP sender list should be honored', () => {
    const customScorer = new EmailScorer({ vipSenders: ['founder@startup.com'] });
    const score = customScorer.scoreSecondarySignals({
      flagged: false,
      sender: 'founder@startup.com',
      body: 'Please review this proposal.'
    });

    expect(score).toBeGreaterThanOrEqual(15);
  });

  test('score reason should include VIP sender when custom list matches', () => {
    const customScorer = new EmailScorer({ vipSenders: ['chair@board.org'] });
    const result = customScorer.score({
      sender: 'chair@board.org',
      subject: 'Decision needed',
      body: 'Can you confirm this today?',
      flagged: false,
      read: false,
      timestamp: new Date().toISOString()
    });

    expect(result.reason).toContain('VIP sender');
  });

  test('score: actionable threshold (>=20) should not be labeled Ignore', () => {
    const result = scorer.score({
      sender: 'ops@company.com',
      subject: 'Need approval this week',
      body: 'Could you please review and approve this change request?',
      flagged: false,
      read: false,
      timestamp: new Date().toISOString()
    });

    expect(result.score).toBeGreaterThanOrEqual(20);
    expect(result.action).not.toBe('Ignore');
  });
});
