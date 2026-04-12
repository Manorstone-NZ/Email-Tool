const EmailTriage = require('../src/email-triage');
const EmailExtractor = require('../src/email-extractor');
const EmailScorer = require('../src/email-scorer');

describe('EmailTriage', () => {
  let triage;
  let mockExtractor;
  let mockScorer;

  beforeEach(() => {
    mockExtractor = new EmailExtractor();
    mockScorer = new EmailScorer();
    triage = new EmailTriage(mockExtractor, mockScorer);
  });

  test('run should score and filter emails', async () => {
    // Mock extractor
    mockExtractor.getInboxEmails = jest.fn().mockResolvedValue([
      {
        sender: 'alice@company.com',
        subject: 'Budget Approval Needed',
        body: 'Can you approve the Q2 budget?',
        flagged: true,
        read: false,
        timestamp: new Date().toISOString(),
        threadId: 'thread_1'
      },
      {
        sender: 'newsletter@example.com',
        subject: 'Weekly Digest',
        body: 'Here are this week\'s stories',
        flagged: false,
        read: true,
        timestamp: new Date().toISOString(),
        threadId: 'thread_2'
      }
    ]);

    const results = await triage.run();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeLessThanOrEqual(10);
    expect(results[0].score).toBeGreaterThanOrEqual(40); // Min confidence
  });

  test('run should sort by score descending', async () => {
    mockExtractor.getInboxEmails = jest.fn().mockResolvedValue([
      {
        sender: 'bob@example.com',
        subject: 'Low Priority',
        body: 'Just FYI',
        flagged: false,
        read: true,
        timestamp: new Date().toISOString(),
        threadId: 'thread_1'
      },
      {
        sender: 'ceo@company.com',
        subject: 'Urgent Decision',
        body: 'I need your approval on this. Can you decide by EOD?',
        flagged: true,
        read: false,
        timestamp: new Date().toISOString(),
        threadId: 'thread_2'
      }
    ]);

    const results = await triage.run();
    if (results.length > 1) {
      expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
    }
  });

  test('run should use configurable minimum score threshold', async () => {
    triage = new EmailTriage(mockExtractor, mockScorer, { minScore: 35 });

    mockExtractor.getInboxEmails = jest.fn().mockResolvedValue([
      { sender: 'a@b.com', subject: 'one', body: 'x', flagged: false, read: true, timestamp: new Date().toISOString(), threadId: '1' }
    ]);
    mockScorer.score = jest.fn().mockReturnValue({
      email: { sender: 'a@b.com', subject: 'one', body: 'x', openUrl: 'https://outlook.office.com/mail/search?q=one' },
      score: 36,
      action: 'Review Later',
      reason: 'Direct ask for action',
      signals: { primary: 20, secondary: 10, weak: 6, exclusion: 0 }
    });

    const results = await triage.run();
    expect(results.length).toBe(1);
    expect(results[0].score).toBe(36);
  });
});
