import { create } from 'zustand'
import { createLogger } from '@/lib/logs/console/logger'
import { API_ENDPOINTS } from '@/stores/constants'
import type { EnvironmentStore, EnvironmentVariable } from '@/stores/settings/environment/types'

const logger = createLogger('EnvironmentStore')

export const useEnvironmentStore = create<EnvironmentStore>()((set, get) => ({
  variables: {},
  isLoading: false,
  error: null,

  loadEnvironmentVariables: async () => {
    try {
      set({ isLoading: true, error: null })

      const response = await fetch(API_ENDPOINTS.ENVIRONMENT)

      if (!response.ok) {
        throw new Error(`Failed to load environment variables: ${response.statusText}`)
      }

      const { data } = await response.json()

      if (data && typeof data === 'object') {
        set({
          variables: data,
          isLoading: false,
        })
      } else {
        set({
          variables: {},
          isLoading: false,
        })
      }
    } catch (error) {
      logger.error('Error loading environment variables:', { error })
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      })
    }
  },

  saveEnvironmentVariables: async (variables: Record<string, string>) => {
    try {
      set({ isLoading: true, error: null })

      const transformedVariables = Object.entries(variables).reduce(
        (acc, [key, value]) => ({
          ...acc,
          [key]: { key, value },
        }),
        {}
      )

      set({ variables: transformedVariables })

      const response = await fetch(API_ENDPOINTS.ENVIRONMENT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          variables: Object.entries(transformedVariables).reduce(
            (acc, [key, value]) => ({
              ...acc,
              [key]: (value as EnvironmentVariable).value,
            }),
            {}
          ),
        }),
      })

      if (!response.ok) {
        throw new Error(`Failed to save environment variables: ${response.statusText}`)
      }

      set({ isLoading: false })
    } catch (error) {
      logger.error('Error saving environment variables:', { error })
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      })

      get().loadEnvironmentVariables()
    }
  },

  loadWorkspaceEnvironment: async (workspaceId: string) => {
    try {
      set({ isLoading: true, error: null })

      const response = await fetch(API_ENDPOINTS.WORKSPACE_ENVIRONMENT(workspaceId))
      if (!response.ok) {
        throw new Error(`Failed to load workspace environment: ${response.statusText}`)
      }

      const { data } = await response.json()
      set({ isLoading: false })
      return data as {
        workspace: Record<string, string>
        personal: Record<string, string>
        conflicts: string[]
      }
    } catch (error) {
      logger.error('Error loading workspace environment:', { error })
      set({ error: error instanceof Error ? error.message : 'Unknown error', isLoading: false })
      return { workspace: {}, personal: {}, conflicts: [] }
    }
  },

  upsertWorkspaceEnvironment: async (workspaceId: string, variables: Record<string, string>) => {
    try {
      set({ isLoading: true, error: null })
      const response = await fetch(API_ENDPOINTS.WORKSPACE_ENVIRONMENT(workspaceId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variables }),
      })
      if (!response.ok) {
        throw new Error(`Failed to update workspace environment: ${response.statusText}`)
      }
      set({ isLoading: false })
    } catch (error) {
      logger.error('Error updating workspace environment:', { error })
      set({ error: error instanceof Error ? error.message : 'Unknown error', isLoading: false })
    }
  },

  removeWorkspaceEnvironmentKeys: async (workspaceId: string, keys: string[]) => {
    try {
      set({ isLoading: true, error: null })
      const response = await fetch(API_ENDPOINTS.WORKSPACE_ENVIRONMENT(workspaceId), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys }),
      })
      if (!response.ok) {
        throw new Error(`Failed to remove workspace environment keys: ${response.statusText}`)
      }
      set({ isLoading: false })
    } catch (error) {
      logger.error('Error removing workspace environment keys:', { error })
      set({ error: error instanceof Error ? error.message : 'Unknown error', isLoading: false })
    }
  },

  getAllVariables: (): Record<string, EnvironmentVariable> => {
    return get().variables
  },
}))
