# Browser Manager

A persistent Chrome browser manager with automation sync and event dashboard.

## Features

- **Chrome Controller**: Manage Chrome browser instances
- **Event Logger**: Log automation and user events
- **Chrome Listener**: Poll Chrome state and status
- **Dashboard Server**: Real-time event visualization with WebSocket support
- **Email Triage**: Actionability scoring with prioritized recommendations
- **Responsive UI**: Modern dashboard with live updates

## Setup

### Prerequisites

- Node.js >= 14.0.0
- npm >= 6.0.0

### Installation

```bash
cd ~/browser-manager
npm install
```

## Usage

### Start the Manager

```bash
npm start
```

or

```bash
npm run dev
```

This will:
1. Initialize Chrome controller
2. Start Chrome listener polling
3. Launch dashboard server on http://localhost:4100

By default, the manager keeps the entire 3000 block (3000-3999) clear.
You can override the dashboard port with `DASHBOARD_PORT`, as long as the value is outside 3000-3999.

Example:
```bash
DASHBOARD_PORT=4101 npm start
```

### Access the Dashboard

Open your browser and navigate to:
```
http://localhost:4100
```

The dashboard displays:
- Real-time event feed
- Event statistics (automation vs. user events)
- Connection status
- Clear events functionality

### Portal Routes

Use hash routes to switch between portal views:

```text
http://localhost:4100/#email
http://localhost:4100/#logs
http://localhost:4100/#settings
```

- `#email` - Email triage view with Gmail-style cards, pin/done actions, and category/state/tag filters
- `#logs` - Real-time event logs with search, type/time window filters, and live/paused mode
- `#settings` - Settings panel for email provider, Graph credentials, `minScore`, and VIP senders

Default route when app loads is `#email`. Unknown routes silently redirect to `#email`.

To run with Microsoft Graph provider:

```bash
EMAIL_PROVIDER=graph npm start
```

Settings currently supported in the portal:

- `emailProvider`: `auto` (default), `chrome`, `graph`
- `graphClientId`, `graphTenantId`: used for Graph auth
- `minScore`: score threshold (default `20%`)
- `vipSenders`: comma-separated list of high-priority email addresses

### Run Email Triage (On Demand)

```bash
npm run triage-emails
```

This triggers a fresh inbox scan and prints prioritized actionable items.

Phase 1 scope:
- Inbox only
- Last 72 hours (plus flagged items if present in extracted results)
- Weighted confidence scoring with explicit reason and suggested action

The dashboard also includes an "Email Triage" panel with a "Refresh Triage" button.

### Configure VIP Whitelist

VIP sender scoring can be configured in [config/vip-senders.json](config/vip-senders.json).

You can also add senders at runtime with:

```bash
VIP_SENDERS="founder@startup.com,chair@board.org" npm start
```

The runtime list is merged with defaults.

### Graph API Provider (Phase 2 Path)

The triage pipeline now supports provider selection while keeping the same dashboard/API response contract.

Default provider:
- Chrome Outlook Web scraper

Graph provider activation:

```bash
EMAIL_PROVIDER=graph GRAPH_ACCESS_TOKEN="<token>" npm start
```

Device-code login (no manual token paste):

```bash
GRAPH_CLIENT_ID="<app-client-id>" npm run graph-auth
EMAIL_PROVIDER=graph npm start
```

This stores the access token in `config/graph-token.json`, and Graph mode will auto-use it.

