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
});
