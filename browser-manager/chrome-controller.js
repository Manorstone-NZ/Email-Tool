class ChromeController {
  constructor() {
    this.isRunning = false;
    this.currentURL = null;
  }

  async start() {
    this.isRunning = true;
    this.currentURL = 'about:blank';
    return {
      success: true,
      message: 'Chrome controller started'
    };
  }

  async navigateTo(url) {
    if (!this.isRunning) {
      return {
        success: false,
        error: 'Chrome controller not running'
      };
    }
    this.currentURL = url;
    return {
      success: true,
      url: this.currentURL,
      message: `Navigated to ${url}`
    };
  }

  getCurrentURL() {
    return this.currentURL;
  }

  async stop() {
    this.isRunning = false;
    this.currentURL = null;
    return {
      success: true,
      message: 'Chrome controller stopped'
    };
  }
}

module.exports = ChromeController;
