import { FunctionCallingConfigMode, type GenerateContentConfig, type Schema } from '@google/genai'
import { cleanSchemaForGemini } from '@/providers/google/utils'
import type { ProviderRequest } from '@/providers/types'
import { isGemini3OrLaterModel } from '@/providers/utils'

/** Applies the response schema only on turns that can accept it alongside their tool configuration. */
export function applyGeminiResponseFormat(
  config: GenerateContentConfig,
  responseFormat: ProviderRequest['responseFormat'],
  model: string
): void {
  if (!responseFormat) return

  if (config.toolConfig?.functionCallingConfig?.mode === FunctionCallingConfigMode.ANY) {
    config.responseMimeType = undefined
    config.responseSchema = undefined
    config.responseJsonSchema = undefined
    return
  }

  if (config.tools?.length && !isGemini3OrLaterModel(model)) return

  config.responseMimeType = 'application/json'
  if (isGemini3OrLaterModel(model)) {
    config.responseJsonSchema = responseFormat.schema
  } else {
    config.responseSchema = cleanSchemaForGemini(responseFormat.schema) as Schema
  }
}
