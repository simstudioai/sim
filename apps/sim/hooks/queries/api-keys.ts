import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import type { ContractBodyInput } from '@/lib/api/contracts'
import {
  type CreatedApiKey,
  createPersonalApiKeyContract,
  createWorkspaceApiKeyContract,
  deletePersonalApiKeyContract,
  deleteWorkspaceApiKeyContract,
  updateWorkspaceContract,
} from '@/lib/api/contracts'
import type { WorkspaceHostContext } from '@/lib/api/contracts/workspaces'
import { type ApiKeyScope, apiKeysKeys, apiKeysQueryOptions } from '@/hooks/queries/api-key-list'
import { workspaceKeys } from '@/hooks/queries/workspace'
import { workspaceHostKeys } from '@/hooks/queries/workspace-host'

export type { CreatedApiKey }

interface UseApiKeysOptions {
  enabled?: boolean
}

/**
 * Hook to fetch API keys for the requested settings plane.
 */
export function useApiKeys(
  workspaceId: string,
  scope: ApiKeyScope = 'combined',
  options?: UseApiKeysOptions
) {
  return useQuery({
    ...apiKeysQueryOptions(workspaceId, scope),
    enabled: (scope === 'personal' || !!workspaceId) && (options?.enabled ?? true),
  })
}

/**
 * Create API key mutation params
 */
type CreateApiKeyParams = (
  | { workspaceId: string; keyType: 'workspace' }
  | { workspaceId?: string; keyType: 'personal' }
) &
  ContractBodyInput<typeof createWorkspaceApiKeyContract>

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
    onSuccess: (_data, variables) => {
      queryClient.setQueryData<WorkspaceHostContext>(
        workspaceHostKeys.detail(variables.workspaceId),
        (current) =>
          current
            ? {
                ...current,
                workspace: {
                  ...current.workspace,
                  allowPersonalApiKeys: variables.allowPersonalApiKeys,
                },
              }
            : current
      )
    },
    onSettled: async (_data, _error, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: workspaceKeys.settings(variables.workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: workspaceHostKeys.detail(variables.workspaceId),
        }),
      ])
    },
  })
}
