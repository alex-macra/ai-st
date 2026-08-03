export const MODEL_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  'gpt-5.4-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'gpt-5.4-nano': { inputPer1M: 0.075, outputPer1M: 0.3 },
  'gpt-5.4': { inputPer1M: 2.5, outputPer1M: 10.0 },
  'gpt-5.5': { inputPer1M: 2.5, outputPer1M: 10.0 },
};

export const DEFAULT_MODEL_PRICING = MODEL_PRICING['gpt-5.4-mini']!;
