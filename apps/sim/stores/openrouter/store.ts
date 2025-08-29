import { create } from 'zustand'
import { createLogger } from '@/lib/logs/console/logger'
import { updateOpenRouterProviderModels } from '@/providers/utils'
import type { OpenRouterStore } from '@/stores/openrouter/types'

const logger = createLogger('OpenRouterStore')

const fetchOpenRouterModels = async (): Promise<string[]> => {
  try {
    const response = await fetch('/api/providers/openrouter/models')
    if (!response.ok) {
      logger.warn('Failed to fetch OpenRouter models from API', {
        status: response.status,
        statusText: response.statusText,
      })
      return []
    }
    const data = await response.json()
    return data.models || []
  } catch (error) {
    logger.error('Error fetching OpenRouter models', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return []
  }
}

export const useOpenRouterStore = create<OpenRouterStore>((set, get) => ({
  models: [],
  isLoading: false,
  setModels: (models) => {
    const unique = Array.from(new Set(models))
    set({ models: unique })
    updateOpenRouterProviderModels(models)
  },

  fetchModels: async () => {
    if (typeof window === 'undefined') {
      logger.info('Skipping client-side model fetch on server')
      return
    }
    if (get().isLoading) {
      logger.info('Model fetch already in progress')
      return
    }
    logger.info('Fetching OpenRouter models from API')
    set({ isLoading: true })
    try {
      const models = await fetchOpenRouterModels()
      logger.info('Successfully fetched OpenRouter models', {
        count: models.length,
      })
      get().setModels(models)
    } catch (error) {
      logger.error('Failed to fetch OpenRouter models', {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      set({ isLoading: false })
    }
  },
}))

if (typeof window !== 'undefined') {
  setTimeout(() => {
    useOpenRouterStore.getState().fetchModels()
  }, 1000)
}
