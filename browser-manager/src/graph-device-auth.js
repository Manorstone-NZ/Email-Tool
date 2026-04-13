const DEVICE_CODE_ENDPOINT = 'https://login.microsoftonline.com';

function formEncode(payload) {
  return new URLSearchParams(payload).toString();
}

async function requestDeviceCode(options = {}) {
  const tenantId = options.tenantId || 'organizations';
  const clientId = options.clientId || '';
  const scope = options.scope || 'offline_access openid profile User.Read Mail.ReadWrite Mail.Send';
  const fetchImpl = options.fetchImpl || fetch;

  if (!clientId) {
    throw new Error('GRAPH_CLIENT_ID is required');
  }

  const url = `${DEVICE_CODE_ENDPOINT}/${tenantId}/oauth2/v2.0/devicecode`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: formEncode({
      client_id: clientId,
      scope
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error_description || 'Failed to request device code');
  }

  return payload;
}

async function pollForToken(options = {}) {
  const tenantId = options.tenantId || 'organizations';
  const clientId = options.clientId || '';
  const deviceCode = options.deviceCode || '';
  const interval = Number(options.interval || 5);
  const expiresIn = Number(options.expiresIn || 900);
  const fetchImpl = options.fetchImpl || fetch;
  const sleepFn = options.sleepFn || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  if (!clientId) {
    throw new Error('GRAPH_CLIENT_ID is required');
  }
  if (!deviceCode) {
    throw new Error('deviceCode is required');
  }

  const start = Date.now();
  const timeoutMs = expiresIn * 1000;
  const url = `${DEVICE_CODE_ENDPOINT}/${tenantId}/oauth2/v2.0/token`;

  while (Date.now() - start < timeoutMs) {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formEncode({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: clientId,
        device_code: deviceCode
      })
    });

    const payload = await response.json();

    if (response.ok && payload.access_token) {
      return payload;
    }

    const errorCode = payload.error || '';
    if (errorCode === 'authorization_pending') {
      await sleepFn(interval * 1000);
      continue;
    }

    if (errorCode === 'slow_down') {
      await sleepFn((interval + 2) * 1000);
      continue;
    }

    if (errorCode === 'authorization_declined') {
      throw new Error('Authorization was declined');
    }

    if (errorCode === 'expired_token') {
      throw new Error('Device code expired before authorization completed');
    }

    throw new Error(payload.error_description || 'Token request failed');
  }

  throw new Error('Timed out waiting for device authorization');
}

module.exports = {
  requestDeviceCode,
  pollForToken
};
