const { exec } = require('child_process');

class ChromeListener {
  constructor(chromeController, eventLogger) {
    this.chromeController = chromeController;
    this.eventLogger = eventLogger;
    this.isListening = false;
    this.pollInterval = null;
    this.pollFrequency = 1000; // 1 second
    this.lastURL = null;
    this.isPolling = false;
  }

  start() {
    if (this.isListening) {
      return {
        success: false,
        error: 'Chrome listener already running'
      };
    }
    this.isListening = true;
    this.pollInterval = setInterval(() => this._poll(), this.pollFrequency);
    return {
      success: true,
      message: 'Chrome listener started'
    };
  }

  stop() {
    if (!this.isListening) {
      return {
        success: false,
        error: 'Chrome listener not running'
      };
    }
    this.isListening = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    return {
      success: true,
      message: 'Chrome listener stopped'
    };
  }

  _poll() {
    if (!this.isListening || !this.chromeController || this.isPolling) {
      return;
    }

    this.isPolling = true;
    exec(
      "osascript -e 'tell application \"Google Chrome\" to get URL of active tab of front window'",
      (error, stdout) => {
        this.isPolling = false;
        if (error || !stdout) {
          return;
        }

        const currentURL = stdout.trim();
        if (!currentURL) {
          return;
        }

        const previousURL = this.lastURL;
        if (currentURL !== previousURL && this.eventLogger) {
          this.eventLogger.logUserEvent('manual-navigation', {
            from: previousURL,
            to: currentURL
          });
        }

        this.lastURL = currentURL;
      }
    );
  }
}

module.exports = ChromeListener;
