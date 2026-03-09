import { GoogleGenAI } from '@google/genai'
import { createLogger } from '@sim/logger'
import type { StreamingExecution } from '@/executor/types'
import { executeGeminiRequest } from '@/providers/gemini/core'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import type { ProviderConfig, ProviderRequest, ProviderResponse } from '@/providers/types'

const logger = createLogger('GoogleProvider')

/**
 * Google Gemini provider
 *
 * Uses the @google/genai SDK with API key authentication.
 * Shares core execution logic with Vertex AI provider.
 */
export const googleProvider: ProviderConfig = {
  id: 'google',
  name: 'Google',
  description: "Google's Gemini models",
  version: '1.0.0',
  models: getProviderModels('google'),
  defaultModel: getProviderDefaultModel('google'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    if (!request.apiKey) {
      throw new Error('API key is required for Google Gemini')
    }

    logger.info('Creating Google Gemini client', { model: request.model })

    const ai = new GoogleGenAI({ apiKey: request.apiKey })

    return executeGeminiRequest({
      ai,
      model: request.model,
      request,
      providerType: 'google',
    })
  },
}
