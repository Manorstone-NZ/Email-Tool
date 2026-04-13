(() => {
let constants = {
  RECOMMENDED_ACTIONS: ['Review Later', 'Review / Respond', 'Approve / Decide', 'Review'],
};

if (typeof module !== 'undefined' && module.exports) {
  constants = require('./portal-constants');
} else if (typeof window !== 'undefined' && window.PortalConstants) {
  constants = window.PortalConstants;
}

const VALID_CATEGORIES = ['Needs Reply', 'Waiting on Others', 'FYI'];
const CATEGORY_COLORS = Object.freeze({
  'Needs Reply': '#2f6f4f',
  'Waiting on Others': '#8b6a2f',
  'FYI': '#4d5f7a',
});

function toLower(value) {
  return String(value || '').toLowerCase();
}

function hashString(input) {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash) + input.charCodeAt(i);
    hash >>>= 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function deriveRecommendedAction(item) {
  const action = item && item.action;
  return constants.RECOMMENDED_ACTIONS.includes(action) ? action : 'Review';
}

function deriveScoreMeta(item) {
  const score = typeof (item && item.score) === 'number' ? item.score : 0;
  return {
    score,
    confidenceText: `${Math.round(score)}%`,
  };
}

function derivePrimaryCategory(item) {
  if (item && VALID_CATEGORIES.includes(item.primaryCategory)) {
    return item.primaryCategory;
  }

  const action = deriveRecommendedAction(item);
  const reasonText = toLower(item && item.reason);
  const internalCategory = item && item.category;

  if (action === 'Review / Respond') {
    return 'Needs Reply';
  }
  if (reasonText.includes('waiting')) {
    return 'Waiting on Others';
  }
  
  // Map internal categories to UI categories
  if (internalCategory === 'todo') {
    return 'Needs Reply';
  }
  if (internalCategory === 'to_follow_up') {
    return 'Waiting on Others';
  }
  
  return 'FYI';
}

function deriveCategorySource(item) {
  if (item && VALID_CATEGORIES.includes(item.primaryCategory)) {
    return 'ai';
  }

  return 'heuristic';
}

function deriveEmailTags(item) {
  if (Array.isArray(item && item.tags)) {
    return item.tags;
  }

  const tags = [];
  const action = deriveRecommendedAction(item);
  const sender = toLower(item && item.sender);
  const subject = toLower(item && item.subject);
  const reason = toLower(item && item.reason);
  const joined = `${sender} ${subject} ${reason}`;

  // Topic label from categoriser — show as a tag pill
  const matchedTopicLabel = item && item.matchedTopicLabel;
  if (matchedTopicLabel) {
    // Convert key like 'billing-invoices' → 'Billing Invoices'
    const display = String(matchedTopicLabel)
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
    tags.push(display);
  }

  if (action === 'Approve / Decide') {
    tags.push('Approval');
  }

  if (joined.includes('vendor') || joined.includes('quote') || joined.includes('invoice')) {
    tags.push('Vendor');
  }

  if (subject.includes('urgent') || subject.includes('asap') || subject.includes('critical') || reason.includes('urgent') || reason.includes('asap') || reason.includes('critical')) {
    tags.push('Urgent');
  }

  return tags;
}

function deriveUiState(item, localState) {
  return {
    flagged: Boolean(item && item.flagged),
    pinned: Boolean(localState && localState.pinned),
    done: Boolean(localState && localState.done),
  };
}

function resolveDisplayTimestamp(item) {
  if (item && item.timestamp) {
    return { value: item.timestamp, source: 'timestamp' };
  }
  return { value: item && item.ingestedAt, source: 'ingestedAt' };
}

function mapEmailItem(item, ingestedAt) {
  const sender = String((item && item.sender) || '');
  const subject = String((item && item.subject) || '');
  const stableSource = `${toLower(sender)}|${toLower(subject)}`;
  const fallbackId = `email-${hashString(stableSource)}`;
  const resolvedId = (item && item.id)
    || (item && item.messageId)
    || (item && item.threadId)
    || (item && item.openUrl)
    || fallbackId;

  return {
    ...item,
    id: resolvedId,
    ingestedAt,
    recommendedAction: deriveRecommendedAction(item),
    primaryCategory: derivePrimaryCategory(item),
    categorySource: deriveCategorySource(item),
    tags: deriveEmailTags(item),
    scoreMeta: deriveScoreMeta(item),
    uiState: deriveUiState(item, null),
    displayTimestamp: resolveDisplayTimestamp({
      timestamp: item && item.timestamp,
      ingestedAt,
    }),
    preview: (item && item.preview) || (item && item.body) || '',
  };
}

function matchesSearch(item, searchText) {
  if (!searchText) {
    return true;
  }

  const haystack = toLower([
    item && item.sender,
    item && item.subject,
    item && item.preview,
  ].join(' '));

  return haystack.includes(searchText);
}

function filterEmailItems(items, filters) {
  const safeItems = Array.isArray(items) ? items : [];
  const safeFilters = filters || {};
  const searchText = toLower(safeFilters.search).trim();
  const stateOverridesCategory = safeFilters.state === 'Flagged'
    || safeFilters.state === 'Pinned'
    || safeFilters.state === 'Done';

  return safeItems
    .filter((item) => matchesSearch(item, searchText))
    .filter((item) => {
      if (safeFilters.state === 'Done') {
        return true;
      }
      return !(item && item.uiState && item.uiState.done);
    })
    .filter((item) => {
      if (!safeFilters.category) {
        return true;
      }
      if (stateOverridesCategory) {
        return true;
      }
      return item && item.primaryCategory === safeFilters.category;
    })
    .filter((item) => {
      if (!safeFilters.state || safeFilters.state === 'Done') {
        return safeFilters.state !== 'Done' || Boolean(item && item.uiState && item.uiState.done);
      }

      if (safeFilters.state === 'Flagged') {
        return Boolean(item && item.uiState && item.uiState.flagged);
      }
      if (safeFilters.state === 'Pinned') {
        return Boolean(item && item.uiState && item.uiState.pinned);
      }
      return true;
    })
    .filter((item) => {
      if (!safeFilters.tag) {
        return true;
      }
      return Array.isArray(item && item.tags) && item.tags.includes(safeFilters.tag);
    });
}

function countEmailBuckets(items, options) {
  const safeItems = Array.isArray(items) ? items : [];
  const searchText = toLower(options && options.search).trim();
  const filtered = safeItems.filter((item) => matchesSearch(item, searchText));

  return filtered.reduce((acc, item) => {
    const category = item && item.primaryCategory;
    if (category) {
      acc.categories[category] = (acc.categories[category] || 0) + 1;
    }

    if (item && item.uiState) {
      if (item.uiState.flagged) {
        acc.states.Flagged += 1;
      }
      if (item.uiState.pinned) {
        acc.states.Pinned += 1;
      }
      if (item.uiState.done) {
        acc.states.Done += 1;
      }
    }

    if (Array.isArray(item && item.tags)) {
      item.tags.forEach((tag) => {
        acc.tags[tag] = (acc.tags[tag] || 0) + 1;
      });
    }

    return acc;
  }, {
    categories: {},
    states: { Flagged: 0, Pinned: 0, Done: 0 },
    tags: {},
  });
}

function warnIfLargeEmailList(items, warnFn) {
  const safeWarn = typeof warnFn === 'function' ? warnFn : console.warn;
  const count = Array.isArray(items) ? items.length : 0;

  if (count > 500) {
    safeWarn(`Large email list detected: ${count} items`);
  }
}

function getCategoryColor(category) {
  return CATEGORY_COLORS[String(category || '')] || '#4d5f7a';
}

function getPrioritizedReaderMetadata(item, options) {
  const maxEntries = Number((options && options.maxEntries) || 4);
  const entries = [
    {
      key: 'category',
      label: 'Category',
      value: String((item && item.primaryCategory) || 'FYI'),
      priority: 'high',
    },
    {
      key: 'recommendedAction',
      label: 'Recommended action',
      value: String((item && item.recommendedAction) || 'Review'),
      priority: 'high',
    },
    {
      key: 'urgency',
      label: 'Urgency',
      value: String((item && item.urgency) || ''),
      priority: 'low',
    },
    {
      key: 'source',
      label: 'Source',
      value: String((item && item.categorySource) || ''),
      priority: 'low',
    },
    {
      key: 'confidence',
      label: 'Confidence',
      value: String((item && item.scoreMeta && item.scoreMeta.confidenceText) || ''),
      priority: 'low',
    },
  ].filter((entry) => entry.value);

  entries.sort((a, b) => {
    if (a.priority === b.priority) {
      return 0;
    }
    return a.priority === 'high' ? -1 : 1;
  });

  return entries.slice(0, Math.max(maxEntries, 0));
}

const api = {
  deriveRecommendedAction,
  deriveEmailTags,
  derivePrimaryCategory,
  deriveCategorySource,
  deriveScoreMeta,
  deriveUiState,
  resolveDisplayTimestamp,
  mapEmailItem,
  filterEmailItems,
  countEmailBuckets,
  warnIfLargeEmailList,
  getCategoryColor,
  getPrioritizedReaderMetadata,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof window !== 'undefined') {
  window.EmailHelpers = api;
}
})();
