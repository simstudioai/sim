import { create } from 'zustand'
import { createLogger } from '@/lib/logs/console/logger'
import { withOptimisticUpdate } from '@/lib/utils'
import { API_ENDPOINTS } from '@/stores/constants'
import type {
  CachedWorkspaceEnvData,
  EnvironmentStore,
  EnvironmentVariable,
} from '@/stores/settings/environment/types'

const logger = createLogger('EnvironmentStore')

export const useEnvironmentStore = create<EnvironmentStore>()((set, get) => ({
  variables: {},
  isLoading: false,
  error: null,
  workspaceEnvCache: new Map<string, CachedWorkspaceEnvData>(),

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
    const transformedVariables = Object.entries(variables).reduce(
      (acc, [key, value]) => ({
        ...acc,
        [key]: { key, value },
      }),
      {}
    )

    await withOptimisticUpdate({
      getCurrentState: () => get().variables,
      optimisticUpdate: () => {
        set({ variables: transformedVariables, isLoading: true, error: null })
      },
      apiCall: async () => {
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

        get().clearWorkspaceEnvCache()
      },
      rollback: (originalVariables) => {
        set({ variables: originalVariables })
      },
      onComplete: () => {
        set({ isLoading: false })
      },
      errorMessage: 'Error saving environment variables',
    })
  },

  loadWorkspaceEnvironment: async (workspaceId: string) => {
    const cached = get().workspaceEnvCache.get(workspaceId)
    if (cached) {
      return {
        workspace: cached.workspace,
        personal: cached.personal,
        conflicts: cached.conflicts,
      }
    }

    try {
      set({ isLoading: true, error: null })

      const response = await fetch(API_ENDPOINTS.WORKSPACE_ENVIRONMENT(workspaceId))
      if (!response.ok) {
        throw new Error(`Failed to load workspace environment: ${response.statusText}`)
      }

      const { data } = await response.json()
      const envData = data as {
        workspace: Record<string, string>
        personal: Record<string, string>
        conflicts: string[]
      }

      const cache = new Map(get().workspaceEnvCache)
      cache.set(workspaceId, {
        ...envData,
        cachedAt: Date.now(),
      })
      set({ workspaceEnvCache: cache, isLoading: false })

      return envData
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

      get().clearWorkspaceEnvCache(workspaceId)
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

      get().clearWorkspaceEnvCache(workspaceId)
    } catch (error) {
      logger.error('Error removing workspace environment keys:', { error })
      set({ error: error instanceof Error ? error.message : 'Unknown error', isLoading: false })
    }
  },

  getAllVariables: (): Record<string, EnvironmentVariable> => {
    return get().variables
  },

  clearWorkspaceEnvCache: (workspaceId?: string) => {
    const cache = new Map(get().workspaceEnvCache)
    if (workspaceId) {
      cache.delete(workspaceId)
      set({ workspaceEnvCache: cache })
    } else {
      set({ workspaceEnvCache: new Map() })
    }
  },

  reset: () => {
    set({
      variables: {},
      isLoading: false,
      error: null,
      workspaceEnvCache: new Map(),
    })
  },
}))
