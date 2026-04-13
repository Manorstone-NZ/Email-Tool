const { ensureSendable, computeContentHash } = require('../src/approval-service');

test('allows send when version and hash match approval', () => {
  const draft = {
    status: 'approved',
    version: 3,
    approvedVersion: 3,
    subject: 'Re: Subject',
    body: 'Thanks for the update.',
  };
  draft.approvedContentHash = computeContentHash(draft.subject, draft.body);

  expect(() => ensureSendable(draft)).not.toThrow();
});

test('blocks send when draft changed after approval', () => {
  const draft = {
    status: 'approved',
    version: 4,
    approvedVersion: 3,
    subject: 'Re: Subject',
    body: 'Changed body',
    approvedContentHash: computeContentHash('Re: Subject', 'Old body'),
  };

  expect(() => ensureSendable(draft)).toThrow(/re-approved/i);
});

test('blocks send when hash mismatches approved content', () => {
  const draft = {
    status: 'approved',
    version: 2,
    approvedVersion: 2,
    subject: 'Re: Subject',
    body: 'Modified body after hash',
    approvedContentHash: computeContentHash('Re: Subject', 'Original body'),
  };

  expect(() => ensureSendable(draft)).toThrow(/hash mismatch/i);
});
