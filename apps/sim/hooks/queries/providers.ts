import { createLogger } from '@sim/logger'
import { useQuery } from '@tanstack/react-query'
import type { OpenRouterModelInfo, ProviderName } from '@/stores/providers'

const logger = createLogger('ProviderModelsQuery')

const providerEndpoints: Record<ProviderName, string> = {
  base: '/api/providers/base/models',
  ollama: '/api/providers/ollama/models',
  vllm: '/api/providers/vllm/models',
  openrouter: '/api/providers/openrouter/models',
}

interface ProviderModelsResponse {
  models: string[]
  modelInfo?: Record<string, OpenRouterModelInfo>
}

async function fetchProviderModels(provider: ProviderName): Promise<ProviderModelsResponse> {
  const response = await fetch(providerEndpoints[provider])

  if (!response.ok) {
    logger.warn(`Failed to fetch ${provider} models`, {
      status: response.status,
      statusText: response.statusText,
    })
    throw new Error(`Failed to fetch ${provider} models`)
  }

  const data = await response.json()
  const models: string[] = Array.isArray(data.models) ? data.models : []
  const uniqueModels = provider === 'openrouter' ? Array.from(new Set(models)) : models

  return {
    models: uniqueModels,
    modelInfo: data.modelInfo,
  }
}

export function useProviderModels(provider: ProviderName) {
  return useQuery({
    queryKey: ['provider-models', provider],
    queryFn: () => fetchProviderModels(provider),
    staleTime: 5 * 60 * 1000,
  })
}
