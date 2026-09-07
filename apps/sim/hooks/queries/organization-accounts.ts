'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type EnsureOrganizationAccountsBody,
  ensureOrganizationAccountsContract,
  getOrganizationAccountsContract,
  startOrganizationAccountConnectionContract,
  type UpdateOrganizationAccountsBody,
  updateOrganizationAccountsContract,
} from '@/lib/api/contracts/organization-accounts'

export const ORGANIZATION_ACCOUNTS_STALE_TIME = 30_000

export const organizationAccountsKeys = {
  all: ['organization-accounts'] as const,
  details: () => [...organizationAccountsKeys.all, 'detail'] as const,
  detail: (organizationId?: string) =>
    [...organizationAccountsKeys.details(), organizationId ?? ''] as const,
}

export function useOrganizationAccounts(organizationId?: string) {
  return useQuery({
    queryKey: organizationAccountsKeys.detail(organizationId),
    enabled: Boolean(organizationId),
    staleTime: ORGANIZATION_ACCOUNTS_STALE_TIME,
    queryFn: ({ signal }) => {
      if (!organizationId) throw new Error('Organization is required')
      return requestJson(getOrganizationAccountsContract, {
        params: { id: organizationId },
        signal,
      })
    },
  })
}

export function useEnsureOrganizationAccounts() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      organizationId,
      ...body
    }: { organizationId: string } & EnsureOrganizationAccountsBody) =>
      requestJson(ensureOrganizationAccountsContract, { params: { id: organizationId }, body }),
    onSuccess: (_, { organizationId }) =>
      queryClient.invalidateQueries({ queryKey: organizationAccountsKeys.detail(organizationId) }),
  })
}

export function useUpdateOrganizationAccounts() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      organizationId,
      groupId,
      update,
    }: {
      organizationId: string
      groupId: string
      update: UpdateOrganizationAccountsBody
    }) =>
      requestJson(updateOrganizationAccountsContract, {
        params: { id: organizationId, groupId },
        body: update,
      }),
    onSuccess: (_, { organizationId }) =>
      queryClient.invalidateQueries({ queryKey: organizationAccountsKeys.detail(organizationId) }),
  })
}

export function useConnectOrganizationAccount() {
  return useMutation({
    mutationFn: ({ organizationId, optionId }: { organizationId: string; optionId: string }) =>
      requestJson(startOrganizationAccountConnectionContract, {
        params: { id: organizationId },
        body: { optionId },
      }),
  })
}
