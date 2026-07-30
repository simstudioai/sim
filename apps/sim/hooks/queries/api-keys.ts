import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import type { ContractBodyInput } from '@/lib/api/contracts'
import {
  type ApiKey,
  type CreatedApiKey,
  createPersonalApiKeyContract,
  createWorkspaceApiKeyContract,
  deletePersonalApiKeyContract,
  deleteWorkspaceApiKeyContract,
  listPersonalApiKeysContract,
  listWorkspaceApiKeysContract,
  updateWorkspaceContract,
} from '@/lib/api/contracts'
import { workspaceKeys } from '@/hooks/queries/workspace'

export type { ApiKey, CreatedApiKey }

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

export type ApiKeyScope = 'combined' | 'personal' | 'workspace'

/**
 * Fetch API keys for one settings plane, or both for compatibility callers.
 */
export async function fetchApiKeys(
  workspaceId: string,
  scope: ApiKeyScope,
  signal?: AbortSignal
): Promise<CombinedApiKeysData> {
  if (scope === 'personal') {
    const data = await requestJson(listPersonalApiKeysContract, { signal })
    return { workspaceKeys: [], personalKeys: data.keys, conflicts: [] }
  }
  if (scope === 'workspace') {
    const data = await requestJson(listWorkspaceApiKeysContract, {
      params: { id: workspaceId },
      signal,
    })
    return { workspaceKeys: data.keys, personalKeys: [], conflicts: [] }
  }

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
 * Hook to fetch API keys for the requested settings plane.
 */
export function useApiKeys(workspaceId: string, scope: ApiKeyScope = 'combined') {
  return useQuery({
    queryKey:
      scope === 'personal'
        ? apiKeysKeys.personal()
        : scope === 'workspace'
          ? apiKeysKeys.workspace(workspaceId)
          : apiKeysKeys.combined(workspaceId),
    queryFn: ({ signal }) => fetchApiKeys(workspaceId, scope, signal),
    enabled: scope === 'personal' || !!workspaceId,
    staleTime: API_KEYS_COMBINED_STALE_TIME,
    placeholderData: scope === 'personal' ? undefined : keepPreviousData,
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
      if (variables.keyType === 'personal') {
        void queryClient.invalidateQueries({ queryKey: apiKeysKeys.personal() })
        return queryClient.invalidateQueries({ queryKey: apiKeysKeys.combineds() })
      }
      void queryClient.invalidateQueries({ queryKey: apiKeysKeys.workspace(variables.workspaceId) })
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
      if (variables.keyType === 'personal') {
        void queryClient.invalidateQueries({ queryKey: apiKeysKeys.personal() })
        return queryClient.invalidateQueries({ queryKey: apiKeysKeys.combineds() })
      }
      void queryClient.invalidateQueries({ queryKey: apiKeysKeys.workspace(variables.workspaceId) })
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
