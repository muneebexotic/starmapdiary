export const SENTIMENT_CONFIG = {
  positive: { color: "#f5c96a", label: "Positive" },
  neutral: { color: "#f2f4ff", label: "Neutral" },
  negative: { color: "#72a6ff", label: "Negative" },
  reflective: { color: "#8457db", label: "Reflective" }
};

export const SENTIMENT_LEXICON = {
  positive: [
    "happy", "joy", "grateful", "great", "good", "excellent", "love", "hope", "proud", "excited",
    "calm", "relieved", "win", "wonderful", "smile", "success", "peaceful", "thankful", "amazing", "bright"
  ],
  negative: [
    "sad", "angry", "upset", "anxious", "afraid", "fear", "stress", "stressed", "tired", "pain",
    "hurt", "lonely", "fail", "failure", "bad", "worse", "worried", "depressed", "frustrated", "overwhelmed"
  ],
  reflective: [
    "think", "thought", "reflect", "realize", "realized", "learned", "lesson", "question", "meaning", "memory",
    "wonder", "consider", "balance", "perspective", "aware", "understand", "insight", "ponder", "journal", "noticed"
  ]
};
