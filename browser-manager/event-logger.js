const EventEmitter = require('events');

class EventLogger extends EventEmitter {
  constructor() {
    super();
    this.events = [];
  }

  logAutomationEvent(action, details) {
    const event = {
      type: 'automation',
      timestamp: new Date().toISOString(),
      action,
      details
    };
    this.events.push(event);
    this.emit('event', event);
    return event;
  }

  logUserEvent(action, details) {
    const event = {
      type: 'user',
      timestamp: new Date().toISOString(),
      action,
      details
    };
    this.events.push(event);
    this.emit('event', event);
    return event;
  }

  getEvents() {
    return [...this.events];
  }

  clear() {
    this.events = [];
    this.emit('cleared');
  }
}

module.exports = EventLogger;
