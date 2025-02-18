import { MODEL_TOOLS, ModelType } from '@/blocks/consts'
import { ProviderId } from './registry'

/**
 * Determines the provider ID based on the model name.
 * Uses the existing MODEL_TOOLS mapping and falls back to pattern matching if needed.
 *
 * @param model - The model name/identifier
 * @returns The corresponding provider ID
 */
export function getProviderFromModel(model: string): ProviderId {
  const normalizedModel = model.toLowerCase()

  // First try to match exactly from our MODEL_TOOLS mapping
  if (normalizedModel in MODEL_TOOLS) {
    const toolId = MODEL_TOOLS[normalizedModel as ModelType]
    // Extract provider ID from tool ID (e.g., 'openai_chat' -> 'openai')
    return toolId.split('_')[0] as ProviderId
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
