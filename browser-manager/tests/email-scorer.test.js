const score = require('../src/email-scorer');

describe('EmailScorer (new signature)', () => {
  const baseEmail = {
    sender: 'test@example.com',
    subject: 'Test Subject',
    body: 'Test body',
    flagged: false,
    read: false,
    timestamp: new Date().toISOString()
  };

  // Category-Urgency Mapping Tests
  test('todo category with high confidence (>=0.8) should map to high urgency', () => {
    const email = { ...baseEmail };
    const decision = {
      category: 'todo',
      source: 'custom_rule',
      confidence: 0.85,
      skipAutomation: false,
      reasons: ['Direct ask detected']
    };
    const result = score(email, decision);
    
    expect(result.urgency).toBe('high');
    expect(result.score).toBeGreaterThan(0);
    expect(result.recommendedAction).toBeTruthy();
    expect(Array.isArray(result.reasons)).toBe(true);
  });

  test('todo category with low confidence (<0.8) should map to medium urgency', () => {
    const email = { ...baseEmail };
    const decision = {
      category: 'todo',
      source: 'heuristic',
      confidence: 0.7,
      skipAutomation: false,
      reasons: ['Weak signal']
    };
    const result = score(email, decision);
    
    expect(result.urgency).toBe('medium');
    expect(result.score).toBeGreaterThan(0);
  });

  test('fyi category should always map to low urgency', () => {
    const email = { ...baseEmail };
    const decision = {
      category: 'fyi',
      source: 'topic_label',
      confidence: 0.9,
      skipAutomation: false,
      reasons: ['FYI detected']
    };
    const result = score(email, decision);
    
    expect(result.urgency).toBe('low');
    expect(result.recommendedAction).toBe('Review Later');
  });

  test('to_follow_up category should map to medium urgency', () => {
    const email = { ...baseEmail };
    const decision = {
      category: 'to_follow_up',
      source: 'reply_transition',
      confidence: 0.8,
      skipAutomation: false,
      reasons: ['Reply detected']
    };
    const result = score(email, decision);
    
    expect(result.urgency).toBe('medium');
  });

  test('notification category should map to low urgency', () => {
    const email = { ...baseEmail };
    const decision = {
      category: 'notification',
      source: 'topic_label',
      confidence: 0.9,
      skipAutomation: false,
      reasons: ['System notification']
    };
    const result = score(email, decision);
    
    expect(result.urgency).toBe('low');
  });

  test('marketing category should map to low urgency', () => {
    const email = { ...baseEmail };
    const decision = {
      category: 'marketing',
      source: 'heuristic',
      confidence: 0.6,
      skipAutomation: false,
      reasons: ['Marketing detected']
    };
    const result = score(email, decision);
    
    expect(result.urgency).toBe('low');
  });

  // Score Calculation Tests (based on source)
  test('custom_rule source should produce highest base score boost', () => {
    const email = { ...baseEmail };
    const decision1 = {
      category: 'fyi',
      source: 'custom_rule',
      confidence: 0.8,
      skipAutomation: false,
      reasons: []
    };
    const decision2 = {
      category: 'fyi',
      source: 'heuristic',
      confidence: 0.8,
      skipAutomation: false,
      reasons: []
    };
    
    const result1 = score(email, decision1);
    const result2 = score(email, decision2);
    
    expect(result1.score).toBeGreaterThan(result2.score);
  });

  test('reply_transition source should score higher than topic_label', () => {
    const email = { ...baseEmail };
    const decision1 = {
      category: 'fyi',
      source: 'reply_transition',
      confidence: 0.8,
      skipAutomation: false,
      reasons: []
    };
    const decision2 = {
      category: 'fyi',
      source: 'topic_label',
      confidence: 0.8,
      skipAutomation: false,
      reasons: []
    };
    
    const result1 = score(email, decision1);
    const result2 = score(email, decision2);
    
    expect(result1.score).toBeGreaterThan(result2.score);
  });

  // Score Calculation Tests (based on category)
  test('todo category should receive higher score than fyi', () => {
    const email = { ...baseEmail };
    const decision1 = {
      category: 'todo',
      source: 'heuristic',
      confidence: 0.8,
      skipAutomation: false,
      reasons: []
    };
    const decision2 = {
      category: 'fyi',
      source: 'heuristic',
      confidence: 0.8,
      skipAutomation: false,
      reasons: []
    };
    
    const result1 = score(email, decision1);
    const result2 = score(email, decision2);
    
    expect(result1.score).toBeGreaterThan(result2.score);
  });

  test('to_follow_up category should score higher than fyi', () => {
    const email = { ...baseEmail };
    const decision1 = {
      category: 'to_follow_up',
      source: 'heuristic',
      confidence: 0.8,
      skipAutomation: false,
      reasons: []
    };
    const decision2 = {
      category: 'fyi',
      source: 'heuristic',
      confidence: 0.8,
      skipAutomation: false,
      reasons: []
    };
    
    const result1 = score(email, decision1);
    const result2 = score(email, decision2);
    
    expect(result1.score).toBeGreaterThan(result2.score);
  });

  // Recommended Action Mapping Tests
  test('high urgency + score >= 70 should recommend "Approve / Decide"', () => {
    const email = { ...baseEmail };
    const decision = {
      category: 'todo',
      source: 'custom_rule',
      confidence: 0.9,
      skipAutomation: false,
      reasons: []
    };
    const result = score(email, decision);
    
    expect(result.urgency).toBe('high');
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.recommendedAction).toBe('Approve / Decide');
  });

  test('high urgency + score < 70 should recommend "Review / Respond"', () => {
    const email = { ...baseEmail };
    const decision = {
      category: 'todo',
      source: 'heuristic',
      confidence: 0.9,
      skipAutomation: false,
      reasons: []
    };
    const result = score(email, decision);
    
    expect(result.urgency).toBe('high');
    expect(result.score).toBeLessThan(70);
    expect(result.recommendedAction).toBe('Review / Respond');
  });

  test('medium urgency + score >= 60 should recommend "Review / Respond"', () => {
    const email = { ...baseEmail };
    const decision = {
      category: 'to_follow_up',
      source: 'custom_rule',
      confidence: 0.8,
      skipAutomation: false,
      reasons: []
    };
    const result = score(email, decision);
    
    expect(result.urgency).toBe('medium');
    if (result.score >= 60) {
      expect(result.recommendedAction).toBe('Review / Respond');
    }
  });

  test('medium urgency + score < 60 should recommend "Review Later"', () => {
    const email = { ...baseEmail };
    const decision = {
      category: 'to_follow_up',
      source: 'heuristic',
      confidence: 0.8,
      skipAutomation: false,
      reasons: []
    };
    const result = score(email, decision);
    
    expect(result.urgency).toBe('medium');
    if (result.score < 60) {
      expect(result.recommendedAction).toBe('Review Later');
    }
  });

  test('low urgency should always recommend "Review Later"', () => {
    const email = { ...baseEmail };
    const decision = {
      category: 'fyi',
      source: 'custom_rule',
      confidence: 0.9,
      skipAutomation: false,
      reasons: []
    };
    const result = score(email, decision);
    
    expect(result.urgency).toBe('low');
    expect(result.recommendedAction).toBe('Review Later');
  });

  // Reasons Array Tests
  test('reasons array should include decision.reasons', () => {
    const email = { ...baseEmail };
    const decision = {
      category: 'todo',
      source: 'custom_rule',
      confidence: 0.8,
      skipAutomation: false,
      reasons: ['Direct ask detected', 'VIP sender']
    };
    const result = score(email, decision);
    
    expect(Array.isArray(result.reasons)).toBe(true);
    expect(result.reasons).toContain('Direct ask detected');
    expect(result.reasons).toContain('VIP sender');
  });

  test('reasons array should include confidence downgrade reason for todo <0.8', () => {
    const email = { ...baseEmail };
    const decision = {
      category: 'todo',
      source: 'heuristic',
      confidence: 0.7,
      skipAutomation: false,
      reasons: ['Initial reason']
    };
    const result = score(email, decision);
    
    expect(result.reasons.some(r => r.includes('lower confidence'))).toBe(true);
  });

  test('reasons array should include score calculation reason', () => {
    const email = { ...baseEmail };
    const decision = {
      category: 'todo',
      source: 'custom_rule',
      confidence: 0.8,
      skipAutomation: false,
      reasons: []
    };
    const result = score(email, decision);
    
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons.some(r => r.includes('Scored') || r.includes('category'))).toBe(true);
  });

  // Edge Cases
  test('invalid email (null) should return safe defaults', () => {
    const decision = {
      category: 'fyi',
      source: 'heuristic',
      confidence: 0.8,
      skipAutomation: false,
      reasons: []
    };
    const result = score(null, decision);
    
    expect(result.urgency).toBe('low');
    expect(result.score).toBe(30);
    expect(result.recommendedAction).toBe('Review Later');
    expect(result.reasons).toContain('Invalid email data; defaulting to low urgency');
  });

  test('missing decision should return safe defaults', () => {
    const email = { ...baseEmail };
    const result = score(email, null);
    
    expect(result.urgency).toBe('low');
    expect(result.score).toBe(30);
    expect(result.recommendedAction).toBe('Review Later');
    expect(result.reasons).toContain('No categorization decision; defaulting to low urgency');
  });

  test('missing category in decision should return safe defaults', () => {
    const email = { ...baseEmail };
    const decision = {
      source: 'heuristic',
      confidence: 0.8,
      skipAutomation: false,
      reasons: []
    };
    const result = score(email, decision);
    
    expect(result.urgency).toBe('low');
    expect(result.score).toBe(30);
    expect(result.recommendedAction).toBe('Review Later');
  });

  test('score should always be between 20 and 100', () => {
    const email = { ...baseEmail };
    const categories = ['todo', 'fyi', 'to_follow_up', 'notification', 'marketing'];
    const sources = ['custom_rule', 'reply_transition', 'topic_label', 'heuristic'];
    
    for (const category of categories) {
      for (const source of sources) {
        const decision = {
          category,
          source,
          confidence: 0.8,
          skipAutomation: false,
          reasons: []
        };
        const result = score(email, decision);
        
        expect(result.score).toBeGreaterThanOrEqual(20);
        expect(result.score).toBeLessThanOrEqual(100);
      }
    }
  });

  test('urgency should be one of expected values', () => {
    const email = { ...baseEmail };
    const validUrgencies = ['low', 'medium', 'high'];
    const categories = ['todo', 'fyi', 'to_follow_up', 'notification', 'marketing'];
    
    for (const category of categories) {
      const decision = {
        category,
        source: 'heuristic',
        confidence: 0.8,
        skipAutomation: false,
        reasons: []
      };
      const result = score(email, decision);
      
      expect(validUrgencies).toContain(result.urgency);
    }
  });

  test('recommendedAction should be one of expected values', () => {
    const email = { ...baseEmail };
    const validActions = ['Review Later', 'Review / Respond', 'Approve / Decide', 'Review'];
    const categories = ['todo', 'fyi', 'to_follow_up', 'notification', 'marketing'];
    
    for (const category of categories) {
      const decision = {
        category,
        source: 'custom_rule',
        confidence: 0.8,
        skipAutomation: false,
        reasons: []
      };
      const result = score(email, decision);
      
      expect(validActions).toContain(result.recommendedAction);
    }
  });
});
