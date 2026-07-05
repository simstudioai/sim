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
  lists: () => [...byokKeysKeys.all, 'list'] as const,
  list: (workspaceId?: string) => [...byokKeysKeys.lists(), workspaceId ?? ''] as const,
}

export const BYOK_KEY_LIST_STALE_TIME = 60 * 1000

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
    queryKey: byokKeysKeys.list(workspaceId),
    queryFn: ({ signal }) => fetchBYOKKeys(workspaceId, signal),
    enabled: !!workspaceId,
    staleTime: BYOK_KEY_LIST_STALE_TIME,
    placeholderData: keepPreviousData,
  })
}

type UpsertBYOKKeyParams = {
  workspaceId: string
} & ContractBodyInput<typeof upsertByokKeyContract>

export function useUpsertBYOKKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, ...body }: UpsertBYOKKeyParams) => {
      const data = await requestJson(upsertByokKeyContract, {
        params: { id: workspaceId },
        body,
      })
      logger.info(`Saved BYOK key for ${body.providerId} in workspace ${workspaceId}`)
      return data
    },
    onSettled: (_data, _error, variables) =>
      queryClient.invalidateQueries({
        queryKey: byokKeysKeys.list(variables.workspaceId),
      }),
  })
}

type DeleteBYOKKeyParams = {
  workspaceId: string
} & ContractBodyInput<typeof deleteByokKeyContract>

export function useDeleteBYOKKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, ...body }: DeleteBYOKKeyParams) => {
      const data = await requestJson(deleteByokKeyContract, {
        params: { id: workspaceId },
        body,
      })
      logger.info(`Deleted BYOK key for ${body.providerId} from workspace ${workspaceId}`)
      return data
    },
    onSettled: (_data, _error, variables) =>
      queryClient.invalidateQueries({
        queryKey: byokKeysKeys.list(variables.workspaceId),
      }),
  })
}
