'use client'

import { useEffect } from 'react'
import { createLogger } from '@sim/logger'
import { useParams } from 'next/navigation'
import { useProviderModels } from '@/hooks/queries/providers'
import {
  updateFireworksProviderModels,
  updateOllamaProviderModels,
  updateOpenRouterProviderModels,
  updateVLLMProviderModels,
} from '@/providers/utils'
import { type ProviderName, useProvidersStore } from '@/stores/providers'

const logger = createLogger('ProviderModelsLoader')

function useSyncProvider(provider: ProviderName, workspaceId?: string) {
  const setProviderModels = useProvidersStore((state) => state.setProviderModels)
  const setProviderLoading = useProvidersStore((state) => state.setProviderLoading)
  const setOpenRouterModelInfo = useProvidersStore((state) => state.setOpenRouterModelInfo)
  const { data, isLoading, isFetching, error } = useProviderModels(provider, workspaceId)

  useEffect(() => {
    setProviderLoading(provider, isLoading || isFetching)
  }, [provider, isLoading, isFetching, setProviderLoading])

  useEffect(() => {
    if (!data) return

    try {
      if (provider === 'ollama') {
        updateOllamaProviderModels(data.models)
      } else if (provider === 'vllm') {
        updateVLLMProviderModels(data.models)
      } else if (provider === 'openrouter') {
        void updateOpenRouterProviderModels(data.models)
        if (data.modelInfo) {
          setOpenRouterModelInfo(data.modelInfo)
        }
      } else if (provider === 'fireworks') {
        void updateFireworksProviderModels(data.models)
      }
    } catch (syncError) {
      logger.warn(`Failed to sync provider definitions for ${provider}`, syncError as Error)
    }

    setProviderModels(provider, data.models)
  }, [provider, data, setProviderModels, setOpenRouterModelInfo])

  useEffect(() => {
    if (error) {
      logger.error(`Failed to load ${provider} models`, error)
    }
  }, [provider, error])
}

export function ProviderModelsLoader() {
  const params = useParams()
  const workspaceId = params?.workspaceId as string | undefined

  useSyncProvider('base')
  useSyncProvider('ollama')
  useSyncProvider('vllm')
  useSyncProvider('openrouter')
  useSyncProvider('fireworks', workspaceId)
  return null
}
