describe('Categorisation UI Components', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('renderCategoryBadge', () => {
    test('renders category badge with correct colour', () => {
      const { renderCategoryBadge } = require('../../public/app.js');
      
      const badge = renderCategoryBadge({ category: 'todo' });
      
      expect(badge.classList.contains('category-badge')).toBe(true);
      expect(badge.classList.contains('category-todo')).toBe(true);
      expect(badge.textContent).toContain('Todo');
    });

    test('renders all canonical categories', () => {
      const { renderCategoryBadge } = require('../../public/app.js');
      const categories = ['todo', 'fyi', 'to_follow_up', 'notification', 'marketing'];
      
      for (const cat of categories) {
        const badge = renderCategoryBadge({ category: cat });
        expect(badge.classList.contains(`category-${cat}`)).toBe(true);
      }
    });

    test('displays skip-automation lock icon when skipAutomation=true', () => {
      const { renderCategoryBadge } = require('../../public/app.js');
      
      const badge = renderCategoryBadge({ category: 'todo', skipAutomation: true });
      
      expect(badge.textContent).toContain('🔒');
      expect(badge.querySelector('.skip-automation')).toBeTruthy();
    });

    test('does not display lock icon when skipAutomation=false', () => {
      const { renderCategoryBadge } = require('../../public/app.js');
      
      const badge = renderCategoryBadge({ category: 'todo', skipAutomation: false });
      
      expect(badge.textContent).not.toContain('🔒');
    });

    test('displays confidence percentage when available', () => {
      const { renderCategoryBadge } = require('../../public/app.js');
      
      const badge = renderCategoryBadge({ category: 'todo', categorizationConfidence: 0.95 });
      
      expect(badge.textContent).toContain('95%');
    });

    test('includes title attribute with source and confidence', () => {
      const { renderCategoryBadge } = require('../../public/app.js');
      
      const badge = renderCategoryBadge({
        category: 'todo',
        categorySource: 'custom_rule',
        categorizationConfidence: 0.85
      });
      
      const title = badge.getAttribute('title');
      expect(title).toContain('todo');
      expect(title).toContain('custom_rule');
      expect(title).toContain('85%');
    });

    test('handles null category gracefully', () => {
      const { renderCategoryBadge } = require('../../public/app.js');
      
      const badge = renderCategoryBadge({ category: null });
      
      expect(badge.classList.contains('category-badge')).toBe(true);
      expect(badge.textContent.toLowerCase()).toContain('uncategorised');
    });

    test('applies loading state class when specified', () => {
      const { renderCategoryBadge } = require('../../public/app.js');
      
      const badge = renderCategoryBadge({ category: 'todo', isLoading: true });
      
      expect(badge.classList.contains('loading')).toBe(true);
      expect(badge.textContent).toContain('…');
    });

    test('badge updates when TriageItem updated', () => {
      const { renderCategoryBadge } = require('../../public/app.js');
      
      const item = { category: 'fyi', skipAutomation: false, categorizationConfidence: 0.5 };
      const badge = renderCategoryBadge(item);
      const originalClass = badge.className;

      // Update item
      item.category = 'todo';
      item.skipAutomation = true;
      const updatedBadge = renderCategoryBadge(item);

      expect(updatedBadge.className).not.toBe(originalClass);
      expect(updatedBadge.textContent).toContain('🔒');
    });

    test('colour scheme correct for all categories', () => {
      const { getCategoryColour } = require('../../public/app.js');
      
      const colours = {
        todo: '#e74c3c',
        fyi: '#3498db',
        to_follow_up: '#f39c12',
        notification: '#27ae60',
        marketing: '#95a5a6',
      };

      for (const [cat, colour] of Object.entries(colours)) {
        expect(getCategoryColour(cat)).toBe(colour);
      }
    });
  });

  describe('TriageItem rendering with badge', () => {
    test('TriageItem shows category badge in correct position', () => {
      // This would require integration with the full TriageItem renderer
      // For now, verify that badge is exported and callable
      const { renderCategoryBadge } = require('../../public/app.js');
      expect(typeof renderCategoryBadge).toBe('function');
    });
  });

  describe('Filter Toggle Behavior', () => {
    test('toggleFilterValue clears active value when clicked again', () => {
      const { toggleFilterValue } = require('../../public/app.js');
      expect(toggleFilterValue('Vendor', 'Vendor')).toBe(null);
    });

    test('toggleFilterValue sets new value when different tag clicked', () => {
      const { toggleFilterValue } = require('../../public/app.js');
      expect(toggleFilterValue('Vendor', 'Approval')).toBe('Approval');
    });

    test('toggleFilterValue clears filter for empty selection', () => {
      const { toggleFilterValue } = require('../../public/app.js');
      expect(toggleFilterValue('Vendor', '')).toBe(null);
    });
  });
});
