const { buildSettingsUpdates } = require('../dashboard');

test('buildSettingsUpdates maps known settings fields', () => {
  const updates = buildSettingsUpdates({
    emailProvider: 'graph',
    graphClientId: ' client-id ',
    graphTenantId: '',
    minScore: '35',
    vipSenders: 'ceo@, vp@'
  });

  expect(updates).toEqual({
    emailProvider: 'graph',
    graphClientId: 'client-id',
    graphTenantId: 'organizations',
    minScore: 35,
    vipSenders: ['ceo@', 'vp@']
  });
});

test('buildSettingsUpdates merges custom extra settings keys', () => {
  const updates = buildSettingsUpdates({
    minScore: 40,
    extraSettings: {
      graphScopes: ['Mail.Read', 'User.Read'],
      graphAuthorityHost: 'https://login.microsoftonline.com',
      mailboxFolder: 'Inbox'
    }
  });

  expect(updates).toEqual({
    minScore: 40,
    graphScopes: ['Mail.Read', 'User.Read'],
    graphAuthorityHost: 'https://login.microsoftonline.com',
    mailboxFolder: 'Inbox'
  });
});

test('buildSettingsUpdates ignores invalid extra settings payloads', () => {
  const updates = buildSettingsUpdates({
    emailProvider: 'auto',
    extraSettings: 'not-an-object'
  });

  expect(updates).toEqual({ emailProvider: 'auto' });
});