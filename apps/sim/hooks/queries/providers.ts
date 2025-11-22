import { useQuery } from '@tanstack/react-query'
import { createLogger } from '@/lib/logs/console/logger'
import type { ProviderName } from '@/stores/providers/types'

const logger = createLogger('ProviderModelsQuery')

const providerEndpoints: Record<ProviderName, string> = {
  base: '/api/providers/base/models',
  ollama: '/api/providers/ollama/models',
  vllm: '/api/providers/vllm/models',
  openrouter: '/api/providers/openrouter/models',
}

async function fetchProviderModels(provider: ProviderName): Promise<string[]> {
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

  return provider === 'openrouter' ? Array.from(new Set(models)) : models
}

export function useProviderModels(provider: ProviderName) {
  return useQuery({
    queryKey: ['provider-models', provider],
    queryFn: () => fetchProviderModels(provider),
    staleTime: 5 * 60 * 1000,
  })
}
