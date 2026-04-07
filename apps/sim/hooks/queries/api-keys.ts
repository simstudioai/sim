import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { workspaceKeys } from '@/hooks/queries/workspace'

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

/**
 * API Key type definition
 */
export interface ApiKey {
  id: string
  name: string
  key: string
  displayKey?: string
  lastUsed?: string
  createdAt: string
  expiresAt?: string
  createdBy?: string
}

/**
 * Combined API keys response
 */
interface ApiKeysResponse {
  workspaceKeys: ApiKey[]
  personalKeys: ApiKey[]
  conflicts: string[]
}

/**
 * Fetch both workspace and personal API keys
 */
async function fetchApiKeys(workspaceId: string, signal?: AbortSignal): Promise<ApiKeysResponse> {
  const [workspaceResponse, personalResponse] = await Promise.all([
    fetch(`/api/workspaces/${workspaceId}/api-keys`, { signal }),
    fetch('/api/users/me/api-keys', { signal }),
  ])

  if (!workspaceResponse.ok) {
    throw new Error(`Failed to fetch workspace API keys: ${workspaceResponse.status}`)
  }
  if (!personalResponse.ok) {
    throw new Error(`Failed to fetch personal API keys: ${personalResponse.status}`)
  }

  const workspaceData = await workspaceResponse.json()
  const personalData = await personalResponse.json()
  const workspaceKeys: ApiKey[] = workspaceData.keys || []
  const personalKeys: ApiKey[] = personalData.keys || []

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
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })
}

/**
 * Create API key mutation params
 */
interface CreateApiKeyParams {
  workspaceId: string
  name: string
  keyType: 'personal' | 'workspace'
  source?: 'settings' | 'deploy_modal'
}

/**
 * Hook to create a new API key
 */
export function useCreateApiKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, name, keyType, source }: CreateApiKeyParams) => {
      const url =
        keyType === 'workspace'
          ? `/api/workspaces/${workspaceId}/api-keys`
          : '/api/users/me/api-keys'

      const body: Record<string, unknown> = { name: name.trim() }
      if (keyType === 'workspace' && source) body.source = source

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to create API key' }))
        throw new Error(error.error || 'Failed to create API key')
      }

      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: apiKeysKeys.combined(variables.workspaceId),
      })
    },
  })
}

/**
 * Delete API key mutation params
 */
interface DeleteApiKeyParams {
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
      const url =
        keyType === 'workspace'
          ? `/api/workspaces/${workspaceId}/api-keys/${keyId}`
          : `/api/users/me/api-keys/${keyId}`

      const response = await fetch(url, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to delete API key' }))
        throw new Error(error.error || 'Failed to delete API key')
      }

      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: apiKeysKeys.combined(variables.workspaceId),
      })
    },
  })
}

/**
 * Update workspace API key settings mutation params
 */
interface UpdateWorkspaceApiKeySettingsParams {
  workspaceId: string
  allowPersonalApiKeys: boolean
}

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
      const response = await fetch(`/api/workspaces/${workspaceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowPersonalApiKeys }),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to update settings' }))
        throw new Error(error.error || 'Failed to update workspace settings')
      }

      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.settings(variables.workspaceId),
      })
    },
  })
}
