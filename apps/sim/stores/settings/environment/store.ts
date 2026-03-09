import { createLogger } from '@sim/logger'
import { create } from 'zustand'
import { fetchPersonalEnvironment } from '@/lib/environment/api'
import type { EnvironmentStore, EnvironmentVariable } from './types'

const logger = createLogger('EnvironmentStore')

export const useEnvironmentStore = create<EnvironmentStore>()((set, get) => ({
  variables: {},
  isLoading: false,
  error: null,

  loadEnvironmentVariables: async () => {
    try {
      set({ isLoading: true, error: null })
      const data = await fetchPersonalEnvironment()
      set({ variables: data, isLoading: false })
    } catch (error) {
      logger.error('Error loading environment variables:', { error })
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      })
      throw error
    }
  },

  setVariables: (variables: Record<string, EnvironmentVariable>) => {
    set({ variables })
  },

  getAllVariables: () => {
    return get().variables
  },

  reset: () => {
    set({
      variables: {},
      isLoading: false,
      error: null,
    })
  },
}))
