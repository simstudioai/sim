'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  deleteSsoProviderContract,
  listSsoProvidersContract,
  requestSsoDomainVerificationContract,
  type SsoRegistrationBody,
  type SsoUpdateBody,
  ssoRegistrationContract,
  updateSsoProviderContract,
  verifySsoDomainContract,
} from '@/lib/api/contracts/auth'
import { organizationKeys } from '@/hooks/queries/organization'

export const ssoKeys = {
  all: ['sso'] as const,
  providers: () => [...ssoKeys.all, 'providers'] as const,
  providerList: (organizationId?: string) =>
    [...ssoKeys.providers(), organizationId ?? ''] as const,
}

async function fetchSSOProviders(signal: AbortSignal, organizationId?: string) {
  return requestJson(listSsoProvidersContract, {
    query: organizationId ? { organizationId } : {},
    signal,
  })
}

interface UseSSOProvidersOptions {
  enabled?: boolean
  organizationId?: string
}

export function useSSOProviders({ enabled = true, organizationId }: UseSSOProvidersOptions = {}) {
  return useQuery({
    queryKey: ssoKeys.providerList(organizationId),
    queryFn: ({ signal }) => fetchSSOProviders(signal, organizationId),
    staleTime: 5 * 60 * 1000,
    enabled,
  })
}

function invalidateSSOQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  organizationId: string
) {
  queryClient.invalidateQueries({ queryKey: ssoKeys.providers() })
  queryClient.invalidateQueries({ queryKey: organizationKeys.detail(organizationId) })
  queryClient.invalidateQueries({ queryKey: organizationKeys.lists() })
}

export function useCreateSSOProvider() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: SsoRegistrationBody) =>
      requestJson(ssoRegistrationContract, {
        body,
      }),
    onSettled: (_data, _error, variables) => {
      invalidateSSOQueries(queryClient, variables.orgId)
    },
  })
}

interface UpdateSSOProviderVariables {
  id: string
  organizationId: string
  body: SsoUpdateBody
}

export function useUpdateSSOProvider() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: UpdateSSOProviderVariables) =>
      requestJson(updateSsoProviderContract, {
        params: { id },
        body,
      }),
    onSettled: (_data, _error, variables) => {
      invalidateSSOQueries(queryClient, variables.organizationId)
    },
  })
}

interface ProviderActionVariables {
  id: string
  organizationId: string
}

export function useDeleteSSOProvider() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: ProviderActionVariables) =>
      requestJson(deleteSsoProviderContract, {
        params: { id },
      }),
    onSettled: (_data, _error, variables) => {
      invalidateSSOQueries(queryClient, variables.organizationId)
    },
  })
}

export function useRequestSSODomainVerification() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: ProviderActionVariables) =>
      requestJson(requestSsoDomainVerificationContract, {
        params: { id },
      }),
    onSettled: (_data, _error, variables) => {
      invalidateSSOQueries(queryClient, variables.organizationId)
    },
  })
}

export function useVerifySSODomain() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: ProviderActionVariables) =>
      requestJson(verifySsoDomainContract, {
        params: { id },
      }),
    onSettled: (_data, _error, variables) => {
      invalidateSSOQueries(queryClient, variables.organizationId)
    },
  })
}
