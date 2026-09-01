'use client'

import { useEffect } from 'react'
import { createLogger } from '@sim/logger'
import { useParams, usePathname } from 'next/navigation'
import { useProviderModels } from '@/hooks/queries/providers'
import {
  updateBasetenProviderModels,
  updateFireworksProviderModels,
  updateLiteLLMProviderModels,
  updateOllamaCloudProviderModels,
  updateOllamaProviderModels,
  updateOpenRouterProviderModels,
  updateTogetherProviderModels,
  updateVLLMProviderModels,
} from '@/providers/utils'
import { useSearchModalStore } from '@/stores/modals/search/store'
import { type ProviderName, useProvidersStore } from '@/stores/providers'

const logger = createLogger('ProviderModelsLoader')

function shouldLoadProviderModels(
  pathname: string | null,
  workspaceId: string | undefined,
  isSearchModalOpen: boolean
): boolean {
  if (!workspaceId) return false
  if (isSearchModalOpen) return true

  const workspaceBase = `/workspace/${workspaceId}`
  return (
    pathname === workspaceBase ||
    pathname === `${workspaceBase}/home` ||
    pathname === `${workspaceBase}/w` ||
    pathname?.startsWith(`${workspaceBase}/w/`) === true ||
    pathname === `${workspaceBase}/chat` ||
    pathname?.startsWith(`${workspaceBase}/chat/`) === true
  )
}

function useSyncProvider(provider: ProviderName, enabled: boolean, workspaceId?: string) {
  const setProviderModels = useProvidersStore((state) => state.setProviderModels)
  const setProviderLoading = useProvidersStore((state) => state.setProviderLoading)
  const setOpenRouterModelInfo = useProvidersStore((state) => state.setOpenRouterModelInfo)
  const { data, isLoading, isFetching, error } = useProviderModels(provider, workspaceId, {
    enabled,
  })

  useEffect(() => {
    setProviderLoading(provider, isLoading || isFetching)
  }, [provider, isLoading, isFetching, setProviderLoading])

  useEffect(() => {
    if (!data) return

    try {
      if (provider === 'ollama') {
        updateOllamaProviderModels(data.models)
      } else if (provider === 'ollama-cloud') {
        void updateOllamaCloudProviderModels(data.models)
      } else if (provider === 'vllm') {
        updateVLLMProviderModels(data.models)
      } else if (provider === 'litellm') {
        updateLiteLLMProviderModels(data.models)
      } else if (provider === 'openrouter') {
        void updateOpenRouterProviderModels(data.models)
        if (data.modelInfo) {
          setOpenRouterModelInfo(data.modelInfo)
        }
      } else if (provider === 'fireworks') {
        void updateFireworksProviderModels(data.models)
      } else if (provider === 'together') {
        void updateTogetherProviderModels(data.models)
      } else if (provider === 'baseten') {
        void updateBasetenProviderModels(data.models)
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
  const pathname = usePathname()
  const workspaceId = params?.workspaceId as string | undefined
  const isSearchModalOpen = useSearchModalStore((state) => state.isOpen)
  const shouldLoad = shouldLoadProviderModels(pathname, workspaceId, isSearchModalOpen)

  useSyncProvider('base', shouldLoad)
  useSyncProvider('ollama', shouldLoad)
  useSyncProvider('ollama-cloud', shouldLoad, workspaceId)
  useSyncProvider('vllm', shouldLoad)
  useSyncProvider('litellm', shouldLoad)
  useSyncProvider('openrouter', shouldLoad)
  useSyncProvider('fireworks', shouldLoad, workspaceId)
  useSyncProvider('together', shouldLoad, workspaceId)
  useSyncProvider('baseten', shouldLoad, workspaceId)
  return null
}
