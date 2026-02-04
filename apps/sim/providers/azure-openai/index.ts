import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'
import type { StreamingExecution } from '@/executor/types'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import { executeResponsesProviderRequest } from '@/providers/openai/core'
import type { ProviderConfig, ProviderRequest, ProviderResponse } from '@/providers/types'

const logger = createLogger('AzureOpenAIProvider')

/**
 * Azure OpenAI provider configuration
 */
export const azureOpenAIProvider: ProviderConfig = {
  id: 'azure-openai',
  name: 'Azure OpenAI',
  description: 'Microsoft Azure OpenAI Service models',
  version: '1.0.0',
  models: getProviderModels('azure-openai'),
  defaultModel: getProviderDefaultModel('azure-openai'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    const azureEndpoint = request.azureEndpoint || env.AZURE_OPENAI_ENDPOINT
    const azureApiVersion =
      request.azureApiVersion || env.AZURE_OPENAI_API_VERSION || '2024-07-01-preview'

    if (!azureEndpoint) {
      throw new Error(
        'Azure OpenAI endpoint is required. Please provide it via azureEndpoint parameter or AZURE_OPENAI_ENDPOINT environment variable.'
      )
    }

    if (!request.apiKey) {
      throw new Error('API key is required for Azure OpenAI')
    }

    const deploymentName = request.model.replace('azure/', '')
    const apiUrl = `${azureEndpoint.replace(/\/$/, '')}/openai/v1/responses?api-version=${azureApiVersion}`

    return executeResponsesProviderRequest(request, {
      providerId: 'azure-openai',
      providerLabel: 'Azure OpenAI',
      modelName: deploymentName,
      endpoint: apiUrl,
      headers: {
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'responses=v1',
        'api-key': request.apiKey,
      },
      logger,
    })
  },
}
