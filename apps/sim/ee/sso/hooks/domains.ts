'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type AddOrganizationDomainBody,
  addOrganizationDomainContract,
  listOrganizationDomainsContract,
  type OrganizationDomains,
  removeOrganizationDomainContract,
  verifyOrganizationDomainContract,
} from '@/lib/api/contracts/organization'

export type DomainsResponse = OrganizationDomains

export const DOMAINS_STALE_TIME = 60 * 1000

export const domainKeys = {
  all: ['orgDomains'] as const,
  lists: () => [...domainKeys.all, 'list'] as const,
  list: (orgId: string) => [...domainKeys.lists(), orgId] as const,
}

async function fetchDomains(orgId: string, signal?: AbortSignal): Promise<DomainsResponse> {
  const { data } = await requestJson(listOrganizationDomainsContract, {
    params: { id: orgId },
    signal,
  })
  return data
}

export function useOrganizationDomains(orgId: string | undefined) {
  return useQuery({
    queryKey: domainKeys.list(orgId ?? ''),
    queryFn: ({ signal }) => fetchDomains(orgId as string, signal),
    enabled: Boolean(orgId),
    staleTime: DOMAINS_STALE_TIME,
  })
}

export function useAddOrganizationDomain() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, body }: { orgId: string; body: AddOrganizationDomainBody }) =>
      requestJson(addOrganizationDomainContract, { params: { id: orgId }, body }),
    onSettled: (_data, _error, { orgId }) => {
      queryClient.invalidateQueries({ queryKey: domainKeys.list(orgId) })
    },
  })
}

export function useVerifyOrganizationDomain() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, domainId }: { orgId: string; domainId: string }) =>
      requestJson(verifyOrganizationDomainContract, { params: { id: orgId, domainId } }),
    onSettled: (_data, _error, { orgId }) => {
      queryClient.invalidateQueries({ queryKey: domainKeys.list(orgId) })
    },
  })
}

export function useRemoveOrganizationDomain() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, domainId }: { orgId: string; domainId: string }) =>
      requestJson(removeOrganizationDomainContract, { params: { id: orgId, domainId } }),
    onSettled: (_data, _error, { orgId }) => {
      queryClient.invalidateQueries({ queryKey: domainKeys.list(orgId) })
    },
  })
}
