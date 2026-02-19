import { SENTIMENT_LEXICON } from "../config/sentiment.js";

export function classifySentiment(text) {
  const normalized = String(text || "").toLowerCase();
  const tokens = normalized.match(/[a-z']+/g) || [];

  const counts = {
    positive: 0,
    neutral: 0,
    negative: 0,
    reflective: 0
  };

  for (const token of tokens) {
    if (SENTIMENT_LEXICON.positive.includes(token)) counts.positive += 1;
    if (SENTIMENT_LEXICON.negative.includes(token)) counts.negative += 1;
    if (SENTIMENT_LEXICON.reflective.includes(token)) counts.reflective += 1;
  }

  const qMarks = (normalized.match(/\?/g) || []).length;
  if (qMarks > 1) counts.reflective += 1;

  const maxScore = Math.max(counts.positive, counts.negative, counts.reflective);
  if (maxScore === 0) return "neutral";
  if (counts.reflective === maxScore && counts.reflective >= 2) return "reflective";
  if (counts.positive === maxScore && counts.positive > counts.negative) return "positive";
  if (counts.negative === maxScore && counts.negative > counts.positive) return "negative";
  if (counts.reflective === maxScore) return "reflective";

  return "neutral";
}
