import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { workspaceKeys } from './workspace'

/**
 * Query key factories for API keys-related queries
 */
export const apiKeysKeys = {
  all: ['apiKeys'] as const,
  workspace: (workspaceId: string) => [...apiKeysKeys.all, 'workspace', workspaceId] as const,
  personal: () => [...apiKeysKeys.all, 'personal'] as const,
  combined: (workspaceId: string) => [...apiKeysKeys.all, 'combined', workspaceId] as const,
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
async function fetchApiKeys(workspaceId: string): Promise<ApiKeysResponse> {
  const [workspaceResponse, personalResponse] = await Promise.all([
    fetch(`/api/workspaces/${workspaceId}/api-keys`),
    fetch('/api/users/me/api-keys'),
  ])

  let workspaceKeys: ApiKey[] = []
  let personalKeys: ApiKey[] = []

  if (workspaceResponse.ok) {
    const workspaceData = await workspaceResponse.json()
    workspaceKeys = workspaceData.keys || []
  }

  if (personalResponse.ok) {
    const personalData = await personalResponse.json()
    personalKeys = personalData.keys || []
  }

  // Client-side conflict detection
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
 * API keys change infrequently, cache for 60 seconds
 */
export function useApiKeys(workspaceId: string) {
  return useQuery({
    queryKey: apiKeysKeys.combined(workspaceId),
    queryFn: () => fetchApiKeys(workspaceId),
    enabled: !!workspaceId,
    staleTime: 60 * 1000, // 60 seconds
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
}

/**
 * Hook to create a new API key
 */
export function useCreateApiKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, name, keyType }: CreateApiKeyParams) => {
      const url =
        keyType === 'workspace'
          ? `/api/workspaces/${workspaceId}/api-keys`
          : '/api/users/me/api-keys'

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to create API key' }))
        throw new Error(error.error || 'Failed to create API key')
      }

      return response.json()
    },
    onSuccess: (_data, variables) => {
      // Invalidate API keys cache
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
      // Invalidate API keys cache
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
      // Invalidate workspace settings cache
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.settings(variables.workspaceId),
      })
    },
  })
}
