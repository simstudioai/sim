import type { ModelPricingMap } from './types'

/**
 * Model pricing information per million tokens
 *
 * Prices are in USD per 1M tokens
 * All prices should be regularly updated to reflect current market rates
 */
const modelPricing: ModelPricingMap = {
  // OpenAI Models
  'gpt-4o': {
    input: 2.5,
    cachedInput: 1.25,
    output: 10.0,
    updatedAt: '2025-06-17',
  },
  o1: {
    input: 15.0,
    cachedInput: 7.5,
    output: 60,
    updatedAt: '2025-06-17',
  },
  o3: {
    input: 2,
    cachedInput: 0.5,
    output: 8,
    updatedAt: '2025-06-17',
  },
  'o4-mini': {
    input: 1.1,
    cachedInput: 0.275,
    output: 4.4,
    updatedAt: '2025-06-17',
  },
  'gpt-4.1': {
    input: 2.0,
    cachedInput: 0.5,
    output: 8.0,
    updatedAt: '2025-06-17',
  },
  'gpt-4.1-nano': {
    input: 0.1,
    cachedInput: 0.025,
    output: 0.4,
    updatedAt: '2025-06-17',
  },
  'gpt-4.1-mini': {
    input: 0.4,
    cachedInput: 0.1,
    output: 1.6,
    updatedAt: '2025-06-17',
  },

  // Azure OpenAI Models (same pricing as OpenAI)
  'azure/gpt-4o': {
    input: 2.5,
    cachedInput: 1.25, // 50% discount for cached input
    output: 10.0,
    updatedAt: '2025-06-15',
  },
  'azure/o3': {
    input: 10,
    cachedInput: 2.5,
    output: 40,
    updatedAt: '2025-06-15',
  },
  'azure/o4-mini': {
    input: 1.1,
    cachedInput: 0.275,
    output: 4.4,
    updatedAt: '2025-06-15',
  },
  'azure/gpt-4.1': {
    input: 2.0,
    cachedInput: 0.5,
    output: 8.0,
    updatedAt: '2025-06-15',
  },
  'azure/model-router': {
    input: 2.0,
    cachedInput: 0.5,
    output: 8.0,
    updatedAt: '2025-06-15',
  },

  // Anthropic Models
  'claude-3-5-sonnet-latest': {
    input: 3.0,
    cachedInput: 1.5,
    output: 15.0,
    updatedAt: '2025-06-17',
  },
  'claude-3-7-sonnet-latest': {
    input: 3.0,
    cachedInput: 1.5,
    output: 15.0,
    updatedAt: '2025-06-17',
  },
  'claude-sonnet-4-0': {
    input: 3.0,
    cachedInput: 1.5,
    output: 15.0,
    updatedAt: '2025-06-17',
  },
  'claude-opus-4-0': {
    input: 15.0,
    cachedInput: 7.5,
    output: 75.0,
    updatedAt: '2025-06-17',
  },

  // Google Models
  'gemini-2.5-pro': {
    input: 0.15,
    cachedInput: 0.075,
    output: 0.6,
    updatedAt: '2025-06-17',
  },
  'gemini-2.5-flash': {
    input: 0.15,
    cachedInput: 0.075,
    output: 0.6,
    updatedAt: '2025-06-17',
  },

  // Deepseek Models
  'deepseek-v3': {
    input: 0.75,
    cachedInput: 0.4,
    output: 1.0,
    updatedAt: '2025-03-21',
  },
  'deepseek-r1': {
    input: 1.0,
    cachedInput: 0.5,
    output: 1.5,
    updatedAt: '2025-03-21',
  },

  // xAI Models
  'grok-3-latest': {
    input: 3.0,
    cachedInput: 1.5,
    output: 15.0,
    updatedAt: '2025-04-17',
  },
  'grok-3-fast-latest': {
    input: 5.0,
    cachedInput: 2.5,
    output: 25.0,
    updatedAt: '2025-04-17',
  },

  // Cerebras Models
  'cerebras/llama-3.3-70b': {
    input: 0.94,
    cachedInput: 0.47,
    output: 0.94,
    updatedAt: '2025-03-21',
  },

  // Groq Models
  'groq/meta-llama/llama-4-scout-17b-16e-instruct': {
    input: 0.4,
    cachedInput: 0.2,
    output: 0.6,
    updatedAt: '2025-06-17',
  },
  'groq/deepseek-r1-distill-llama-70b': {
    input: 0.75,
    cachedInput: 0.38,
    output: 0.99,
    updatedAt: '2025-06-17',
  },
  'groq/qwen-qwq-32b': {
    input: 0.29,
    cachedInput: 0.29,
    output: 0.39,
    updatedAt: '2025-06-17',
  },
}

/**
 * Get pricing for a specific model
 * Returns default pricing if model not found
 */
export function getModelPricing(model: string) {
  const normalizedModel = model.toLowerCase()

  // Exact match
  if (normalizedModel in modelPricing) {
    return modelPricing[normalizedModel]
  }

  // Partial match (for models with prefixes/versions)
  for (const [pricingModel, pricing] of Object.entries(modelPricing)) {
    if (normalizedModel.includes(pricingModel.toLowerCase())) {
      return pricing
    }
  }

  // Default pricing if model not found
  return {
    input: 1.0,
    cachedInput: 0.5,
    output: 5.0,
    updatedAt: '2025-03-21',
  }
}

export default modelPricing