Optional Graph settings:
- GRAPH_USER (default: me)
- GRAPH_BASE_URL (default: https://graph.microsoft.com/v1.0)
- GRAPH_MAX_ITEMS (default: 50)

### Stop the Manager

Press `Ctrl+C` in the terminal to gracefully shut down all services.

## Architecture

### Core Modules

#### EventLogger (`event-logger.js`)
Centralized event logging system with methods:
- `logAutomationEvent(action, details)`: Log automation events
- `logUserEvent(action, details)`: Log user events
- `getEvents()`: Retrieve all logged events
- `clear()`: Clear all events

#### ChromeController (`chrome-controller.js`)
Manages Chrome browser lifecycle:
- `start()`: Initialize Chrome controller
- `navigateTo(url)`: Navigate to a URL
- `getCurrentURL()`: Get current URL
- `stop()`: Shut down Chrome controller

#### ChromeListener (`chrome-listener.js`)
Monitors Chrome state via polling:
- `start()`: Begin polling Chrome state
- `stop()`: Stop polling
- `_poll()`: Internal polling mechanism (1-second intervals)

#### DashboardServer (`dashboard.js`)
Express.js server with WebSocket support:
- REST API: `/api/events` - Get all events as JSON
- REST API: `/api/emails/triage` - Trigger triage (POST) or fetch cached results (GET)
- WebSocket: Real-time event streaming
- Static file serving: HTML/CSS/JS dashboard

#### Dashboard UI
- `public/index.html`: Dashboard interface
- `public/style.css`: Styling with responsive design
- `public/app.js`: Client-side WebSocket management

#### BrowserManager (`manager.js`)
Orchestrates all components:
- Singleton instance managing all services
- Startup/shutdown coordination
- SIGINT handler for graceful shutdown

## API Reference

### REST Endpoints

#### GET /api/events
Returns all logged events.

**Response:**
```json
{
  "events": [
    {
      "type": "automation|user",
      "timestamp": "2026-04-12T10:30:45.123Z",
      "action": "string",
      "details": {}
    }
  ]
}
```

#### POST /api/emails/triage
Runs a fresh email triage pass and returns actionable items.

**Response:**
```json
{
  "success": true,
  "count": 2,
  "items": [
    {
      "sender": "ceo@company.com",
      "subject": "Q2 Budget Approval",
      "body": "Can you approve by EOD...",
      "score": 78,
      "confidence": "78%",
      "action": "Approve / Decide",
      "reason": "Direct ask for action • VIP sender"
    }
  ]
}
```

#### GET /api/emails/triage
Returns the last triage result without running a new scan.

### WebSocket Messages

#### Client → Server

**Query Events:**
```json
{
  "type": "query-events"
}
```

#### Server → Client

**Events Response:**
```json
{
  "type": "events",
  "events": [...]
}
```

**Triage Result Push:**
```json
{
  "type": "triage-result",
  "data": [...],
  "timestamp": "2026-04-12T10:30:45.123Z"
}
```

## Project Structure

```
browser-manager/
├── package.json              # Project dependencies
├── .gitignore                # Git ignore rules
├── README.md                 # Documentation
├── manager.js                # Main orchestrator
├── event-logger.js           # Event logging
├── chrome-controller.js       # Chrome management
├── chrome-listener.js        # Chrome polling
├── dashboard.js              # Express server
├── public/
│   ├── index.html            # Dashboard HTML
│   ├── style.css             # Dashboard styles
│   └── app.js                # Dashboard client
├── scripts/
│   └── triage-emails.js      # On-demand triage CLI
├── src/
│   ├── email-extractor.js    # Outlook extraction
│   ├── email-scorer.js       # Weighted scoring model
│   └── email-triage.js       # Triage orchestration
├── tests/
│   ├── email-extractor.test.js
│   ├── email-scorer.test.js
│   └── email-triage.test.js
└── node_modules/             # Dependencies (generated)
```

## Development

### File Structure

- Each module has a single responsibility
- Event Logger is the central truth for all events
- Chrome Controller manages browser state
- Chrome Listener observes state changes
- Dashboard broadcasts events in real-time

### Adding Features

1. Create a new event in EventLogger
2. Log via `logAutomationEvent()` or `logUserEvent()`
3. Events automatically appear in dashboard

## Roadmap

- [ ] Actual Chrome DevTools Protocol integration
- [ ] Multiple browser instance support
- [ ] Event filtering and search
- [ ] Performance metrics dashboard
- [ ] Event export (JSON, CSV)
- [ ] Authentication and authorization
- [ ] Persistent event storage (database)
- [ ] Event replay functionality
- [ ] Advanced automation scripting
- [ ] Mobile dashboard support

## Troubleshooting

### Dashboard not loading
- Check that the server is running: `npm start`
- Verify port 4100 is accessible
- Check browser console for errors

### WebSocket connection failing
- Ensure your firewall allows WebSocket connections
- Try refreshing the page
- Check server logs for connection errors

### Events not appearing
- Verify Chrome controller is running
- Check that Chrome listener is polling
- Look for errors in server logs

## License

MIT

## Contributing

Contributions welcome! Fork, modify, and submit pull requests.
