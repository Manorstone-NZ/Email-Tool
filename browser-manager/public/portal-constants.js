(() => {
const ROUTES = ['email', 'logs', 'settings'];
const RECOMMENDED_ACTIONS = ['Review Later', 'Review / Respond', 'Approve / Decide', 'Review'];
const EMAIL_STATE_STORAGE_KEY = 'portal.email.state.v1';

const api = {
  ROUTES,
  RECOMMENDED_ACTIONS,
  EMAIL_STATE_STORAGE_KEY,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof window !== 'undefined') {
  window.PortalConstants = api;
}
})();
