/**
 * This file defines model capabilities and constraints
 * It serves as a single source of truth for model-specific features
 */

// Models that support temperature with range 0-2
export const MODELS_TEMP_RANGE_0_2 = [
  // OpenAI models
  'gpt-4o',
  // Google models
  'gemini-2.5-pro-exp-03-25',
  'gemini-2.5-flash-preview-04-17',
  // Deepseek models
  'deepseek-v3',
]

// Models that support temperature with range 0-1
export const MODELS_TEMP_RANGE_0_1 = [
  // Anthropic models
  'claude-sonnet-4-20250514',
  'claude-opus-4-20250514',
  'claude-3-7-sonnet-20250219',
  'claude-3-5-sonnet-20240620',
  // xAI models
  'grok-3-latest',
  'grok-3-fast-latest',
]

// All models that support temperature (combined list)
export const MODELS_WITH_TEMPERATURE_SUPPORT = [...MODELS_TEMP_RANGE_0_2, ...MODELS_TEMP_RANGE_0_1]

// Models and their providers that support tool usage control (force, auto, none)
export const PROVIDERS_WITH_TOOL_USAGE_CONTROL = ['openai', 'anthropic', 'deepseek', 'xai']

/**
 * Check if a model supports temperature parameter
 */
export function supportsTemperature(model: string): boolean {
  // Normalize model name for comparison
  const normalizedModel = model.toLowerCase()

  // Check if model is in the supported list
  return MODELS_WITH_TEMPERATURE_SUPPORT.some(
    (supportedModel) => supportedModel.toLowerCase() === normalizedModel
  )
}

/**
 * Get the maximum temperature value for a model
 * @returns Maximum temperature value (1 or 2) or undefined if temperature not supported
 */
export function getMaxTemperature(model: string): number | undefined {
  // Normalize model name for comparison
  const normalizedModel = model.toLowerCase()

  // Check if model is in the 0-2 range
  if (MODELS_TEMP_RANGE_0_2.some((m) => m.toLowerCase() === normalizedModel)) {
    return 2
  }

  // Check if model is in the 0-1 range
  if (MODELS_TEMP_RANGE_0_1.some((m) => m.toLowerCase() === normalizedModel)) {
    return 1
  }

  // Temperature not supported
  return undefined
}

/**
 * Check if a provider supports tool usage control
 */
export function supportsToolUsageControl(provider: string): boolean {
  return PROVIDERS_WITH_TOOL_USAGE_CONTROL.includes(provider)
}
