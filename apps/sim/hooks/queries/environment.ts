import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type ContractBodyInput,
  removeWorkspaceEnvironmentContract,
  savePersonalEnvironmentContract,
  upsertWorkspaceEnvironmentContract,
} from '@/lib/api/contracts'
import type { WorkspaceEnvironmentData } from '@/lib/environment/api'
import { fetchPersonalEnvironment, fetchWorkspaceEnvironment } from '@/lib/environment/api'

const logger = createLogger('EnvironmentQueries')

/**
 * Query key factories for environment variable queries
 */
export const environmentKeys = {
  all: ['environment'] as const,
  personal: () => [...environmentKeys.all, 'personal'] as const,
  workspaces: () => [...environmentKeys.all, 'workspace'] as const,
  workspace: (workspaceId: string) => [...environmentKeys.workspaces(), workspaceId] as const,
}

/**
 * Hook to fetch personal environment variables
 */
export function usePersonalEnvironment() {
  return useQuery({
    queryKey: environmentKeys.personal(),
    queryFn: ({ signal }) => fetchPersonalEnvironment(signal),
    staleTime: 60 * 1000,
  })
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
    queryFn: ({ signal }) => fetchWorkspaceEnvironment(workspaceId, signal),
    enabled: !!workspaceId,
    staleTime: 60 * 1000, // 1 minute
    placeholderData: keepPreviousData,
    ...options,
  })
}

/**
 * Save personal environment variables mutation
 */
type SavePersonalEnvironmentParams = ContractBodyInput<typeof savePersonalEnvironmentContract>

export function useSavePersonalEnvironment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ variables }: SavePersonalEnvironmentParams) => {
      await requestJson(savePersonalEnvironmentContract, { body: { variables } })

      logger.info('Saved personal environment variables')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: environmentKeys.personal() })
      queryClient.invalidateQueries({ queryKey: environmentKeys.workspaces() })
    },
  })
}

/**
 * Upsert workspace environment variables mutation
 */
type UpsertWorkspaceEnvironmentParams = { workspaceId: string } & ContractBodyInput<
  typeof upsertWorkspaceEnvironmentContract
>

export function useUpsertWorkspaceEnvironment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, variables }: UpsertWorkspaceEnvironmentParams) => {
      const data = await requestJson(upsertWorkspaceEnvironmentContract, {
        params: { id: workspaceId },
        body: { variables },
      })
      logger.info(`Upserted workspace environment variables for workspace: ${workspaceId}`)
      return data
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: environmentKeys.workspace(variables.workspaceId),
      })
    },
  })
}

/**
 * Remove workspace environment variables mutation
 */
type RemoveWorkspaceEnvironmentParams = { workspaceId: string } & ContractBodyInput<
  typeof removeWorkspaceEnvironmentContract
>

export function useRemoveWorkspaceEnvironment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, keys }: RemoveWorkspaceEnvironmentParams) => {
      const data = await requestJson(removeWorkspaceEnvironmentContract, {
        params: { id: workspaceId },
        body: { keys },
      })
      logger.info(`Removed ${keys.length} workspace environment keys for workspace: ${workspaceId}`)
      return data
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: environmentKeys.workspace(variables.workspaceId),
      })
    },
  })
}
