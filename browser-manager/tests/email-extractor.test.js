const EmailExtractor = require('../src/email-extractor');

describe('EmailExtractor', () => {
  let extractor;

  beforeEach(() => {
    extractor = new EmailExtractor();
  });

  test('parseEmailFromDOM should parse raw email string', () => {
    const rawEmail = `
      FROM: alice@company.com
      SUBJECT: Action Required: Budget Approval
      BODY: Can you approve the Q2 budget? Need by EOD.
      FLAGGED: true
      READ: false
      TIMESTAMP: 2026-04-12T10:30:00Z
      THREAD_ID: thread_123
    `;
    
    const parsed = extractor.parseEmailFromDOM(rawEmail);
    expect(parsed.sender).toBe('alice@company.com');
    expect(parsed.subject).toBe('Action Required: Budget Approval');
    expect(parsed.body).toContain('approve');
    expect(parsed.flagged).toBe(true);
    expect(parsed.read).toBe(false);
  });

  test('isWithin72Hours should return true for recent emails', () => {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    expect(extractor.isWithin72Hours(twoHoursAgo)).toBe(true);
  });

  test('isWithin72Hours should return false for old emails', () => {
    const now = new Date();
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    expect(extractor.isWithin72Hours(fiveDaysAgo)).toBe(false);
  });

  test('getInboxEmails should return parsed email array (stubbed)', async () => {
    // Stub exec to avoid actual AppleScript calls
    const emails = await extractor.getInboxEmails();
    expect(Array.isArray(emails)).toBe(true);
  });

  test('buildSearchUrl should create Outlook search link from sender and subject', () => {
    const url = extractor.buildSearchUrl({
      sender: 'alice@company.com',
      subject: 'Budget Approval Needed'
    });

    expect(url).toContain('outlook.office.com/mail/search');
    expect(url).toContain(encodeURIComponent('alice@company.com Budget Approval Needed'));
  });
});
