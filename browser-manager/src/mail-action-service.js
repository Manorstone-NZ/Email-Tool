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
    const moveUrl = `${this.baseUrl}${userPath}/messages/${encodeURIComponent(emailId)}/move`;

    const response = await fetch(moveUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ destinationId: 'deleteditems' }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Graph delete failed (${response.status}): ${text.slice(0, 300)}`);
    }

    const payload = await response.json();
    const movedMessageId = payload && payload.id ? payload.id : null;

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
      movedMessageId,
      statusCode: response.status,
    };
  }

  async archiveEmail(emailId, options = {}) {
    if (!emailId) {
      throw new Error('Email ID is required');
    }

    const token = this.tokenStore.getAccessToken();
    if (!token) {
      throw new Error('Graph access token missing');
    }

    const userPath = this.user === 'me' ? '/me' : `/users/${encodeURIComponent(this.user)}`;
    const archiveFolderId = options && options.archiveFolderId ? String(options.archiveFolderId).trim() : '';
    let response;
    let movedMessageId = null;

    if (archiveFolderId) {
      const moveUrl = `${this.baseUrl}${userPath}/messages/${encodeURIComponent(emailId)}/move`;
      response = await fetch(moveUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ destinationId: archiveFolderId }),
      });
    } else {
      const patchUrl = `${this.baseUrl}${userPath}/messages/${encodeURIComponent(emailId)}`;
      response = await fetch(patchUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ categories: ['Archive'] }),
      });
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Graph archive failed (${response.status}): ${text.slice(0, 300)}`);
    }

    if (archiveFolderId) {
      const payload = await response.json();
      movedMessageId = payload && payload.id ? payload.id : null;
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
      archiveFolderId: archiveFolderId || null,
      movedMessageId,
      statusCode: response.status,
    };
  }

  async listMailFolders() {
    const token = this.tokenStore.getAccessToken();
    if (!token) {
      throw new Error('Graph access token missing');
    }

    const userPath = this.user === 'me' ? '/me' : `/users/${encodeURIComponent(this.user)}`;
    const url = `${this.baseUrl}${userPath}/mailFolders?$top=200&$select=id,displayName,parentFolderId`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Graph list folders failed (${response.status}): ${text.slice(0, 300)}`);
    }

    const payload = await response.json();
    const folders = Array.isArray(payload.value) ? payload.value : [];

    return folders
      .map((folder) => ({
        id: folder.id,
        displayName: folder.displayName || '',
        parentFolderId: folder.parentFolderId || null,
        wellKnownName: folder.wellKnownName || null,
      }))
      .filter((folder) => folder.id && folder.displayName)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
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

  async setPinned(emailId, pinned = true) {
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
        flag: {
          flagStatus: pinned ? 'flagged' : 'notFlagged',
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Graph pin update failed (${response.status}): ${text.slice(0, 300)}`);
    }

    if (this.eventLogger) {
      this.eventLogger.logAutomationEvent('email-pin-success', {
        emailId,
        pinned: Boolean(pinned),
        statusCode: response.status,
      });
    }

    return {
      success: true,
      action: 'pin',
      emailId,
      pinned: Boolean(pinned),
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
