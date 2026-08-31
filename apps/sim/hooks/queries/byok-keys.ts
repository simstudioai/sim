import { createLogger } from '@sim/logger'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import type { ContractBodyInput } from '@/lib/api/contracts'
import {
  type BYOKKey,
  deleteByokKeyContract,
  deleteOrganizationByokKeyContract,
  getInheritedByokStatusContract,
  type InheritedBYOKStatusResponse,
  listOrganizationByokKeysContract,
  type OrganizationBYOKKeysResponse,
  upsertByokKeyContract,
  upsertOrganizationByokKeyContract,
} from '@/lib/api/contracts'
import {
  BYOK_KEY_LIST_STALE_TIME,
  byokKeysKeys,
  byokKeysQueryOptions,
} from '@/hooks/queries/byok-key-list'

const logger = createLogger('BYOKKeysQueries')

export type { BYOKKey }

async function fetchOrganizationBYOKKeys(
  organizationId: string,
  signal?: AbortSignal
): Promise<OrganizationBYOKKeysResponse> {
  return requestJson(listOrganizationByokKeysContract, {
    params: { id: organizationId },
    signal,
  })
}

async function fetchInheritedBYOKStatus(
  workspaceId: string,
  signal?: AbortSignal
): Promise<InheritedBYOKStatusResponse> {
  return requestJson(getInheritedByokStatusContract, {
    params: { id: workspaceId },
    signal,
  })
}

export function useBYOKKeys(workspaceId: string) {
  return useQuery({
    ...byokKeysQueryOptions(workspaceId),
    enabled: !!workspaceId,
  })
}

interface UseOrganizationBYOKKeysOptions {
  enabled?: boolean
}

export function useOrganizationBYOKKeys(
  organizationId?: string,
  options?: UseOrganizationBYOKKeysOptions
) {
  return useQuery({
    queryKey: byokKeysKeys.organizationList(organizationId),
    queryFn: ({ signal }) => fetchOrganizationBYOKKeys(organizationId as string, signal),
    enabled: Boolean(organizationId) && (options?.enabled ?? true),
    staleTime: BYOK_KEY_LIST_STALE_TIME,
  })
}

export function useInheritedBYOKStatus(workspaceId?: string) {
  return useQuery({
    queryKey: byokKeysKeys.inheritedStatus(workspaceId),
    queryFn: ({ signal }) => fetchInheritedBYOKStatus(workspaceId as string, signal),
    enabled: Boolean(workspaceId),
    staleTime: BYOK_KEY_LIST_STALE_TIME,
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
    onSettled: async (_data, _error, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: byokKeysKeys.list(variables.workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: byokKeysKeys.inheritedStatus(variables.workspaceId),
        }),
      ])
    },
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
    onSettled: async (_data, _error, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: byokKeysKeys.list(variables.workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: byokKeysKeys.inheritedStatus(variables.workspaceId),
        }),
      ])
    },
  })
}

type UpsertOrganizationBYOKKeyParams = {
  organizationId: string
} & ContractBodyInput<typeof upsertOrganizationByokKeyContract>

export function useUpsertOrganizationBYOKKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ organizationId, ...body }: UpsertOrganizationBYOKKeyParams) => {
      const data = await requestJson(upsertOrganizationByokKeyContract, {
        params: { id: organizationId },
        body,
      })
      logger.info(`Saved BYOK key for ${body.providerId} in organization ${organizationId}`)
      return data
    },
    onSettled: async (_data, _error, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: byokKeysKeys.organizationList(variables.organizationId),
        }),
        queryClient.invalidateQueries({
          queryKey: byokKeysKeys.inheritedStatuses(),
        }),
      ])
    },
  })
}

type DeleteOrganizationBYOKKeyParams = {
  organizationId: string
} & ContractBodyInput<typeof deleteOrganizationByokKeyContract>

export function useDeleteOrganizationBYOKKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ organizationId, ...body }: DeleteOrganizationBYOKKeyParams) => {
      const data = await requestJson(deleteOrganizationByokKeyContract, {
        params: { id: organizationId },
        body,
      })
      logger.info(`Deleted BYOK key for ${body.providerId} from organization ${organizationId}`)
      return data
    },
    onSettled: async (_data, _error, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: byokKeysKeys.organizationList(variables.organizationId),
        }),
        queryClient.invalidateQueries({
          queryKey: byokKeysKeys.inheritedStatuses(),
        }),
      ])
    },
  })
}
