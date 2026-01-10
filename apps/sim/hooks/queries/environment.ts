import { useEffect } from 'react'
import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { WorkspaceEnvironmentData } from '@/lib/environment/api'
import { fetchPersonalEnvironment, fetchWorkspaceEnvironment } from '@/lib/environment/api'
import { API_ENDPOINTS } from '@/stores/constants'
import type { EnvironmentVariable } from '@/stores/settings/environment'
import { useEnvironmentStore } from '@/stores/settings/environment'

export type { WorkspaceEnvironmentData } from '@/lib/environment/api'
export type { EnvironmentVariable } from '@/stores/settings/environment'

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
/**
 * Hook to fetch personal environment variables
 */
export function usePersonalEnvironment() {
  const setVariables = useEnvironmentStore((state) => state.setVariables)

  const query = useQuery({
    queryKey: environmentKeys.personal(),
    queryFn: fetchPersonalEnvironment,
    staleTime: 60 * 1000, // 1 minute
    placeholderData: keepPreviousData,
  })

  useEffect(() => {
    if (query.data) {
      setVariables(query.data)
    }
  }, [query.data, setVariables])

  return query
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
      queryClient.invalidateQueries({ queryKey: environmentKeys.personal() })
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
      queryClient.invalidateQueries({
        queryKey: environmentKeys.workspace(variables.workspaceId),
      })
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
      queryClient.invalidateQueries({
        queryKey: environmentKeys.workspace(variables.workspaceId),
      })
      queryClient.invalidateQueries({ queryKey: environmentKeys.personal() })
    },
  })
}
