import { createLogger } from '@sim/logger'
import { create } from 'zustand'
import type { OpenRouterModelInfo, ProvidersStore } from './types'

const logger = createLogger('ProvidersStore')

export const useProvidersStore = create<ProvidersStore>((set, get) => ({
  providers: {
    base: { models: [], isLoading: false },
    ollama: { models: [], isLoading: false },
    vllm: { models: [], isLoading: false },
    openrouter: { models: [], isLoading: false },
  },
  openRouterModelInfo: {},

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

  setOpenRouterModelInfo: (modelInfo: Record<string, OpenRouterModelInfo>) => {
    const structuredOutputCount = Object.values(modelInfo).filter(
      (m) => m.supportsStructuredOutputs
    ).length
    logger.info('Updated OpenRouter model info', {
      count: Object.keys(modelInfo).length,
      withStructuredOutputs: structuredOutputCount,
    })
    set({ openRouterModelInfo: modelInfo })
  },

  getProvider: (provider) => {
    return get().providers[provider]
  },

  getOpenRouterModelInfo: (modelId: string) => {
    return get().openRouterModelInfo[modelId]
  },
}))
