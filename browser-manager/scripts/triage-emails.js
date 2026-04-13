const http = require('http');

const options = {
  hostname: 'localhost',
  port: Number(process.env.DASHBOARD_PORT || 4100),
  path: '/api/emails/triage',
  method: 'POST'
};

const req = http.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    if (res.statusCode !== 200) {
      console.error(data || `Request failed with status ${res.statusCode}`);
      process.exit(1);
      return;
    }

    const payload = JSON.parse(data);
    const items = payload.items || [];

    console.log(`\nEmail triage results (${items.length} actionable)\n`);
    items.forEach((item, idx) => {
      console.log(`${idx + 1}. [${item.confidence}] ${item.sender}`);
      console.log(`   Subject: ${item.subject}`);
      console.log(`   Action: ${item.action}`);
      if (item.openUrl) {
        console.log(`   Open: ${item.openUrl}`);
      }
      console.log(`   Why: ${item.reason}\n`);
    });
  });
});

req.on('error', (error) => {
  console.error('Failed to connect to dashboard. Is npm start running?');
  console.error(error.message);
  process.exit(1);
});

req.end();
