'use strict';

const CATEGORY_URGENCY_MAP = {
  todo: { default: 'high', lowConfidence: 'medium' },
  fyi: { default: 'low' },
  to_follow_up: { default: 'medium' },
  notification: { default: 'low' },
  marketing: { default: 'low' },
};

function score(email, decision) {
  if (!email || typeof email !== 'object') {
    return {
      urgency: 'low',
      score: 30,
      recommendedAction: 'Review Later',
      reasons: ['Invalid email data; defaulting to low urgency']
    };
  }

  if (!decision || typeof decision !== 'object' || !decision.category) {
    return {
      urgency: 'low',
      score: 30,
      recommendedAction: 'Review Later',
      reasons: ['No categorization decision; defaulting to low urgency']
    };
  }

  const reasons = [...(decision.reasons || [])];
  
  // (1) Determine urgency based on category + confidence
  let urgency = CATEGORY_URGENCY_MAP[decision.category]?.default || 'low';
  if (decision.category === 'todo' && decision.confidence < 0.8) {
    urgency = 'medium';
    reasons.push('Todo category with lower confidence downgraded to medium urgency');
  }

  // (2) Calculate numerical score (0–100)
  let baseScore = 45;
  
  if (decision.source === 'custom_rule') baseScore += 30; // High confidence
  else if (decision.source === 'reply_transition') baseScore += 20;
  else if (decision.source === 'topic_label') baseScore += 10;
  // heuristic: no boost
  
  if (decision.category === 'todo') baseScore += 20;
  else if (decision.category === 'to_follow_up') baseScore += 15;
  else if (decision.category === 'fyi') baseScore = Math.max(baseScore - 5, 30);
  else if (decision.category === 'notification') baseScore = Math.max(baseScore - 10, 25);
  else if (decision.category === 'marketing') baseScore = Math.max(baseScore - 15, 20);

  const scoreValue = Math.min(Math.max(baseScore, 20), 100);

  // (3) Map urgency + score → recommendedAction
  let recommendedAction = 'Review Later';
  if (urgency === 'high') {
    if (scoreValue >= 70) recommendedAction = 'Approve / Decide';
    else recommendedAction = 'Review / Respond';
  } else if (urgency === 'medium') {
    if (scoreValue >= 60) recommendedAction = 'Review / Respond';
    else recommendedAction = 'Review Later';
  }
  // urgency === 'low' stays 'Review Later'

  reasons.push(`Scored ${scoreValue}/100 based on category "${decision.category}" + source "${decision.source}"`);
  
  return { urgency, score: scoreValue, recommendedAction, reasons };
}

module.exports = score;
