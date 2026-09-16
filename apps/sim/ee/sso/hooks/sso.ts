'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  deleteSsoProviderContract,
  listSsoProvidersContract,
  type SsoRegistrationBody,
  setPrimarySsoProviderContract,
  ssoRegistrationContract,
} from '@/lib/api/contracts/auth'
import { organizationKeys } from '@/hooks/queries/organization'

export const SSO_PROVIDERS_STALE_TIME = 5 * 60 * 1000

/**
 * Query key factories for SSO-related queries
 */
export const ssoKeys = {
  all: ['sso'] as const,
  providers: () => [...ssoKeys.all, 'providers'] as const,
  providerList: (organizationId?: string) =>
    [...ssoKeys.providers(), organizationId ?? ''] as const,
  /**
   * Whether members must sign in through the identity provider. Under the same root as the
   * providers it depends on, so a provider change invalidates both in one call.
   */
  policies: () => [...ssoKeys.all, 'policy'] as const,
  policy: (organizationId?: string) => [...ssoKeys.policies(), organizationId ?? ''] as const,
}

/**
 * Fetch SSO providers
 */
async function fetchSSOProviders(signal: AbortSignal, organizationId?: string) {
  return requestJson(listSsoProvidersContract, {
    query: organizationId ? { organizationId } : {},
    signal,
  })
}

/**
 * Hook to fetch SSO providers
 */
interface UseSSOProvidersOptions {
  enabled?: boolean
  organizationId?: string
}

export function useSSOProviders({ enabled = true, organizationId }: UseSSOProvidersOptions = {}) {
  return useQuery({
    queryKey: ssoKeys.providerList(organizationId),
    queryFn: ({ signal }) => fetchSSOProviders(signal, organizationId),
    staleTime: SSO_PROVIDERS_STALE_TIME,
    enabled,
  })
}

/**
 * Configure SSO provider mutation
 */
export function useConfigureSSO() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (config: SsoRegistrationBody) =>
      requestJson(ssoRegistrationContract, { body: config }),
    onSettled: (_data, _error, variables) => {
      /** Awaited, so the caller navigates against a list that already holds the change. */
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ssoKeys.all }),
        queryClient.invalidateQueries({ queryKey: organizationKeys.detail(variables.orgId) }),
        queryClient.invalidateQueries({ queryKey: organizationKeys.lists() }),
      ])
    },
  })
}

/** Removes one identity provider; accounts it admitted are untouched. */
export function useDeleteSSOProvider() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (providerId: string) =>
      requestJson(deleteSsoProviderContract, { params: { providerId } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ssoKeys.all }),
  })
}

/** Moves sign-in for a provider's domain to that provider. */
export function useSetPrimarySSOProvider() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (providerId: string) =>
      requestJson(setPrimarySsoProviderContract, {
        params: { providerId },
        body: { isPrimary: true },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ssoKeys.all }),
  })
}
