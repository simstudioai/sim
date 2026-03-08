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

export const providerKeys = {
  all: ['provider-models'] as const,
  models: (provider: string) => [...providerKeys.all, provider] as const,
}

async function fetchProviderModels(
  provider: ProviderName,
  signal?: AbortSignal
): Promise<ProviderModelsResponse> {
  const response = await fetch(providerEndpoints[provider], { signal })

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
    queryKey: providerKeys.models(provider),
    queryFn: ({ signal }) => fetchProviderModels(provider, signal),
    staleTime: 5 * 60 * 1000,
  })
}
