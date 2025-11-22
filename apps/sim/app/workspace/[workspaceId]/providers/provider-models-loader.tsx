'use client'

import { useEffect } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import { useProviderModels } from '@/hooks/queries/providers'
import {
  updateOllamaProviderModels,
  updateOpenRouterProviderModels,
  updateVLLMProviderModels,
} from '@/providers/utils'
import { useProvidersStore } from '@/stores/providers/store'
import type { ProviderName } from '@/stores/providers/types'

const logger = createLogger('ProviderModelsLoader')

function useSyncProvider(provider: ProviderName) {
  const setProviderModels = useProvidersStore((state) => state.setProviderModels)
  const setProviderLoading = useProvidersStore((state) => state.setProviderLoading)
  const { data, isLoading, isFetching, error } = useProviderModels(provider)

  useEffect(() => {
    setProviderLoading(provider, isLoading || isFetching)
  }, [provider, isLoading, isFetching, setProviderLoading])

  useEffect(() => {
    if (!data) return

    try {
      if (provider === 'ollama') {
        updateOllamaProviderModels(data)
      } else if (provider === 'vllm') {
        updateVLLMProviderModels(data)
      } else if (provider === 'openrouter') {
        void updateOpenRouterProviderModels(data)
      }
    } catch (syncError) {
      logger.warn(`Failed to sync provider definitions for ${provider}`, syncError as Error)
    }

    setProviderModels(provider, data)
  }, [provider, data, setProviderModels])

  useEffect(() => {
    if (error) {
      logger.error(`Failed to load ${provider} models`, error)
    }
  }, [provider, error])
}

export function ProviderModelsLoader() {
  useSyncProvider('base')
  useSyncProvider('ollama')
  useSyncProvider('vllm')
  useSyncProvider('openrouter')
  return null
}
