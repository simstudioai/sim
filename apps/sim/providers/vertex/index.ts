import { GoogleGenAI } from '@google/genai'
import { createLogger } from '@sim/logger'
import { OAuth2Client } from 'google-auth-library'
import { env } from '@/lib/core/config/env'
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
 * - Uses OAuth access token passed via googleAuthOptions.authClient
 * - Token refresh is handled at the OAuth layer before calling this provider
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

    // Create an OAuth2Client and set the access token
    // This allows us to use an OAuth access token with the SDK
    const authClient = new OAuth2Client()
    authClient.setCredentials({ access_token: request.apiKey })

    // Create client with Vertex AI configuration
    const ai = new GoogleGenAI({
      vertexai: true,
      project: vertexProject,
      location: vertexLocation,
      googleAuthOptions: {
        authClient,
      },
    })

    return executeGeminiRequest({
      ai,
      model,
      request,
      providerType: 'vertex',
    })
  },
}
