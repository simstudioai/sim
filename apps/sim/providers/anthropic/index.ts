import Anthropic from '@anthropic-ai/sdk'
import { createLogger } from '@sim/logger'
import type { StreamingExecution } from '@/executor/types'
import { executeAnthropicProviderRequest } from '@/providers/anthropic/core'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import type { ProviderConfig, ProviderRequest, ProviderResponse } from '@/providers/types'

const logger = createLogger('AnthropicProvider')

export const anthropicProvider: ProviderConfig = {
  id: 'anthropic',
  name: 'Anthropic',
  description: "Anthropic's Claude models",
  version: '1.0.0',
  models: getProviderModels('anthropic'),
  defaultModel: getProviderDefaultModel('anthropic'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    return executeAnthropicProviderRequest(request, {
      providerId: 'anthropic',
      providerLabel: 'Anthropic',
      createClient: (apiKey, useNativeStructuredOutputs) =>
        new Anthropic({
          apiKey,
          defaultHeaders: useNativeStructuredOutputs
            ? { 'anthropic-beta': 'structured-outputs-2025-11-13' }
            : undefined,
        }),
      logger,
    })
  },
}
