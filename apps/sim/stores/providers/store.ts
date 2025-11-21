import { create } from 'zustand'
import { createLogger } from '@/lib/logs/console/logger'
import type { ProvidersStore } from '@/stores/providers/types'

const logger = createLogger('ProvidersStore')

export const useProvidersStore = create<ProvidersStore>((set, get) => ({
  providers: {
    base: { models: [], isLoading: false },
    ollama: { models: [], isLoading: false },
    openrouter: { models: [], isLoading: false },
  },

  setProviderModels: (provider, models) => {
    logger.info(`Updated ${provider} models`, { count: models.length })
    set((state) => ({
      providers: {
        ...state.providers,
        [provider]: {
          ...state.providers[provider],
          models,
        },
      },
    }))
  },

  setProviderLoading: (provider, isLoading) => {
    set((state) => ({
      providers: {
        ...state.providers,
        [provider]: {
          ...state.providers[provider],
          isLoading,
        },
      },
    }))
  },

  getProvider: (provider) => {
    return get().providers[provider]
  },
}))
