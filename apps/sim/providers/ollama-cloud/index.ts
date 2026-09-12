import { createLogger } from '@sim/logger'
import OpenAI from 'openai'
import { createSsrfGuardedFetchWithDispatcher } from '@/lib/core/security/input-validation.server'
import type { StreamingExecution } from '@/executor/types'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import { executeOllamaProviderRequest } from '@/providers/ollama/core'
import { createReadableStreamFromOllamaCloudStream } from '@/providers/ollama-cloud/utils'
import { openAICompatTransport } from '@/providers/transport'
import type { ProviderConfig, ProviderRequest, ProviderResponse } from '@/providers/types'

let providerTransport: ReturnType<typeof createSsrfGuardedFetchWithDispatcher> | undefined

const logger = createLogger('OllamaCloudProvider')

/** Ollama Cloud OpenAI-compatible endpoint. BYOK only — Sim never hosts a key or bills usage. */
const OLLAMA_CLOUD_BASE_URL = 'https://ollama.com/v1'

export const ollamaCloudProvider: ProviderConfig = {
  id: 'ollama-cloud',
  name: 'Ollama Cloud',
  description: 'Hosted open-source models via Ollama Cloud (bring your own key)',
  version: '1.0.0',
  models: getProviderModels('ollama-cloud'),
  defaultModel: getProviderDefaultModel('ollama-cloud'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    const apiKey = request.apiKey
    if (!apiKey) {
      throw new Error('API key is required for Ollama Cloud')
    }

    const requestedModel = request.model.replace(/^ollama-cloud\//, '')

    return executeOllamaProviderRequest(
      { ...request, model: requestedModel },
      {
        providerId: 'ollama-cloud',
        providerLabel: 'Ollama Cloud',
        createClient: () =>
          new OpenAI({
            fetch: (providerTransport ??= createSsrfGuardedFetchWithDispatcher({
              profile: 'configuredEndpoint',
            })).fetch,
            ...openAICompatTransport(),
            apiKey,
            baseURL: OLLAMA_CLOUD_BASE_URL,
          }),
        createStream: createReadableStreamFromOllamaCloudStream,
        logger,
      }
    )
  },
}
