import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { API_ENDPOINTS } from '@/stores/constants'

const logger = createLogger('BYOKKeysQueries')

export type BYOKProviderId = 'openai' | 'anthropic' | 'google' | 'mistral'

export interface BYOKKey {
  id: string
  providerId: BYOKProviderId
  maskedKey: string
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface BYOKKeysResponse {
  keys: BYOKKey[]
}

export const byokKeysKeys = {
  all: ['byok-keys'] as const,
  workspace: (workspaceId: string) => [...byokKeysKeys.all, 'workspace', workspaceId] as const,
}

async function fetchBYOKKeys(workspaceId: string): Promise<BYOKKeysResponse> {
  const response = await fetch(API_ENDPOINTS.WORKSPACE_BYOK_KEYS(workspaceId))
  if (!response.ok) {
    throw new Error(`Failed to load BYOK keys: ${response.statusText}`)
  }
  const data = await response.json()
  return {
    keys: data.keys ?? [],
  }
}

export function useBYOKKeys(workspaceId: string) {
  return useQuery({
    queryKey: byokKeysKeys.workspace(workspaceId),
    queryFn: () => fetchBYOKKeys(workspaceId),
    enabled: !!workspaceId,
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
    select: (data) => data,
  })
}

interface UpsertBYOKKeyParams {
  workspaceId: string
  providerId: BYOKProviderId
  apiKey: string
}

export function useUpsertBYOKKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, providerId, apiKey }: UpsertBYOKKeyParams) => {
      const response = await fetch(API_ENDPOINTS.WORKSPACE_BYOK_KEYS(workspaceId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId, apiKey }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || `Failed to save BYOK key: ${response.statusText}`)
      }

      logger.info(`Saved BYOK key for ${providerId} in workspace ${workspaceId}`)
      return await response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: byokKeysKeys.workspace(variables.workspaceId),
      })
    },
  })
}

interface DeleteBYOKKeyParams {
  workspaceId: string
  providerId: BYOKProviderId
}

export function useDeleteBYOKKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, providerId }: DeleteBYOKKeyParams) => {
      const response = await fetch(API_ENDPOINTS.WORKSPACE_BYOK_KEYS(workspaceId), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || `Failed to delete BYOK key: ${response.statusText}`)
      }

      logger.info(`Deleted BYOK key for ${providerId} from workspace ${workspaceId}`)
      return await response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: byokKeysKeys.workspace(variables.workspaceId),
      })
    },
  })
}
