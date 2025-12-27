import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isHosted } from '@/lib/core/config/feature-flags'

const logger = createLogger('CopilotKeysQuery')

/**
 * Query key factories for Copilot API keys
 */
export const copilotKeysKeys = {
  all: ['copilot'] as const,
  keys: () => [...copilotKeysKeys.all, 'api-keys'] as const,
}

/**
 * Copilot API key type
 */
export interface CopilotKey {
  id: string
  displayKey: string // "•••••{last6}"
  name: string | null
  createdAt: string | null
  lastUsed: string | null
}

/**
 * Generate key response type
 */
export interface GenerateKeyResponse {
  success: boolean
  key: {
    id: string
    apiKey: string // Full key (only shown once)
  }
}

/**
 * Fetch Copilot API keys
 */
async function fetchCopilotKeys(): Promise<CopilotKey[]> {
  const response = await fetch('/api/copilot/api-keys')

  if (!response.ok) {
    throw new Error('Failed to fetch Copilot API keys')
  }

  const data = await response.json()
  return data.keys || []
}

/**
 * Hook to fetch Copilot API keys
 */
export function useCopilotKeys() {
  return useQuery({
    queryKey: copilotKeysKeys.keys(),
    queryFn: fetchCopilotKeys,
    enabled: isHosted,
    staleTime: 30 * 1000, // 30 seconds
    placeholderData: keepPreviousData,
  })
}

/**
 * Generate key params
 */
interface GenerateKeyParams {
  name: string
}

/**
 * Generate new Copilot API key mutation
 */
export function useGenerateCopilotKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ name }: GenerateKeyParams): Promise<GenerateKeyResponse> => {
      const response = await fetch('/api/copilot/api-keys/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to generate Copilot API key')
      }

      return response.json()
    },
    onSuccess: () => {
      queryClient.refetchQueries({
        queryKey: copilotKeysKeys.keys(),
        type: 'active',
      })
    },
    onError: (error) => {
      logger.error('Failed to generate Copilot API key:', error)
    },
  })
}

/**
 * Delete Copilot API key mutation with optimistic updates
 */
interface DeleteKeyParams {
  keyId: string
}

export function useDeleteCopilotKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ keyId }: DeleteKeyParams) => {
      const response = await fetch(`/api/copilot/api-keys?id=${keyId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to delete Copilot API key')
      }

      return response.json()
    },
    onMutate: async ({ keyId }) => {
      await queryClient.cancelQueries({ queryKey: copilotKeysKeys.keys() })

      const previousKeys = queryClient.getQueryData<CopilotKey[]>(copilotKeysKeys.keys())

      queryClient.setQueryData<CopilotKey[]>(copilotKeysKeys.keys(), (old) => {
        return old?.filter((k) => k.id !== keyId) || []
      })

      return { previousKeys }
    },
    onError: (error, _variables, context) => {
      if (context?.previousKeys) {
        queryClient.setQueryData(copilotKeysKeys.keys(), context.previousKeys)
      }
      logger.error('Failed to delete Copilot API key:', error)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: copilotKeysKeys.keys() })
    },
  })
}
