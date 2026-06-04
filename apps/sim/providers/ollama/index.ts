import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import OpenAI from 'openai'
import { getOllamaUrl } from '@/lib/core/utils/urls'
import type { StreamingExecution } from '@/executor/types'
import { executeOllamaProviderRequest } from '@/providers/ollama/core'
import type { ModelsObject } from '@/providers/ollama/types'
import { createReadableStreamFromOllamaStream } from '@/providers/ollama/utils'
import type { ProviderConfig, ProviderRequest, ProviderResponse } from '@/providers/types'
import { useProvidersStore } from '@/stores/providers'

const logger = createLogger('OllamaProvider')
const OLLAMA_HOST = getOllamaUrl()

export const ollamaProvider: ProviderConfig = {
  id: 'ollama',
  name: 'Ollama',
  description: 'Local Ollama server for LLM inference',
  version: '1.0.0',
  models: [],
  defaultModel: '',

  async initialize() {
    if (typeof window !== 'undefined') {
      logger.info('Skipping Ollama initialization on client side to avoid CORS issues')
      return
    }

    try {
      const response = await fetch(`${OLLAMA_HOST}/api/tags`)
      if (!response.ok) {
        await response.text().catch(() => {})
        useProvidersStore.getState().setProviderModels('ollama', [])
        logger.warn('Ollama service is not available. The provider will be disabled.')
        return
      }
      const data = (await response.json()) as ModelsObject
      this.models = data.models.map((model) => model.name)
      useProvidersStore.getState().setProviderModels('ollama', this.models)
    } catch (error) {
      logger.warn('Ollama model instantiation failed. The provider will be disabled.', {
        error: getErrorMessage(error, 'Unknown error'),
      })
    }
  },

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    return executeOllamaProviderRequest(request, {
      providerId: 'ollama',
      providerLabel: 'Ollama',
      createClient: () =>
        new OpenAI({
          apiKey: 'empty',
          baseURL: `${OLLAMA_HOST}/v1`,
        }),
      createStream: createReadableStreamFromOllamaStream,
      logger,
    })
  },
}
