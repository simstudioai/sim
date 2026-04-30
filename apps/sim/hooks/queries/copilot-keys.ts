import { createLogger } from '@sim/logger'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type CopilotApiKey,
  deleteCopilotApiKeyContract,
  type GenerateCopilotApiKeyResult,
  generateCopilotApiKeyContract,
  listCopilotApiKeysContract,
} from '@/lib/api/contracts'
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
 * Copilot API key type (re-exported from the API contract).
 */
export type CopilotKey = CopilotApiKey

/**
 * Fetch Copilot API keys
 */
async function fetchCopilotKeys(signal?: AbortSignal): Promise<CopilotKey[]> {
  const data = await requestJson(listCopilotApiKeysContract, { signal })
  return data.keys
}

/**
 * Hook to fetch Copilot API keys
 */
export function useCopilotKeys() {
  return useQuery({
    queryKey: copilotKeysKeys.keys(),
    queryFn: ({ signal }) => fetchCopilotKeys(signal),
    enabled: isHosted,
    staleTime: 30 * 1000, // 30 seconds
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
    mutationFn: async ({ name }: GenerateKeyParams): Promise<GenerateCopilotApiKeyResult> => {
      return requestJson(generateCopilotApiKeyContract, { body: { name } })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: copilotKeysKeys.keys(),
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
      return requestJson(deleteCopilotApiKeyContract, { query: { id: keyId } })
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
