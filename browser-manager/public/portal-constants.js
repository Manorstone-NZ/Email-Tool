(() => {
const ROUTES = ['email', 'logs', 'settings'];
const RECOMMENDED_ACTIONS = ['Review Later', 'Review / Respond', 'Approve / Decide', 'Review'];
const EMAIL_STATE_STORAGE_KEY = 'portal.email.state.v1';

const AVATAR_PALETTE = [
  { bg: '#e8d5c4', fg: '#8b6a4f' },
  { bg: '#c4d5e8', fg: '#4f6a8b' },
  { bg: '#d4c4e8', fg: '#6a4f8b' },
  { bg: '#c4e0d8', fg: '#3d7a65' },
  { bg: '#e8dcc4', fg: '#8b7a4f' },
  { bg: '#e8c4c4', fg: '#8b4f4f' },
];

const HEAT_GRADIENT_THRESHOLDS = [
  { min: 80, color: '#c0564a' },
  { min: 60, color: '#d4a030' },
  { min: 40, color: '#d4a574' },
  { min: 0,  color: '#e0dbd4' },
];

const PRIORITY_TIERS = [
  { key: 'act-now', label: 'Act Now', criteria: (item) => item.urgency === 'high' && (item.score || 0) >= 70 },
  { key: 'review', label: 'Review', criteria: (item) => item.urgency === 'medium' || (item.urgency === 'high' && (item.score || 0) < 70) },
  { key: 'low', label: 'Low Priority', criteria: (item) => item.urgency === 'low' || (!item.urgency) },
];

const api = {
  ROUTES,
  RECOMMENDED_ACTIONS,
  EMAIL_STATE_STORAGE_KEY,
  AVATAR_PALETTE,
  HEAT_GRADIENT_THRESHOLDS,
  PRIORITY_TIERS,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof window !== 'undefined') {
  window.PortalConstants = api;
}
})();
