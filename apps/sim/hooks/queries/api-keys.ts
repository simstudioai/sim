import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import type { ContractBodyInput } from '@/lib/api/contracts'
import {
  type ApiKey,
  createPersonalApiKeyContract,
  createWorkspaceApiKeyContract,
  deletePersonalApiKeyContract,
  deleteWorkspaceApiKeyContract,
  listPersonalApiKeysContract,
  listWorkspaceApiKeysContract,
  updateWorkspaceContract,
} from '@/lib/api/contracts'
import { workspaceKeys } from '@/hooks/queries/workspace'

export type { ApiKey }

/**
 * Query key factories for API keys-related queries
 */
export const apiKeysKeys = {
  all: ['apiKeys'] as const,
  workspaces: () => [...apiKeysKeys.all, 'workspace'] as const,
  workspace: (workspaceId: string) => [...apiKeysKeys.workspaces(), workspaceId] as const,
  personal: () => [...apiKeysKeys.all, 'personal'] as const,
  combineds: () => [...apiKeysKeys.all, 'combined'] as const,
  combined: (workspaceId: string) => [...apiKeysKeys.combineds(), workspaceId] as const,
}

export const API_KEYS_COMBINED_STALE_TIME = 60 * 1000

type CombinedApiKeysData = {
  workspaceKeys: ApiKey[]
  personalKeys: ApiKey[]
  conflicts: string[]
}

/**
 * Fetch both workspace and personal API keys
 */
async function fetchApiKeys(
  workspaceId: string,
  signal?: AbortSignal
): Promise<CombinedApiKeysData> {
  const [workspaceData, personalData] = await Promise.all([
    requestJson(listWorkspaceApiKeysContract, { params: { id: workspaceId }, signal }),
    requestJson(listPersonalApiKeysContract, { signal }),
  ])
  const workspaceKeys: ApiKey[] = workspaceData.keys
  const personalKeys: ApiKey[] = personalData.keys

  const workspaceKeyNames = new Set(workspaceKeys.map((k) => k.name))
  const conflicts = personalKeys
    .filter((key) => workspaceKeyNames.has(key.name))
    .map((key) => key.name)

  return {
    workspaceKeys,
    personalKeys,
    conflicts,
  }
}

/**
 * Hook to fetch API keys (both workspace and personal)
 */
export function useApiKeys(workspaceId: string) {
  return useQuery({
    queryKey: apiKeysKeys.combined(workspaceId),
    queryFn: ({ signal }) => fetchApiKeys(workspaceId, signal),
    enabled: !!workspaceId,
    staleTime: API_KEYS_COMBINED_STALE_TIME,
    placeholderData: keepPreviousData,
  })
}

/**
 * Create API key mutation params
 */
type CreateApiKeyParams = {
  workspaceId: string
  keyType: 'personal' | 'workspace'
} & ContractBodyInput<typeof createWorkspaceApiKeyContract>

/**
 * Hook to create a new API key
 */
export function useCreateApiKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, name, keyType, source }: CreateApiKeyParams) => {
      if (keyType === 'workspace') {
        return requestJson(createWorkspaceApiKeyContract, {
          params: { id: workspaceId },
          body: { name, source },
        })
      }

      return requestJson(createPersonalApiKeyContract, { body: { name } })
    },
    onSettled: (_data, _error, variables) => {
      return queryClient.invalidateQueries({
        queryKey: apiKeysKeys.combined(variables.workspaceId),
      })
    },
  })
}

/**
 * Delete API key mutation params
 */
type DeleteApiKeyParams = {
  workspaceId: string
  keyId: string
  keyType: 'personal' | 'workspace'
}

/**
 * Hook to delete an API key
 */
export function useDeleteApiKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, keyId, keyType }: DeleteApiKeyParams) => {
      if (keyType === 'workspace') {
        return requestJson(deleteWorkspaceApiKeyContract, {
          params: { id: workspaceId, keyId },
        })
      }

      return requestJson(deletePersonalApiKeyContract, { params: { id: keyId } })
    },
    onSettled: (_data, _error, variables) => {
      return queryClient.invalidateQueries({
        queryKey: apiKeysKeys.combined(variables.workspaceId),
      })
    },
  })
}

/**
 * Update workspace API key settings mutation params
 */
type UpdateWorkspaceApiKeySettingsParams = { workspaceId: string } & Pick<
  ContractBodyInput<typeof updateWorkspaceContract>,
  'allowPersonalApiKeys'
>

/**
 * Hook to update workspace API key settings
 */
export function useUpdateWorkspaceApiKeySettings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workspaceId,
      allowPersonalApiKeys,
    }: UpdateWorkspaceApiKeySettingsParams) => {
      return requestJson(updateWorkspaceContract, {
        params: { id: workspaceId },
        body: { allowPersonalApiKeys },
      })
    },
    onSettled: (_data, _error, variables) => {
      return queryClient.invalidateQueries({
        queryKey: workspaceKeys.settings(variables.workspaceId),
      })
    },
  })
}
