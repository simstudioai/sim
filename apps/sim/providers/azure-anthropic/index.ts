import Anthropic from '@anthropic-ai/sdk'
import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'
import { createPinnedFetch, validateUrlWithDNS } from '@/lib/core/security/input-validation.server'
import type { StreamingExecution } from '@/executor/types'
import { executeAnthropicProviderRequest } from '@/providers/anthropic/core'
import { getCachedProviderClient } from '@/providers/client-cache'
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

    let pinnedFetch: typeof fetch | undefined
    let pinnedIP: string | undefined
    if (userProvidedEndpoint) {
      const validation = await validateUrlWithDNS(userProvidedEndpoint, 'azureEndpoint')
      if (!validation.isValid) {
        logger.warn('Blocked SSRF attempt via azureEndpoint', {
          endpoint: userProvidedEndpoint,
          error: validation.error,
        })
        throw new Error(`Invalid Azure Anthropic endpoint: ${validation.error}`)
      }
      if (!validation.resolvedIP) {
        throw new Error('Invalid Azure Anthropic endpoint: could not resolve a pinnable IP address')
      }
      pinnedIP = validation.resolvedIP
      pinnedFetch = createPinnedFetch(pinnedIP)
    }

    const apiKey = request.apiKey
    if (!apiKey) {
      throw new Error('API key is required for Azure Anthropic.')
    }

    const normalizedEndpoint = azureEndpoint.replace(/\/$/, '')
    const baseURL = normalizedEndpoint.endsWith('/anthropic')
      ? normalizedEndpoint
      : `${normalizedEndpoint}/anthropic`

    const anthropicVersion =
      request.azureApiVersion || env.AZURE_ANTHROPIC_API_VERSION || '2023-06-01'

    return executeAnthropicProviderRequest(request, {
      providerId: 'azure-anthropic',
      providerLabel: 'Azure Anthropic',
      resolveWireModel: ({ model }) => model.replace(/^azure-anthropic\//, ''),
      createClient: (apiKey) => {
        const cacheKey = [
          'azure-anthropic',
          apiKey,
          baseURL,
          anthropicVersion,
          pinnedIP ?? 'no-pin',
        ].join('::')
        return getCachedProviderClient(
          cacheKey,
          () =>
            new Anthropic({
              baseURL,
              apiKey,
              ...(pinnedFetch ? { fetch: pinnedFetch } : {}),
              defaultHeaders: {
                'anthropic-version': anthropicVersion,
              },
            })
        )
      },
      logger,
    })
  },
}
