import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getBaseProviderModelsContract,
  getBasetenProviderModelsContract,
  getFireworksProviderModelsContract,
  getLitellmProviderModelsContract,
  getOllamaCloudProviderModelsContract,
  getOllamaProviderModelsContract,
  getOpenRouterProviderModelsContract,
  getTogetherProviderModelsContract,
  getVllmProviderModelsContract,
  type ProviderModelsResponse,
} from '@/lib/api/contracts/providers'
import type { ProviderName } from '@/stores/providers'

const logger = createLogger('ProviderModelsQuery')

export const PROVIDER_MODELS_STALE_TIME = 5 * 60 * 1000

export const providerKeys = {
  all: ['provider-models'] as const,
  lists: () => [...providerKeys.all, 'list'] as const,
  list: (provider: string, workspaceId?: string) =>
    [...providerKeys.lists(), provider, workspaceId ?? ''] as const,
}

async function fetchProviderModels(
  provider: ProviderName,
  signal?: AbortSignal,
  workspaceId?: string
): Promise<ProviderModelsResponse> {
  try {
    const data = await requestProviderModels(provider, signal, workspaceId)
    const models: string[] = Array.isArray(data.models) ? data.models : []
    const uniqueModels = provider === 'openrouter' ? Array.from(new Set(models)) : models

    return {
      models: uniqueModels,
      modelInfo: data.modelInfo,
    }
  } catch (error) {
    logger.warn(`Failed to fetch ${provider} models`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    throw error
  }
}

async function requestProviderModels(
  provider: ProviderName,
  signal?: AbortSignal,
  workspaceId?: string
): Promise<ProviderModelsResponse> {
  switch (provider) {
    case 'base':
      return requestJson(getBaseProviderModelsContract, { signal })
    case 'ollama':
      return requestJson(getOllamaProviderModelsContract, { signal })
    case 'ollama-cloud':
      return requestJson(getOllamaCloudProviderModelsContract, {
        query: { workspaceId },
        signal,
      })
    case 'vllm':
      return requestJson(getVllmProviderModelsContract, { signal })
    case 'litellm':
      return requestJson(getLitellmProviderModelsContract, { signal })
    case 'openrouter':
      return requestJson(getOpenRouterProviderModelsContract, { signal })
    case 'fireworks':
      return requestJson(getFireworksProviderModelsContract, {
        query: { workspaceId },
        signal,
      })
    case 'together':
      return requestJson(getTogetherProviderModelsContract, {
        query: { workspaceId },
        signal,
      })
    case 'baseten':
      return requestJson(getBasetenProviderModelsContract, {
        query: { workspaceId },
        signal,
      })
  }
}

export function useProviderModels(provider: ProviderName, workspaceId?: string) {
  return useQuery({
    queryKey: providerKeys.list(provider, workspaceId),
    queryFn: ({ signal }) => fetchProviderModels(provider, signal, workspaceId),
    staleTime: PROVIDER_MODELS_STALE_TIME,
  })
}
