import { ProviderId } from './registry'

/**
 * Direct mapping from model names to provider IDs
 */
export const MODEL_PROVIDERS: Record<string, ProviderId> = {
  'gpt-4o': 'openai',
  o1: 'openai',
  'o3-mini': 'openai',
  'claude-3-7-sonnet-20250219': 'anthropic',
  'gemini-2.0-flash': 'google',
  'grok-2-latest': 'xai',
  'deepseek-v3': 'deepseek',
  'deepseek-r1': 'deepseek',
  'llama-3.3-70b': 'cerebras',
}

/**
 * Determines the provider ID based on the model name.
 * Uses the MODEL_PROVIDERS mapping and falls back to pattern matching if needed.
 *
 * @param model - The model name/identifier
 * @returns The corresponding provider ID
 */
export function getProviderFromModel(model: string): ProviderId {
  const normalizedModel = model.toLowerCase()

  // First try to match exactly from our MODEL_PROVIDERS mapping
  if (normalizedModel in MODEL_PROVIDERS) {
    return MODEL_PROVIDERS[normalizedModel]
  }

  // If no exact match, use pattern matching as fallback
  if (normalizedModel.startsWith('gpt') || normalizedModel.startsWith('o1')) {
    return 'openai'
  }

  if (normalizedModel.startsWith('claude')) {
    return 'anthropic'
  }

  if (normalizedModel.startsWith('gemini')) {
    return 'google'
  }

  if (normalizedModel.startsWith('grok')) {
    return 'xai'
  }

  if (normalizedModel.startsWith('llama')) {
    return 'cerebras'
  }

  // Default to deepseek for any other models
  return 'deepseek'
}

export function extractAndParseJSON(content: string): any {
  // First clean up the string
  const trimmed = content.trim()

  // Find the first '{' and last '}'
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')

  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error('No JSON object found in content')
  }

  // Extract just the JSON part
  const jsonStr = trimmed.slice(firstBrace, lastBrace + 1)

  try {
    return JSON.parse(jsonStr)
  } catch (error) {
    // If parsing fails, try to clean up common issues
    const cleaned = jsonStr
      .replace(/\n/g, ' ') // Remove newlines
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/,\s*([}\]])/g, '$1') // Remove trailing commas

    try {
      return JSON.parse(cleaned)
    } catch (innerError) {
      console.error('Original content:', content)
      console.error('Extracted JSON:', jsonStr)
      console.error('Cleaned JSON:', cleaned)
      throw new Error(
        `Failed to parse JSON after cleanup: ${innerError instanceof Error ? innerError.message : 'Unknown error'}`
      )
    }
  }
}
