import Anthropic from '@anthropic-ai/sdk'
import { createLogger } from '@sim/logger'
import type { StreamingExecution } from '@/executor/types'
import { executeAnthropicProviderRequest } from '@/providers/anthropic/core'
import { getCachedProviderClient } from '@/providers/client-cache'
import { createKieFetch } from '@/providers/kie/transport'
import {
  getKieResponsesEndpoint,
  getKieWireModel,
  isKieClaudeModel,
  KIE_CLAUDE_BASE_URL,
} from '@/providers/kie/utils'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import { executeResponsesProviderRequest } from '@/providers/openai/core'
import { PROVIDER_MAX_RETRIES } from '@/providers/transport'
import type { ProviderConfig, ProviderRequest, ProviderResponse } from '@/providers/types'

const logger = createLogger('KieProvider')
const kieFetch = createKieFetch()

export const kieProvider: ProviderConfig = {
  id: 'kie',
  name: 'Kie',
  description: 'Claude, GPT, Grok, and Kimi models through the Kie.ai API',
  version: '1.0.0',
  models: getProviderModels('kie'),
  defaultModel: getProviderDefaultModel('kie'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    if (!request.apiKey) {
      throw new Error('API key is required for Kie')
    }

    if (isKieClaudeModel(request.model)) {
      return executeAnthropicProviderRequest(request, {
        providerId: 'kie',
        providerLabel: 'Kie',
        resolveWireModel: ({ model }) => getKieWireModel(model),
        // Kie authenticates its Claude proxy with a bearer token, not `x-api-key`.
        createClient: (apiKey) =>
          getCachedProviderClient(
            `kie::${apiKey}`,
            () =>
              new Anthropic({
                baseURL: KIE_CLAUDE_BASE_URL,
                apiKey: null,
                authToken: apiKey,
                maxRetries: PROVIDER_MAX_RETRIES,
                fetch: kieFetch,
              })
          ),
        logger,
      })
    }

    const endpoint = getKieResponsesEndpoint(request.model)
    if (!endpoint) {
      throw new Error(`Kie does not serve model ${request.model}`)
    }

    return executeResponsesProviderRequest(request, {
      providerId: 'kie',
      providerLabel: 'Kie',
      modelName: getKieWireModel(request.model),
      capabilityModel: request.model,
      endpoint,
      headers: {
        Authorization: `Bearer ${request.apiKey}`,
        'Content-Type': 'application/json',
      },
      logger,
      fetch: kieFetch,
    })
  },
}
