'use client'

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  listSsoProvidersContract,
  type SsoRegistrationBody,
  ssoRegistrationContract,
} from '@/lib/api/contracts/auth'
import { organizationKeys } from '@/hooks/queries/organization'

/**
 * Query key factories for SSO-related queries
 */
export const ssoKeys = {
  all: ['sso'] as const,
  providers: () => [...ssoKeys.all, 'providers'] as const,
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
    queryKey: [...ssoKeys.providers(), organizationId ?? ''],
    queryFn: ({ signal }) => fetchSSOProviders(signal, organizationId),
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
    enabled,
  })
}

/**
 * Configure SSO provider mutation
 */
type ConfigureSSOParams = Record<string, unknown>

export function useConfigureSSO() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (config: ConfigureSSOParams) =>
      requestJson(ssoRegistrationContract, {
        body: config as SsoRegistrationBody,
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: ssoKeys.providers() })

      const orgId = typeof variables.orgId === 'string' ? variables.orgId : undefined
      if (orgId) {
        queryClient.invalidateQueries({ queryKey: organizationKeys.detail(orgId) })
        queryClient.invalidateQueries({ queryKey: organizationKeys.lists() })
      }
    },
  })
}
