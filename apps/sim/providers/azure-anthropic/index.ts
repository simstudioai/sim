import Anthropic from '@anthropic-ai/sdk'
import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'
import { validateUrlWithDNS } from '@/lib/core/security/input-validation.server'
import type { StreamingExecution } from '@/executor/types'
import { executeAnthropicProviderRequest } from '@/providers/anthropic/core'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import type { ProviderConfig, ProviderRequest, ProviderResponse } from '@/providers/types'

const logger = createLogger('AzureAnthropicProvider')

export const azureAnthropicProvider: ProviderConfig = {
  id: 'azure-anthropic',
  name: 'Azure Anthropic',
  description: 'Anthropic Claude models via Azure AI Foundry',
  version: '1.0.0',
  models: getProviderModels('azure-anthropic'),
  defaultModel: getProviderDefaultModel('azure-anthropic'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    const userProvidedEndpoint = request.azureEndpoint
    const azureEndpoint = userProvidedEndpoint || env.AZURE_ANTHROPIC_ENDPOINT
    if (!azureEndpoint) {
      throw new Error(
        'Azure endpoint is required for Azure Anthropic. Please provide it via the azureEndpoint parameter or AZURE_ANTHROPIC_ENDPOINT environment variable.'
      )
    }

    if (userProvidedEndpoint) {
      const validation = await validateUrlWithDNS(userProvidedEndpoint, 'azureEndpoint')
      if (!validation.isValid) {
        logger.warn('Blocked SSRF attempt via azureEndpoint', {
          endpoint: userProvidedEndpoint,
          error: validation.error,
        })
        throw new Error(`Invalid Azure Anthropic endpoint: ${validation.error}`)
      }
    }

    const apiKey = request.apiKey
    if (!apiKey) {
      throw new Error('API key is required for Azure Anthropic.')
    }

    // Strip the azure-anthropic/ prefix from the model name if present
    const modelName = request.model.replace(/^azure-anthropic\//, '')

    // Azure AI Foundry hosts Anthropic models at {endpoint}/anthropic
    // The SDK appends /v1/messages automatically
    const baseURL = `${azureEndpoint.replace(/\/$/, '')}/anthropic`

    const anthropicVersion =
      request.azureApiVersion || env.AZURE_ANTHROPIC_API_VERSION || '2023-06-01'

    return executeAnthropicProviderRequest(
      {
        ...request,
        model: modelName,
        apiKey,
      },
      {
        providerId: 'azure-anthropic',
        providerLabel: 'Azure Anthropic',
        createClient: (apiKey, useNativeStructuredOutputs) =>
          new Anthropic({
            baseURL,
            apiKey,
            defaultHeaders: {
              'api-key': apiKey,
              'anthropic-version': anthropicVersion,
              ...(useNativeStructuredOutputs
                ? { 'anthropic-beta': 'structured-outputs-2025-11-13' }
                : {}),
            },
          }),
        logger,
      }
    )
  },
}
