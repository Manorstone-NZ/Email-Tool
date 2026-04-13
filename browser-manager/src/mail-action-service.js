const GraphTokenStore = require('./graph-token-store');

class MailActionService {
  constructor(optionsOrGraphAPI = {}) {
    // Support both graphAPI injection (for testing) and options object
    const options = (optionsOrGraphAPI && typeof optionsOrGraphAPI === 'object' && optionsOrGraphAPI.patch)
      ? {}
      : optionsOrGraphAPI;
    
    this.graphAPI = (optionsOrGraphAPI && typeof optionsOrGraphAPI === 'object' && optionsOrGraphAPI.patch)
      ? optionsOrGraphAPI
      : options.graphAPI || null;
    
    this.tokenStore = options.tokenStore || new GraphTokenStore();
    this.baseUrl = options.baseUrl || process.env.GRAPH_BASE_URL || 'https://graph.microsoft.com/v1.0';
    this.user = options.user || process.env.GRAPH_USER || 'me';
    this.eventLogger = options.eventLogger || null;
  }

  async deleteEmail(emailId) {
    if (!emailId) {
      throw new Error('Email ID is required');
    }

    const token = this.tokenStore.getAccessToken();
    if (!token) {
      throw new Error('Graph access token missing');
    }

    const userPath = this.user === 'me' ? '/me' : `/users/${encodeURIComponent(this.user)}`;
    const url = `${this.baseUrl}${userPath}/messages/${encodeURIComponent(emailId)}`;

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Graph delete failed (${response.status}): ${text.slice(0, 300)}`);
    }

    if (this.eventLogger) {
      this.eventLogger.logAutomationEvent('email-delete-success', {
        emailId,
        statusCode: response.status,
      });
    }

    return {
      success: true,
      action: 'delete',
      emailId,
      statusCode: response.status,
    };
  }

  async archiveEmail(emailId) {
    if (!emailId) {
      throw new Error('Email ID is required');
    }

    const token = this.tokenStore.getAccessToken();
    if (!token) {
      throw new Error('Graph access token missing');
    }

    const userPath = this.user === 'me' ? '/me' : `/users/${encodeURIComponent(this.user)}`;
    const url = `${this.baseUrl}${userPath}/messages/${encodeURIComponent(emailId)}`;

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        categories: ['Archive'],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Graph archive failed (${response.status}): ${text.slice(0, 300)}`);
    }

    if (this.eventLogger) {
      this.eventLogger.logAutomationEvent('email-archive-success', {
        emailId,
        statusCode: response.status,
      });
    }

    return {
      success: true,
      action: 'archive',
      emailId,
      statusCode: response.status,
    };
  }

  async markAsRead(emailId, isRead = true) {
    if (!emailId) {
      throw new Error('Email ID is required');
    }

    const token = this.tokenStore.getAccessToken();
    if (!token) {
      throw new Error('Graph access token missing');
    }

    const userPath = this.user === 'me' ? '/me' : `/users/${encodeURIComponent(this.user)}`;
    const url = `${this.baseUrl}${userPath}/messages/${encodeURIComponent(emailId)}`;

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        isRead,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Graph markAsRead failed (${response.status}): ${text.slice(0, 300)}`);
    }

    if (this.eventLogger) {
      this.eventLogger.logAutomationEvent('email-mark-read-success', {
        emailId,
        isRead,
        statusCode: response.status,
      });
    }

    return {
      success: true,
      action: 'mark-read',
      emailId,
      isRead,
      statusCode: response.status,
    };
  }

  async applyActions(email, decision, settings) {
    const category = decision.category;
    const categorySettings = settings.categories?.[category];

    // Guard 1: skipAutomation
    if (decision.skipAutomation === true) {
      return { category, skipped: true, skipReason: 'skip_automation', actionsAttempted: [], actionsApplied: [], actionsSkipped: [], errors: [] };
    }

    // Guard 2: category disabled
    if (!categorySettings || categorySettings.enabled !== true) {
      return { category, skipped: true, skipReason: 'category_disabled', actionsAttempted: [], actionsApplied: [], actionsSkipped: [], errors: [] };
    }

    // Guard 3: no actions configured
    const hasMove = Boolean(categorySettings.targetFolderName);
    const hasTag = Boolean(categorySettings.outlookCategoryTag);
    if (!hasMove && !hasTag) {
      return { category, skipped: true, skipReason: 'no_actions_configured', actionsAttempted: [], actionsApplied: [], actionsSkipped: [], errors: [] };
    }

    const actionsAttempted = [];
    const actionsApplied = [];
    const actionsSkipped = [];
    const errors = [];

    // Attempt MOVE action
    if (hasMove) {
      actionsAttempted.push('move');
      const folderId = this.folderCache?.[categorySettings.targetFolderName];
      
      if (!folderId) {
        actionsSkipped.push({ action: 'move', reason: `Folder "${categorySettings.targetFolderName}" not found in cache` });
      } else if (email.folderId === folderId) {
        actionsSkipped.push({ action: 'move', reason: 'Email already in target folder' });
      } else {
        try {
          await this._graphPatch(`/me/messages/${email.messageId}`, { parentFolderId: folderId });
          actionsApplied.push('move');
        } catch (err) {
          errors.push({
            action: 'move',
            code: err.code,
            message: err.message,
            retryAttempted: false
          });
        }
      }
    }

    // Attempt TAG action
    if (hasTag) {
      actionsAttempted.push('tag');
      const targetTag = categorySettings.outlookCategoryTag;
      const currentCategories = email.categories || [];

      if (currentCategories.includes(targetTag)) {
        actionsSkipped.push({ action: 'tag', reason: `Email already has category "${targetTag}"` });
      } else {
        try {
          const updatedCategories = [...currentCategories, targetTag];
          await this._graphPatch(`/me/messages/${email.messageId}`, { categories: updatedCategories });
          actionsApplied.push('tag');
        } catch (err) {
          errors.push({
            action: 'tag',
            code: err.code,
            message: err.message,
            retryAttempted: false
          });
        }
      }
    }

    return { category, skipped: false, actionsAttempted, actionsApplied, actionsSkipped, errors };
  }

  async _graphPatch(path, body) {
    // Delegate to graphAPI.patch or override in subclass
    if (this.graphAPI?.patch) return this.graphAPI.patch(path, body);
    throw new Error('[MailActionService] No graphAPI.patch available');
  }
}

module.exports = MailActionService;
