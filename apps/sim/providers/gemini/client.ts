import { GoogleGenAI } from '@google/genai'
import { createLogger } from '@sim/logger'
import type { GeminiClientConfig } from './types'

const logger = createLogger('GeminiClient')

/**
 * Creates a GoogleGenAI client configured for either Google Gemini API or Vertex AI
 *
 * For Google Gemini API:
 *   - Uses API key authentication
 *
 * For Vertex AI:
 *   - Uses OAuth access token via HTTP Authorization header
 *   - Requires project and location
 */
export function createGeminiClient(config: GeminiClientConfig): GoogleGenAI {
  if (config.vertexai) {
    if (!config.project) {
      throw new Error('Vertex AI requires a project ID')
    }
    if (!config.accessToken) {
      throw new Error('Vertex AI requires an access token')
    }

    const location = config.location ?? 'us-central1'

    logger.info('Creating Vertex AI client', {
      project: config.project,
      location,
      hasAccessToken: !!config.accessToken,
    })

    // Create client with Vertex AI configuration
    // Use httpOptions.headers to pass the access token directly
    return new GoogleGenAI({
      vertexai: true,
      project: config.project,
      location,
      httpOptions: {
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
        },
      },
    })
  }

  // Google Gemini API with API key
  if (!config.apiKey) {
    throw new Error('Google Gemini API requires an API key')
  }

  logger.info('Creating Google Gemini client')

  return new GoogleGenAI({
    apiKey: config.apiKey,
  })
}
