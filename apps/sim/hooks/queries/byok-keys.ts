import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import type { ContractBodyInput } from '@/lib/api/contracts'
import {
  type BYOKKey,
  type BYOKKeysResponse,
  deleteByokKeyContract,
  listByokKeysContract,
  upsertByokKeyContract,
} from '@/lib/api/contracts'

const logger = createLogger('BYOKKeysQueries')

export type { BYOKKey, BYOKKeysResponse }

export const byokKeysKeys = {
  all: ['byok-keys'] as const,
  workspace: (workspaceId: string) => [...byokKeysKeys.all, 'workspace', workspaceId] as const,
}

async function fetchBYOKKeys(workspaceId: string, signal?: AbortSignal): Promise<BYOKKeysResponse> {
  const data = await requestJson(listByokKeysContract, {
    params: { id: workspaceId },
    signal,
  })
  return {
    keys: data.keys ?? [],
  }
}

export function useBYOKKeys(workspaceId: string) {
  return useQuery({
    queryKey: byokKeysKeys.workspace(workspaceId),
    queryFn: ({ signal }) => fetchBYOKKeys(workspaceId, signal),
    enabled: !!workspaceId,
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })
}

type UpsertBYOKKeyParams = {
  workspaceId: string
} & ContractBodyInput<typeof upsertByokKeyContract>

export function useUpsertBYOKKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, providerId, apiKey }: UpsertBYOKKeyParams) => {
      const data = await requestJson(upsertByokKeyContract, {
        params: { id: workspaceId },
        body: { providerId, apiKey },
      })
      logger.info(`Saved BYOK key for ${providerId} in workspace ${workspaceId}`)
      return data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: byokKeysKeys.workspace(variables.workspaceId),
      })
    },
  })
}

type DeleteBYOKKeyParams = {
  workspaceId: string
} & ContractBodyInput<typeof deleteByokKeyContract>

export function useDeleteBYOKKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, providerId }: DeleteBYOKKeyParams) => {
      const data = await requestJson(deleteByokKeyContract, {
        params: { id: workspaceId },
        body: { providerId },
      })
      logger.info(`Deleted BYOK key for ${providerId} from workspace ${workspaceId}`)
      return data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: byokKeysKeys.workspace(variables.workspaceId),
      })
    },
  })
}
