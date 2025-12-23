import { GoogleGenAI } from '@google/genai'
import { env } from '@/lib/core/config/env'
import { createLogger } from '@/lib/logs/console/logger'
import type { StreamingExecution } from '@/executor/types'
import { executeGeminiRequest } from '@/providers/gemini/core'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import type { ProviderConfig, ProviderRequest, ProviderResponse } from '@/providers/types'

const logger = createLogger('VertexProvider')

/**
 * Vertex AI provider
 *
 * Uses the @google/genai SDK with Vertex AI backend and OAuth authentication.
 * Shares core execution logic with Google Gemini provider.
 *
 * Authentication:
 * - Uses OAuth access token (from `gcloud auth print-access-token` or service account)
 * - Token refresh should be handled at the OAuth layer before calling this provider
 * - Access token is passed via HTTP Authorization header
 */
export const vertexProvider: ProviderConfig = {
  id: 'vertex',
  name: 'Vertex AI',
  description: "Google's Vertex AI platform for Gemini models",
  version: '1.0.0',
  models: getProviderModels('vertex'),
  defaultModel: getProviderDefaultModel('vertex'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    const vertexProject = env.VERTEX_PROJECT || request.vertexProject
    const vertexLocation = env.VERTEX_LOCATION || request.vertexLocation || 'us-central1'

    if (!vertexProject) {
      throw new Error(
        'Vertex AI project is required. Please provide it via VERTEX_PROJECT environment variable or vertexProject parameter.'
      )
    }

    if (!request.apiKey) {
      throw new Error(
        'Access token is required for Vertex AI. Run `gcloud auth print-access-token` to get one, or use a service account.'
      )
    }

    // Strip 'vertex/' prefix from model name if present
    const model = request.model.replace('vertex/', '')

    logger.info('Creating Vertex AI client', {
      project: vertexProject,
      location: vertexLocation,
      model,
    })

    // Create client with Vertex AI configuration
    // Pass access token via HTTP Authorization header
    const ai = new GoogleGenAI({
      vertexai: true,
      project: vertexProject,
      location: vertexLocation,
      httpOptions: {
        headers: {
          Authorization: `Bearer ${request.apiKey}`,
        },
      },
    })

    // Use shared execution logic
    return executeGeminiRequest({
      ai,
      model,
      request,
      providerType: 'vertex',
    })
  },
}
