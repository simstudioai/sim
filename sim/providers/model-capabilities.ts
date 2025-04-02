/**
 * This file defines model capabilities and constraints
 * It serves as a single source of truth for model-specific features
 */

// Models that support temperature with range 0-2
export const MODELS_TEMP_RANGE_0_2 = [
  // OpenAI models
  'gpt-4o',
  // Google models
  'gemini-2.0-flash',
  'gemini-2.5-pro-exp-03-25',
  // Deepseek models
  'deepseek-v3',
]

// Models that support temperature with range 0-1
export const MODELS_TEMP_RANGE_0_1 = [
  // Anthropic models
  'claude-3-5-sonnet-20240620',
  'claude-3-7-sonnet-20250219',
  // xAI models
  'grok-2-latest',
]

// All models that support temperature (combined list)
export const MODELS_WITH_TEMPERATURE_SUPPORT = [...MODELS_TEMP_RANGE_0_2, ...MODELS_TEMP_RANGE_0_1]

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
