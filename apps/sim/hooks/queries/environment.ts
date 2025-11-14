import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createLogger } from '@/lib/logs/console/logger'
import { API_ENDPOINTS } from '@/stores/constants'

const logger = createLogger('EnvironmentQueries')

/**
 * Query key factories for environment variable queries
 */
export const environmentKeys = {
  all: ['environment'] as const,
  personal: () => [...environmentKeys.all, 'personal'] as const,
  workspace: (workspaceId: string) => [...environmentKeys.all, 'workspace', workspaceId] as const,
}

/**
 * Environment Variable Types
 */
export interface EnvironmentVariable {
  key: string
  value: string
}

export interface WorkspaceEnvironmentData {
  workspace: Record<string, string>
  personal: Record<string, string>
  conflicts: string[]
}

/**
 * Fetch personal environment variables
 */
async function fetchPersonalEnvironment(): Promise<Record<string, EnvironmentVariable>> {
  const response = await fetch(API_ENDPOINTS.ENVIRONMENT)

  if (!response.ok) {
    throw new Error(`Failed to load environment variables: ${response.statusText}`)
  }

  const { data } = await response.json()

  if (data && typeof data === 'object') {
    return data
  }

  return {}
}

/**
 * Hook to fetch personal environment variables
 */
export function usePersonalEnvironment() {
  return useQuery({
    queryKey: environmentKeys.personal(),
    queryFn: fetchPersonalEnvironment,
    staleTime: 60 * 1000, // 1 minute
    placeholderData: keepPreviousData,
  })
}

/**
 * Fetch workspace environment variables
 */
async function fetchWorkspaceEnvironment(workspaceId: string): Promise<WorkspaceEnvironmentData> {
  const response = await fetch(API_ENDPOINTS.WORKSPACE_ENVIRONMENT(workspaceId))

  if (!response.ok) {
    throw new Error(`Failed to load workspace environment: ${response.statusText}`)
  }

  const { data } = await response.json()

  return {
    workspace: data.workspace || {},
    personal: data.personal || {},
    conflicts: data.conflicts || [],
  }
}

/**
 * Hook to fetch workspace environment variables
 */
export function useWorkspaceEnvironment<TData = WorkspaceEnvironmentData>(
  workspaceId: string,
  options?: { select?: (data: WorkspaceEnvironmentData) => TData }
) {
  return useQuery({
    queryKey: environmentKeys.workspace(workspaceId),
    queryFn: () => fetchWorkspaceEnvironment(workspaceId),
    enabled: !!workspaceId,
    staleTime: 60 * 1000, // 1 minute
    placeholderData: keepPreviousData,
    ...options,
  })
}

/**
 * Save personal environment variables mutation
 */
interface SavePersonalEnvironmentParams {
  variables: Record<string, string>
}

export function useSavePersonalEnvironment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ variables }: SavePersonalEnvironmentParams) => {
      const transformedVariables = Object.entries(variables).reduce(
        (acc, [key, value]) => ({
          ...acc,
          [key]: { key, value },
        }),
        {}
      )

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

      logger.info('Saved personal environment variables')
      return transformedVariables
    },
    onSuccess: () => {
      // Invalidate personal environment queries
      queryClient.invalidateQueries({ queryKey: environmentKeys.personal() })
      // Invalidate all workspace environments as they may have conflicts
      queryClient.invalidateQueries({ queryKey: environmentKeys.all })
    },
  })
}

/**
 * Upsert workspace environment variables mutation
 */
interface UpsertWorkspaceEnvironmentParams {
  workspaceId: string
  variables: Record<string, string>
}

export function useUpsertWorkspaceEnvironment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, variables }: UpsertWorkspaceEnvironmentParams) => {
      const response = await fetch(API_ENDPOINTS.WORKSPACE_ENVIRONMENT(workspaceId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variables }),
      })

      if (!response.ok) {
        throw new Error(`Failed to update workspace environment: ${response.statusText}`)
      }

      logger.info(`Upserted workspace environment variables for workspace: ${workspaceId}`)
      return await response.json()
    },
    onSuccess: (_data, variables) => {
      // Invalidate workspace environment
      queryClient.invalidateQueries({
        queryKey: environmentKeys.workspace(variables.workspaceId),
      })
      // Invalidate personal environment as conflicts may have changed
      queryClient.invalidateQueries({ queryKey: environmentKeys.personal() })
    },
  })
}

/**
 * Remove workspace environment variables mutation
 */
interface RemoveWorkspaceEnvironmentParams {
  workspaceId: string
  keys: string[]
}

export function useRemoveWorkspaceEnvironment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, keys }: RemoveWorkspaceEnvironmentParams) => {
      const response = await fetch(API_ENDPOINTS.WORKSPACE_ENVIRONMENT(workspaceId), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys }),
      })

      if (!response.ok) {
        throw new Error(`Failed to remove workspace environment keys: ${response.statusText}`)
      }

      logger.info(`Removed ${keys.length} workspace environment keys for workspace: ${workspaceId}`)
      return await response.json()
    },
    onSuccess: (_data, variables) => {
      // Invalidate workspace environment
      queryClient.invalidateQueries({
        queryKey: environmentKeys.workspace(variables.workspaceId),
      })
      // Invalidate personal environment as conflicts may have changed
      queryClient.invalidateQueries({ queryKey: environmentKeys.personal() })
    },
  })
}
