const GraphTokenStore = require('../src/graph-token-store');
const { requestDeviceCode, pollForToken } = require('../src/graph-device-auth');
const { loadSettings } = require('../src/settings-store');

async function main() {
  const settings = loadSettings();
  const tenantId = process.env.GRAPH_TENANT_ID || settings.graphTenantId || 'organizations';
  const clientId = process.env.GRAPH_CLIENT_ID || settings.graphClientId || '';
  const scope = process.env.GRAPH_SCOPE || 'offline_access openid profile User.Read Mail.ReadWrite';

  if (!clientId) {
    console.error('Missing GRAPH_CLIENT_ID.');
    console.error('Example: GRAPH_CLIENT_ID="<app-client-id>" npm run graph-auth');
    process.exit(1);
  }

  try {
    const devicePayload = await requestDeviceCode({ tenantId, clientId, scope });

    console.log('\nAuthorize Graph access in your browser:\n');
    console.log(devicePayload.message || `Open ${devicePayload.verification_uri} and enter code ${devicePayload.user_code}`);

    const tokenPayload = await pollForToken({
      tenantId,
      clientId,
      deviceCode: devicePayload.device_code,
      interval: devicePayload.interval,
      expiresIn: devicePayload.expires_in
    });

    const store = new GraphTokenStore();
    const saved = store.saveToken(tokenPayload);

    console.log('\nGraph authentication successful.');
    console.log(`Token saved to config/graph-token.json (expires ${new Date(saved.expires_at).toISOString()})`);
    console.log('Use EMAIL_PROVIDER=graph npm start to run triage via Graph API.\n');
  } catch (error) {
    console.error(`Graph auth failed: ${error.message}`);
    process.exit(1);
  }
}

main();
