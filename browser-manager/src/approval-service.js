const crypto = require('crypto');

function computeContentHash(subject, body) {
  const raw = `${String(subject || '')}\n---\n${String(body || '')}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function ensureSendable(draft) {
  if (!draft || typeof draft !== 'object') {
    throw new Error('Draft not found');
  }

  if (draft.status !== 'approved') {
    throw new Error('Draft must be approved before sending');
  }

  if (draft.version !== draft.approvedVersion) {
    throw new Error('Draft changed after approval and must be re-approved');
  }

  const currentHash = computeContentHash(draft.subject, draft.body);
  if (draft.approvedContentHash && currentHash !== draft.approvedContentHash) {
    throw new Error('Approved content hash mismatch; re-approval required');
  }

  if (!String(draft.subject || '').trim()) {
    throw new Error('Draft subject is required');
  }
  if (!String(draft.body || '').trim()) {
    throw new Error('Draft body is required');
  }
}

module.exports = {
  ensureSendable,
  computeContentHash,
};
